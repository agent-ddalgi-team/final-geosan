"""#532: 웹 후보의 기존 회사 확인. 등록 확인·판단은 가상, 조회·보존은 실제 임시 DB다."""

import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from geosan.capability.models import Process
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.config.errors import AppError, InputError
from geosan.opportunity.candidate_judgments import rank_candidates
from geosan.opportunity.candidate_registration import registered_row_ids
from geosan.opportunity.candidate_web import CandidateSearchResult, load_search_context
from geosan.opportunity.candidate_web_results import WebSearchCandidate
from geosan.opportunity.judgment_store import prepare_candidate_judgments, save_candidate_judgments
from geosan.opportunity.models import Customer, IngestBatch, MergeCandidate, Opportunity
from geosan.opportunity.source_models import CandidateJudgment, WebCandidate, WebSearchRun
from geosan.opportunity.web_candidate_store import save_web_search
from geosan.rules.codes import DatasetKind
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.test_candidate_registration import BATCH, existing, judgment, rows, snapshot
from tests.unit.u3.test_candidate_registration import registration_context as registration_context


@pytest.fixture
def web_context(registration_context):
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.candidate_web_search.enabled = True
        sync_app_settings(session, settings)
        session.get(IngestBatch, BATCH).max_candidates = settings.ingestion.max_candidates
    return registration_context


def saved_web(*candidates, status="FOUND"):
    context = load_search_context(BATCH)
    now = utcnow()
    result = CandidateSearchResult(
        tuple(candidates), 0, context.criteria_hash, now, now + timedelta(days=context.cache_days)
    )
    return save_web_search(BATCH, result, registry_statuses=[status] * len(candidates))


def candidate(name="가상볼트", address="충남 아산시 가상길 1"):
    return WebSearchCandidate(name, address, "https://bolt.example/products", "볼트 생산")


def registered(*judgments):
    with session_scope() as session:
        return registered_row_ids(session, BATCH, judgments, source_kind="WEB")


@pytest.mark.parametrize("source", ["CASE_FILE", "FACTORY_FILE", "FACTORY_API", "WEB_SEARCH"])
@pytest.mark.parametrize("registry_status", ["FOUND", "NOT_FOUND"])
def test_exact_identity_preserves_existing_company_and_web_rows(
    web_context, source, registry_status
):
    existing(discovery_source=source, pick_reason="담당자가 남긴 기존 이유", fit_level="LOW")
    saved = saved_web(candidate("(주) 가상볼트", "충남  아산시 가상길 1"), status=registry_status)
    models = (Customer, WebCandidate, WebSearchRun, CandidateJudgment, IngestBatch)
    before = {model: snapshot(model) for model in models}
    selected = judgment(saved.candidate_ids[0])
    assert registered(selected) == registered(selected) == set(saved.candidate_ids)
    assert {model: snapshot(model) for model in models} == before
    assert not rows(Opportunity) and not rows(MergeCandidate)


@pytest.mark.parametrize(
    ("name", "address", "known_address"),
    [
        ("가상볼트", "충남 천안시 다른길 1", "충남 아산시 가상길 1"),
        ("가상너트", "충남 아산시 가상길 1", "충남 아산시 가상길 1"),
        ("가상볼트", None, "충남 아산시 가상길 1"),
        ("가상볼트", None, None),
        ("가상볼트", "   ", None),
    ],
)
def test_partial_or_missing_identity_is_not_removed_as_existing(
    web_context, name, address, known_address
):
    existing(address=known_address)
    saved = saved_web(candidate(name, address))
    assert registered(judgment(saved.candidate_ids[0])) == set()
    assert len(rows(Customer)) == 1 and not rows(MergeCandidate)


def test_same_existing_company_in_several_web_rows_returns_each_web_id(web_context):
    existing()
    saved = saved_web(candidate(), candidate("(주)가상볼트", "충남 아산시 가상길1"))
    selected = [judgment(key) for key in saved.candidate_ids]
    assert registered(*selected) == set(saved.candidate_ids)
    assert len(rows(Customer)) == 1


def test_existing_virtual_company_does_not_hide_a_real_candidate(web_context):
    existing()
    with session_scope() as session:
        batch = session.get(IngestBatch, BATCH)
        batch.dataset_kind, batch.is_virtual = "BROCHURE", False
        settings = read_app_settings(session)
        settings.active_dataset_kind = DatasetKind.BROCHURE
        sync_app_settings(session, settings)
        session.add(
            Process(
                process_id="real-zinc",
                code="ZINC_PLATING",
                name="전기아연도금",
                review_status="REVIEWED",
                dataset_kind="BROCHURE",
                is_virtual=False,
            )
        )
    saved = saved_web(candidate())
    assert registered(judgment(saved.candidate_ids[0])) == set()
    # 검수 전환 전후의 실제 고객은 한 회사로 본다. 가상 고객만 분리한다.
    existing("real-company", is_virtual=False, dataset_kind="COMPANY_CONFIRMED")
    assert registered(judgment(saved.candidate_ids[0])) == set(saved.candidate_ids)


def test_existing_real_company_does_not_hide_a_virtual_candidate(web_context):
    existing(is_virtual=False, dataset_kind="BROCHURE")
    saved = saved_web(candidate())
    assert registered(judgment(saved.candidate_ids[0])) == set()


def ranked_new_example():
    """후속 호출자가 기존 정렬과 조합하는 예. 실제 등록·전체 실행을 대신하지 않는다."""
    existing()
    saved_web(
        candidate(),
        candidate("가상너트", "충남 천안시 가상길 2"),
        candidate("가상브라켓", "충남 서산시 가상길 3"),
    )
    with session_scope() as session:
        ids = {row.company_name: row.candidate_id for row in session.scalars(select(WebCandidate))}
    selected = [
        judgment(ids["가상볼트"], fitLevel="HIGH"),
        judgment(ids["가상너트"], fitLevel="LOW"),
        judgment(ids["가상브라켓"], fitLevel="HIGH"),
    ]
    known = registered(*selected)
    remaining = rank_candidates([item for item in selected if item.row_id not in known])
    return ids, known, remaining


def test_known_company_is_removed_before_ranking_and_limiting(web_context):
    ids, known, remaining = ranked_new_example()
    assert known == {ids["가상볼트"]}
    assert [item.row_id for item in remaining[:1]] == [ids["가상브라켓"]]
    assert [item.row_id for item in remaining] == [ids["가상브라켓"], ids["가상너트"]]
    assert len(rows(Customer)) == 1 and not rows(Opportunity)


@pytest.mark.parametrize(
    "invalid", ["expired", "disabled", "dataset", "dropped", "different_query"]
)
def test_invalid_web_context_is_not_treated_as_a_new_company(web_context, invalid):
    saved = saved_web(candidate())
    with session_scope() as session:
        if invalid == "expired":
            session.get(WebSearchRun, saved.run_id).expires_at = utcnow() - timedelta(seconds=1)
        elif invalid == "disabled":
            settings = read_app_settings(session)
            settings.candidate_web_search.enabled = False
            sync_app_settings(session, settings)
        elif invalid == "dataset":
            session.get(WebCandidate, saved.candidate_ids[0]).dataset_kind = "BROCHURE"
        elif invalid == "dropped":
            session.get(WebCandidate, saved.candidate_ids[0]).dropped_reason = "확인 필요"
        else:
            batch = session.get(IngestBatch, BATCH)
            batch.criteria = batch.criteria | {"regions": ["대전"]}
    with pytest.raises(InputError):
        registered(judgment(saved.candidate_ids[0]))
    assert not rows(Customer)


def test_wrong_source_ids_duplicate_ids_and_unknown_source_are_rejected(web_context):
    assert registered() == set()
    with pytest.raises(AppError):
        registered(judgment("row-a"))
    saved = saved_web(candidate())
    selected = judgment(saved.candidate_ids[0])
    with pytest.raises(InputError):
        registered(selected, selected)
    for invalid in ("other", None, []):
        with pytest.raises(InputError), session_scope() as session:
            registered_row_ids(session, BATCH, [], source_kind=invalid)


def test_factory_default_keeps_its_existing_company_check(web_context):
    existing()
    with session_scope() as session:
        assert registered_row_ids(session, BATCH, [judgment()]) == {"row-a"}


def test_existing_company_check_keeps_judgment_attached_to_original_web_candidate(web_context):
    existing()
    saved = saved_web(candidate())
    selected = judgment(saved.candidate_ids[0])
    plan = prepare_candidate_judgments(
        BATCH,
        saved.candidate_ids,
        process_catalog={"ZINC_PLATING": "아연도금", "ANODIZING": "아노다이징"},
        industry_catalog=["자동차 부품"],
        prompt="가상 공개 후보 판단",
        source_kind="WEB",
    )
    save_candidate_judgments(
        plan, json.dumps([selected.model_dump(by_alias=True)]), model="synthetic"
    )
    before = snapshot(CandidateJudgment)
    assert registered(selected) == set(saved.candidate_ids)
    assert snapshot(CandidateJudgment) == before
    assert before[0]["row_id"] is None
    assert before[0]["web_candidate_id"] == selected.row_id
