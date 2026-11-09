"""#523: 공장등록 확인된 웹 후보의 등록·기존 값 보존. 외부 호출은 없다."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.config.errors import AppError
from geosan.evaluation.models import EvaluationRun, ItemJudgmentInput
from geosan.opportunity.candidate_registration import RegistrationResult, register_candidates
from geosan.opportunity.candidate_web import CandidateSearchResult, load_search_context
from geosan.opportunity.candidate_web_results import WebSearchCandidate
from geosan.opportunity.importer import import_case
from geosan.opportunity.judgment_store import (
    prepare_candidate_judgments,
    save_candidate_judgments,
)
from geosan.opportunity.models import (
    Customer,
    DiscoveryPath,
    IngestBatch,
    MergeCandidate,
    Opportunity,
    OppProcessLink,
)
from geosan.opportunity.source_models import (
    CandidateJudgment,
    SourceContract,
    WebCandidate,
    WebSearchRun,
)
from geosan.opportunity.web_candidate_store import save_web_search
from geosan.storage.base import utcnow
from geosan.storage.engine import get_engine
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u3.test_candidate_registration import (
    API,
    BATCH,
    CSV,
    existing,
    judgment,
    rows,
    snapshot,
)
from tests.unit.u3.test_candidate_registration import registration_context as registration_context


@pytest.fixture
def web_context(registration_context):
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.candidate_web_search.enabled = True
        sync_app_settings(session, settings)
        session.get(IngestBatch, BATCH).max_candidates = settings.ingestion.max_candidates
    return registration_context


def saved_candidates(*candidates, statuses=None):
    candidates = candidates or (
        WebSearchCandidate(
            "가상볼트", "충남 아산시 가상길 1", "https://bolt.example/products", "볼트"
        ),
    )
    context = load_search_context(BATCH)
    now = utcnow()
    result = CandidateSearchResult(
        tuple(candidates), 0, context.criteria_hash, now, now + timedelta(days=context.cache_days)
    )
    return save_web_search(BATCH, result, registry_statuses=statuses or ["FOUND"] * len(candidates))


def register_web(*judgments):
    with session_scope() as session:
        return register_candidates(session, BATCH, judgments, source_kind="WEB")


def test_confirmed_web_candidate_keeps_web_source_and_registry_status(web_context):
    saved = saved_candidates()
    selected = judgment(saved.candidate_ids[0])
    assert register_web(selected) == RegistrationResult(1, 0, 0)
    (customer,) = rows(Customer)
    assert customer.discovery_source == "WEB_SEARCH"
    assert customer.discovery_source_url == "https://bolt.example/products"
    assert customer.registry_status == "FOUND"
    assert customer.pick_reason == selected.reason and customer.fit_level == selected.fit_level
    assert customer.relation_status == "UNCONFIRMED"
    assert customer.main_phone is customer.homepage_url is None
    assert customer.dataset_kind == "VIRTUAL_REVIEWED" and customer.is_virtual
    assert customer.created_by == "park-lee" and customer.session_ref == "registration-session"
    (opportunity,) = rows(Opportunity)
    assert opportunity.item == "볼트" and opportunity.card_reason == selected.reason
    (path,) = rows(DiscoveryPath)
    assert path.source_id == "WEB_SEARCH" and path.origin_key == saved.candidate_ids[0]
    assert {link.process_code for link in rows(OppProcessLink)} == set(selected.process_codes)
    assert all(link.source == "AI" and link.state == "PENDING" for link in rows(OppProcessLink))
    assert not rows(EvaluationRun) and not rows(ItemJudgmentInput)
    assert rows(IngestBatch)[0].new_count == 0
    assert rows(IngestBatch)[0].status == "RUNNING"


@pytest.mark.parametrize("original_source", ["CASE_FILE", "FACTORY_FILE", "FACTORY_API"])
def test_existing_company_preserves_every_field_and_repeat_does_not_duplicate(
    web_context, original_source
):
    existing(
        discovery_source=original_source, pick_reason="담당자가 적은 기존 이유", fit_level="LOW"
    )
    selected = judgment(saved_candidates().candidate_ids[0])
    before = snapshot(Customer)
    assert register_web(selected) == RegistrationResult(0, 1, 0)
    assert register_web(selected) == RegistrationResult(0, 1, 0)
    assert snapshot(Customer) == before
    assert not rows(Opportunity) and not rows(MergeCandidate)


@pytest.mark.parametrize(
    "name,address",
    [("가상볼트", "충남 당진시 다른길 2"), ("가상다른회사", "충남 아산시 가상길 1")],
)
def test_ambiguous_company_keeps_existing_values_and_pending_pair(web_context, name, address):
    existing(name=name, address=address)
    before = snapshot(Customer)
    selected = judgment(saved_candidates().candidate_ids[0])
    assert register_web(selected) == RegistrationResult(1, 0, 1)
    assert snapshot(Customer)[0] == before[0]
    (pair,) = rows(MergeCandidate)
    assert pair.status == "PENDING" and "확인 필요" in pair.match_basis
    assert pair.customer_id_a == "existing"
    assert register_web(selected) == RegistrationResult(0, 1, 0)
    assert len(rows(Customer)) == 2 and len(rows(MergeCandidate)) == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("registry_status", "NOT_FOUND"),
        ("address", None),
        ("address", " "),
        ("address", "대전광역시 가상길 1"),
        ("snippet", None),
        ("snippet", " "),
        ("snippet", "가" * (Opportunity.__table__.c.item.type.length + 1)),
        ("source_url", "https://jobs.jobkorea.co.kr/ad"),
        ("source_url", "https://bolt.example/?mail=a%40example.invalid"),
        ("snippet", "대표자 홍길동"),
        ("dataset_kind", "BROCHURE"),
        ("is_virtual", False),
        ("dropped_reason", "EXCLUDED"),
    ],
)
def test_invalid_web_candidate_rejects_the_whole_selection(web_context, field, value):
    saved = saved_candidates(
        WebSearchCandidate("가상볼트", "충남 아산시 가상길 1", "https://bolt.example/a", "볼트"),
        WebSearchCandidate("가상너트", "충남 아산시 가상길 2", "https://bolt.example/b", "너트"),
    )
    with session_scope() as session:
        row = session.get(WebCandidate, saved.candidate_ids[1])
        setattr(row, field, value)
        row.homepage_url = "https://bolt.example/"  # 주소만 있다고 공식 확인을 대신하지 않는다.
    with pytest.raises(AppError):
        register_web(*(judgment(key) for key in saved.candidate_ids))
    assert not rows(Customer) and not rows(Opportunity) and not rows(OppProcessLink)


@pytest.mark.parametrize("source_id", [CSV, API])
def test_revoked_source_permission_blocks_registration(web_context, source_id):
    selected = judgment(saved_candidates().candidate_ids[0])
    with session_scope() as session:
        session.get(SourceContract, source_id).confirmed_at = None
    with pytest.raises(AppError):
        register_web(selected)
    assert not rows(Customer)


@pytest.mark.parametrize("changed", ["expired", "disabled", "region", "done"])
def test_expired_or_changed_context_cannot_register(web_context, changed):
    saved = saved_candidates()
    with session_scope() as session:
        batch = session.get(IngestBatch, BATCH)
        if changed == "expired":
            session.get(WebSearchRun, saved.run_id).expires_at = utcnow() - timedelta(seconds=1)
        elif changed == "disabled":
            settings = read_app_settings(session)
            settings.candidate_web_search.enabled = False
            sync_app_settings(session, settings)
        elif changed == "region":
            batch.criteria = batch.criteria | {"regions": ["대전"]}
        else:
            batch.status = "DONE"
    with pytest.raises(AppError):
        register_web(judgment(saved.candidate_ids[0]))
    assert not rows(Customer)


@pytest.mark.parametrize(
    "changes",
    [
        {"isManufacturer": False, "processCodes": []},
        {"processCodes": ["ANODIZING"]},
        {"reason": "담당자 홍길동"},
        {"ownPlatingLineSuspected": True, "ownPlatingLineBasis": "홍길동 과장"},
    ],
)
def test_unselected_or_personal_judgment_cannot_register(web_context, changes):
    key = saved_candidates().candidate_ids[0]
    with pytest.raises(AppError):
        register_web(judgment(key, **changes))
    assert not rows(Customer)


def test_surface_treatment_flag_is_preserved_without_excluding_candidate(web_context):
    key = saved_candidates().candidate_ids[0]
    assert (
        register_web(
            judgment(key, ownPlatingLineSuspected=True, ownPlatingLineBasis="자체 도금 설비")
        ).new_count
        == 1
    )
    (row,) = rows(Customer)
    assert row.own_plating_line_suspected and row.own_plating_line_source == "AI"
    assert row.own_plating_line_basis == "자체 도금 설비"


def test_storage_failure_rolls_back_company_and_links_without_retry(web_context):
    selected = judgment(saved_candidates().candidate_ids[0])
    attempts = []

    def fail(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO opp_process_link"):
            attempts.append(statement)
            raise OperationalError("synthetic", {}, RuntimeError("synthetic"))

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(OperationalError):
            register_web(selected)
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    assert len(attempts) == 1
    assert not rows(Customer) and not rows(Opportunity) and not rows(DiscoveryPath)


def test_concurrent_web_registration_creates_one_company(web_context):
    selected = judgment(saved_candidates().candidate_ids[0])
    barrier = Barrier(2)

    def register():
        barrier.wait(timeout=10)
        return register_web(selected)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [future.result() for future in [pool.submit(register), pool.submit(register)]]
    assert sum(r.new_count for r in results) == sum(r.skipped_count for r in results) == 1
    assert len(rows(Customer)) == len(rows(Opportunity)) == 1


def test_web_judgment_keeps_its_original_foreign_key_after_registration(web_context):
    saved = saved_candidates()
    selected = judgment(saved.candidate_ids[0])
    plan = prepare_candidate_judgments(
        BATCH,
        saved.candidate_ids,
        process_catalog={"ZINC_PLATING": "ZINC_PLATING", "ANODIZING": "ANODIZING"},
        industry_catalog=["자동차 부품"],
        prompt="가상 검사",
        source_kind="WEB",
    )
    save_candidate_judgments(
        plan, json.dumps([selected.model_dump(by_alias=True)]), model="synthetic"
    )
    before = snapshot(CandidateJudgment)
    assert register_web(selected).new_count == 1
    assert snapshot(CandidateJudgment) == before
    assert before[0]["row_id"] is None and before[0]["web_candidate_id"] == selected.row_id


def test_web_company_is_unscored_after_real_evaluation_and_api_read(
    web_context, capability_file_path
):
    import_capability(capability_file_path)
    selected = judgment(saved_candidates().candidate_ids[0])
    assert register_web(selected).new_count == 1
    (opportunity,) = rows(Opportunity)
    assert run_evaluation(opp_ids=[opportunity.opp_id]).ok
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities")
        assert response.status_code == 200
        (card,) = response.json()["data"]
        assert card["discoverySource"] == "WEB_SEARCH"
        assert card["discoverySourceUrl"] == "https://bolt.example/products"
        assert card["registryStatus"] == "FOUND"
        assert card["classificationCode"] == "NOT_EVALUATED"
        assert card["scoreDisplay"] == "--" and card["scoreState"] == "NONE"
        assert card["pickReason"] == selected.reason
    assert not rows(ItemJudgmentInput)


def test_existing_18_cards_scores_and_order_are_unchanged(
    web_context, tmp_path, capability_file_path
):
    import_capability(capability_file_path)
    for index in range(18):
        case = factories.apjeong_renamed_customer(f"old-{index}", f"기존가상기업{index}")
        case["customer"]["address"] = f"충남 천안시 기존가상길 {index}"
        import_case(_write(tmp_path, f"old-{index}.json", case))
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        before = client.get("/api/v1/opportunities", params={"pageSize": 50}).json()["data"]
        customers, evaluations = snapshot(Customer), snapshot(EvaluationRun)
        saved = saved_candidates(
            WebSearchCandidate(
                "기존가상기업0", "충남 천안시 기존가상길 0", "https://bolt.example/old", "볼트"
            ),
            WebSearchCandidate(
                "가상볼트", "충남 아산시 가상길 1", "https://bolt.example/new", "볼트"
            ),
        )
        assert register_web(*(judgment(key) for key in saved.candidate_ids)) == RegistrationResult(
            1, 1, 0
        )
        assert client.get("/api/v1/opportunities", params={"pageSize": 50}).json()["data"] == before
    assert len(before) == 18
    assert snapshot(Customer)[:18] == customers and snapshot(EvaluationRun) == evaluations


def test_empty_selection_unknown_source_and_factory_ids_are_not_silently_accepted(web_context):
    assert register_web() == RegistrationResult(0, 0, 0)
    with pytest.raises(AppError):
        register_web(judgment("row-a"))
    for invalid in ("other", None, []):
        with pytest.raises(AppError), session_scope() as session:
            register_candidates(session, BATCH, [], source_kind=invalid)


def test_duplicate_company_in_one_web_selection_is_registered_once(web_context):
    saved = saved_candidates(
        WebSearchCandidate(
            "가상볼트", "충청남도 아산시 가상길 1", "https://bolt.example/a", "볼트"
        ),
        WebSearchCandidate(
            "(주)가상볼트", "충청남도 아산시 가상길 1", "https://bolt.example/b", "너트"
        ),
    )
    assert register_web(*(judgment(key) for key in saved.candidate_ids)) == RegistrationResult(
        1, 1, 0
    )
    assert len(rows(Customer)) == len(rows(Opportunity)) == 1
