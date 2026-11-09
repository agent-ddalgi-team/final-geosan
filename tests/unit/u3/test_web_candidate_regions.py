"""#529: 웹 후보도 고른 시·도와 시·군 안에서만 판단한다. 외부 응답은 가상이다."""

from dataclasses import replace
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from geosan.config.errors import InputError
from geosan.opportunity import candidate_pick, candidate_web, web_candidate_store
from geosan.opportunity.models import Customer, IngestBatch
from geosan.opportunity.source_models import CandidateJudgment, WebCandidate, WebSearchRun
from geosan.storage.session import session_scope
from tests.fakes.web_candidate_search import BATCH, logs
from tests.fakes.web_candidate_storage import setup_web_storage


@pytest.fixture
def ready(tmp_db, app_settings_path, monkeypatch):
    return setup_web_storage(app_settings_path, monkeypatch)


def save_for_regions(regions, *addresses):
    with session_scope() as session:
        batch = session.get(IngestBatch, BATCH)
        batch.criteria = batch.criteria | {"regions": regions}
    result = candidate_web.search_candidates(BATCH)
    result = replace(
        result,
        candidates=tuple(replace(result.candidates[0], address=address) for address in addresses),
    )
    return web_candidate_store.save_web_search(
        BATCH, result, registry_statuses=["FOUND"] * len(addresses)
    )


def judgment_count():
    with session_scope() as session:
        return session.scalar(select(func.count()).select_from(CandidateJudgment))


@pytest.mark.parametrize(
    ("selected", "address"),
    [
        (["천안시"], "충남 아산시"),
        (["천안시"], "충청남도 서산시 가상길 1"),
        (["천안시"], "대전광역시 유성구 가상길 1"),
        (["천안시"], "경기도 천안시 서북구 가상길 1"),
        (["천안시"], "충남"),
        (["충남"], "세종특별자치시 조치원읍 가상길 1"),
        (["천안시", "대전"], "충남 아산시 가상길 1"),
    ],
)
def test_outside_selected_region_is_rejected_before_ai_or_cached_judgment(ready, selected, address):
    saved = save_for_regions(selected, address)
    cached = web_candidate_store.find_cached_web_search(BATCH)
    assert cached.candidate_ids == saved.candidate_ids
    with pytest.raises(InputError, match="지역"):
        candidate_pick.pick_candidates(BATCH, cached.candidate_ids, source_kind="WEB")
    assert not ready["pick"] and judgment_count() == 0
    assert len(logs()) == 1 and logs()[0].cost_usd == Decimal("0.014")
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 0
        assert session.get(WebSearchRun, saved.run_id).result_count == 1


@pytest.mark.parametrize(
    ("selected", "address"),
    [
        (["천안시"], "충청남도 천안시 서북구 가상길 1"),
        (["천안시"], "충남 천안시서북구 가상길 1"),
        (["천안시"], "충남 천안시동남구 가상길 1"),
        (["천안시"], "충남 천안시, 가상길 1"),
        (["아산시"], "충남 아산시 가상길 1"),
        (["천안시", "아산시"], "충청남도 아산시 가상길 1"),
        (["천안시", "대전"], "대전광역시 유성구 가상길 1"),
        (["충남", "천안시"], "충남 아산시 가상길 1"),
        (["충남"], "충청남도"),
        (["세종"], "세종특별자치시 조치원읍 가상길 1"),
        (["천안시"], None),
    ],
)
def test_selected_region_and_nullable_address_keep_judgment_reuse(ready, selected, address):
    saved = save_for_regions(selected, address)
    before = candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    assert candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB") == before
    assert len(ready["pick"]) == judgment_count() == 1
    assert [row.cost_usd for row in logs()] == [Decimal("0.014"), Decimal("0.004")]
    with session_scope() as session:
        assert session.get(WebCandidate, saved.candidate_ids[0]).address == address
        assert session.scalar(select(func.count()).select_from(Customer)) == 0


def test_wrong_region_in_selection_rejects_all_but_valid_subset_can_be_judged(ready):
    saved = save_for_regions(["천안시"], "충남 천안시", "충남 아산시")
    with pytest.raises(InputError, match="지역"):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    assert not ready["pick"] and judgment_count() == 0
    with session_scope() as session:
        selected = session.scalar(
            select(WebCandidate.candidate_id).where(WebCandidate.address == "충남 천안시")
        )
    assert (
        candidate_pick.pick_candidates(BATCH, [selected], source_kind="WEB")[0].row_id == selected
    )
    assert len(ready["pick"]) == judgment_count() == 1


def test_changed_address_cannot_reuse_an_existing_judgment(ready):
    saved = save_for_regions(["천안시"], "충남 천안시")
    candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    with session_scope() as session:
        session.get(WebCandidate, saved.candidate_ids[0]).address = "충남 아산시"
    with pytest.raises(InputError, match="지역"):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    assert len(ready["pick"]) == judgment_count() == 1
    assert len(logs()) == 2


@pytest.mark.parametrize("stage", ["before_send", "before_save"])
def test_address_change_is_rechecked_at_send_and_save(ready, monkeypatch, stage):
    saved = save_for_regions(["천안시"], "충남 천안시")

    def move():
        with session_scope() as session:
            session.get(WebCandidate, saved.candidate_ids[0]).address = "충남 아산시"

    if stage == "before_send":
        original = candidate_pick.prepare_candidate_judgments

        def change(*args, **kwargs):
            plan = original(*args, **kwargs)
            move()
            return plan

        monkeypatch.setattr(candidate_pick, "prepare_candidate_judgments", change)
    else:
        original = candidate_pick._post

        def change(*args, **kwargs):
            answer = original(*args, **kwargs)
            move()
            return answer

        monkeypatch.setattr(candidate_pick, "_post", change)
    with pytest.raises(InputError, match="지역"):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    assert judgment_count() == 0
    expected_calls = 0 if stage == "before_send" else 1
    assert len(ready["pick"]) == expected_calls
    expected_costs = [Decimal("0.014")] + [Decimal("0.004")] * expected_calls
    assert [row.cost_usd for row in logs()] == expected_costs
