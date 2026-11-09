"""#499: 웹 검색 보관과 같은 AI 판단 부품의 실DB 연결. 외부 통신만 가상이다."""

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from threading import Barrier

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import AppError, InputError, RunFailedError
from geosan.opportunity import candidate_pick, candidate_web
from geosan.opportunity import web_candidate_store as store
from geosan.opportunity.candidate_judgments import candidate_product_hash
from geosan.opportunity.models import Customer, IngestBatch
from geosan.opportunity.source_models import (
    CandidateJudgment,
    SourceFactoryRow,
    WebCandidate,
    WebSearchRun,
)
from geosan.storage.engine import dispose_engines, get_engine
from geosan.storage.session import session_scope
from tests.fakes.web_candidate_search import BATCH, logs, settings
from tests.fakes.web_candidate_storage import setup_web_storage


@pytest.fixture
def ready(tmp_db, app_settings_path, monkeypatch):
    return setup_web_storage(app_settings_path, monkeypatch)


def searched():
    result = candidate_web.search_candidates(BATCH)
    saved = store.save_web_search(BATCH, result, registry_statuses=["FOUND"])
    return result, saved


def test_saved_result_and_judgments_are_reused_after_reopening_database(ready):
    result, saved = searched()
    picked = candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    dispose_engines()
    cached = store.find_cached_web_search(BATCH)
    assert cached.candidate_ids == saved.candidate_ids and cached.from_cache
    again = candidate_pick.pick_candidates(BATCH, cached.candidate_ids, source_kind="WEB")
    assert again == picked and len(ready["search"]) == len(ready["pick"]) == 1
    with session_scope() as session:
        row = session.get(WebCandidate, saved.candidate_ids[0])
        judgment = session.scalar(select(CandidateJudgment))
        run = session.get(WebSearchRun, saved.run_id)
        assert row.snippet == "볼트와 너트 생산" and row.registry_status == "FOUND"
        assert judgment.row_id is None and judgment.web_candidate_id == row.candidate_id
        assert judgment.product_hash == candidate_product_hash(row.snippet, None)
        assert run.searched_at == result.searched_at and run.expires_at == result.expires_at
        assert session.scalar(select(func.count()).select_from(SourceFactoryRow)) == 0
        assert session.scalar(select(func.count()).select_from(Customer)) == 0
        assert session.get(IngestBatch, BATCH).status == "RUNNING"
    payload = json.loads(ready["pick"][0]["input"])[0]
    assert payload == {
        "rowId": saved.candidate_ids[0],
        "companyName": "가상볼트",
        "complexName": None,
        "product": "볼트와 너트 생산",
        "industryName": None,
        "address": "충남 아산시",
    }
    assert "PRIVATE_INTERNAL_MARKER" not in json.dumps(ready, ensure_ascii=False)
    assert [row.cost_usd for row in logs()] == [Decimal("0.014"), Decimal("0.004")]


def test_same_result_is_stored_once_and_empty_success_is_reusable(ready):
    result, saved = searched()
    duplicate = store.save_web_search(BATCH, result, registry_statuses=["FOUND"])
    assert duplicate.candidate_ids == saved.candidate_ids and duplicate.from_cache
    with session_scope() as session:
        session.get(IngestBatch, BATCH).criteria = {
            "processCodes": ["ZN"],
            "regions": ["대전"],
            "industries": [],
        }
    assert store.find_cached_web_search(BATCH) is None
    context = candidate_web.load_search_context(BATCH)
    empty = replace(result, candidates=(), criteria_hash=context.criteria_hash)
    store.save_web_search(BATCH, empty, registry_statuses=[])
    cached = store.find_cached_web_search(BATCH)
    assert cached.candidate_ids == () and cached.from_cache
    assert len(ready["search"]) == 1


def test_expiry_and_shortened_retention_do_not_extend_cache(ready, monkeypatch):
    result, saved = searched()
    monkeypatch.setattr(store, "utcnow", lambda: result.expires_at - timedelta(microseconds=1))
    assert store.find_cached_web_search(BATCH).run_id == saved.run_id
    monkeypatch.setattr(store, "utcnow", lambda: result.expires_at)
    assert store.find_cached_web_search(BATCH) is None
    with pytest.raises(InputError):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    settings(cacheDays=1)
    monkeypatch.setattr(store, "utcnow", lambda: result.searched_at + timedelta(days=2))
    assert store.find_cached_web_search(BATCH) is None
    assert not ready["pick"]


def test_changed_snippet_or_rejudge_requires_new_judgment_but_registry_change_keeps_web_key(ready):
    _, saved = searched()

    def pick():
        return candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")

    pick()
    with session_scope() as session:
        row = session.get(WebCandidate, saved.candidate_ids[0])
        row.registry_status = "NOT_FOUND"
    pick()
    assert len(ready["pick"]) == 1
    with session_scope() as session:
        session.get(WebCandidate, saved.candidate_ids[0]).snippet = "자동차용 너트 생산"
    pick()
    with session_scope() as session:
        session.get(IngestBatch, BATCH).rejudge = True
    pick()
    assert len(ready["pick"]) == 3
    with session_scope() as session:
        assert all(
            row.row_id is None and row.web_candidate_id == saved.candidate_ids[0]
            for row in session.scalars(select(CandidateJudgment))
        )


def test_unconfirmed_registry_status_contacts_and_stale_settings_are_not_saved(ready):
    result = candidate_web.search_candidates(BATCH)
    for statuses in [[], [None], ["UNCONFIRMED"], [[]]]:
        with pytest.raises(InputError):
            store.save_web_search(BATCH, result, registry_statuses=statuses)
    for text in ["연락 a@example.com", "대표자 홍길동", "010-1234-5678"]:
        unsafe = replace(result, candidates=(replace(result.candidates[0], snippet=text),))
        with pytest.raises(InputError):
            store.save_web_search(BATCH, unsafe, registry_statuses=["FOUND"])
    settings(blockedDomains=["bolt.example"])
    with pytest.raises(InputError):
        store.save_web_search(BATCH, result, registry_statuses=["FOUND"])
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(WebSearchRun)) == 0
        assert session.scalar(select(func.count()).select_from(WebCandidate)) == 0
    assert logs()[0].cost_usd == Decimal("0.014")


def test_missing_rows_are_an_error_and_other_conditions_do_not_authorize_ids(ready):
    _, saved = searched()
    with session_scope() as session:
        original = session.get(IngestBatch, BATCH).criteria
        session.get(IngestBatch, BATCH).criteria = original | {"regions": ["대전"]}
    assert store.find_cached_web_search(BATCH) is None
    with pytest.raises(InputError):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    with session_scope() as session:
        session.get(IngestBatch, BATCH).criteria = original
        session.delete(session.get(WebCandidate, saved.candidate_ids[0]))
    with pytest.raises(RunFailedError):
        store.find_cached_web_search(BATCH)
    assert not ready["pick"]


def test_nullable_address_and_snippet_use_same_judgment_without_inventing_text(ready):
    result = candidate_web.search_candidates(BATCH)
    result = replace(
        result, candidates=(replace(result.candidates[0], address=None, snippet=None),)
    )
    saved = store.save_web_search(BATCH, result, registry_statuses=["NOT_FOUND"])
    candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    payload = json.loads(ready["pick"][0]["input"])[0]
    assert payload["product"] is None and payload["address"] is None


def test_search_store_failure_rolls_back_both_tables_and_keeps_cost(ready, tmp_db):
    result = candidate_web.search_candidates(BATCH)
    engine = get_engine(tmp_db)

    def fail(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO src_web_candidate"):
            raise SQLAlchemyError("PRIVATE_DATABASE_MARKER")

    event.listen(engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(RunFailedError) as error:
            store.save_web_search(BATCH, result, registry_statuses=["FOUND"])
        assert "PRIVATE_DATABASE_MARKER" not in str(error.value)
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(WebSearchRun)) == 0
        assert session.scalar(select(func.count()).select_from(WebCandidate)) == 0
    assert logs()[0].cost_usd == Decimal("0.014")


def test_source_changed_during_ai_call_rejects_judgment_and_keeps_cost(ready, monkeypatch):
    _, saved = searched()
    original = candidate_pick._post

    def change(*args):
        answer = original(*args)
        with session_scope() as session:
            session.get(
                WebCandidate, saved.candidate_ids[0]
            ).source_url = "https://bolt.example/changed"
        return answer

    monkeypatch.setattr(candidate_pick, "_post", change)
    with pytest.raises(InputError):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(CandidateJudgment)) == 0
    assert [row.cost_usd for row in logs()] == [Decimal("0.014"), Decimal("0.004")]


def test_web_ids_cannot_be_passed_as_public_factory_ids(ready):
    _, saved = searched()
    with pytest.raises(AppError):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids)
    settings(enabled=False)
    assert store.find_cached_web_search(BATCH) is None
    with pytest.raises(InputError):
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    assert not ready["pick"]


def test_concurrent_result_saves_keep_one_run_and_same_candidate_ids(ready):
    result = candidate_web.search_candidates(BATCH)
    barrier = Barrier(2)

    def save(_):
        barrier.wait(timeout=10)
        return store.save_web_search(BATCH, result, registry_statuses=["FOUND"])

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, range(2)))
    assert results[0].candidate_ids == results[1].candidate_ids
    assert sorted(r.from_cache for r in results) == [False, True]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(WebSearchRun)) == 1


def test_person_name_in_ai_reason_is_rejected_before_judgment_storage(ready, monkeypatch):
    _, saved = searched()
    original = candidate_pick._post

    def named(*args):
        data = original(*args)
        content = data["output"][0]["content"][0]
        rows = json.loads(content["text"])
        rows[0]["reason"] = "담당자 홍길동의 설명"
        content["text"] = json.dumps(rows, ensure_ascii=False)
        return data

    monkeypatch.setattr(candidate_pick, "_post", named)
    with pytest.raises(AppError) as error:
        candidate_pick.pick_candidates(BATCH, saved.candidate_ids, source_kind="WEB")
    assert error.value.kind == "LLM_FAILED"
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(CandidateJudgment)) == 0
    assert logs()[-1].cost_usd == Decimal("0.004")
