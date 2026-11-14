"""#426: 가상 공개 판단과 실제 SQLite로 등록·보존·트랜잭션을 검사한다."""

import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.exc import OperationalError

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.capability.models import Process
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evaluation.models import EvaluationRun, ItemJudgmentInput
from geosan.opportunity.candidate_judgments import CandidateJudgment
from geosan.opportunity.candidate_registration import (
    RegistrationResult,
    refresh_registered_candidates,
    register_candidates,
)
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import (
    Customer,
    DiscoveryPath,
    IngestBatch,
    MergeCandidate,
    Opportunity,
    OppProcessLink,
)
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.engine import get_engine
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

CSV = "kicox-factory-csv"
API = "kicox-production-api"
BATCH = "registration-test"
COMMON = {"dataset_kind": "VIRTUAL_REVIEWED", "is_virtual": True}


def public_row(row_id="row-a", **changes):
    values = dict(
        row_id=row_id,
        source_id=CSV,
        company_name="가상볼트",
        address="충남 아산시 가상길 1",
        region="충남",
        product="볼트",
        product_hash=hashlib.sha256("볼트".encode()).hexdigest(),
        file_date=date(2025, 12, 31),
        loaded_at=utcnow(),
        **COMMON,
    )
    return SourceFactoryRow(**(values | changes))


def judgment(row_id="row-a", **changes):
    return CandidateJudgment.model_validate(
        dict(
            rowId=row_id,
            isManufacturer=True,
            processCodes=["ZINC_PLATING", "ANODIZING"],
            industries=["자동차 부품"],
            reason="볼트를 생산해 아연도금 확인이 필요함",
            fitLevel="HIGH",
            ownPlatingLineSuspected=False,
            ownPlatingLineBasis=None,
        )
        | changes
    )


@pytest.fixture
def registration_context(tmp_db):
    with session_scope() as session:
        for source in (CSV, API):
            session.add(
                SourceContract(
                    source_id=source,
                    source_name="가상 공개 자료",
                    allowed_use="검사",
                    allowed_storage="검사",
                    confirmed_at=date(2026, 1, 1),
                )
            )
        session.add(
            IngestBatch(
                batch_id=BATCH,
                source_id=CSV,
                requested_by="park-lee",
                started_at=utcnow(),
                status="RUNNING",
                criteria={"regions": ["충남"], "processCodes": ["ZINC_PLATING"], "industries": []},
                session_ref="registration-session",
                **COMMON,
            )
        )
        for code in ("ZINC_PLATING", "ANODIZING"):
            session.add(
                Process(process_id=code, code=code, name=code, review_status="REVIEWED", **COMMON)
            )
        session.add(public_row())
    return tmp_db


def rows(model):
    with session_scope() as session:
        return list(session.scalars(select(model)))


def register(*judgments):
    with session_scope() as session:
        return register_candidates(session, BATCH, judgments or [judgment()])


def existing(customer_id="existing", *, name="가상볼트", address="충남 아산시 가상길 1", **changes):
    with session_scope() as session:
        session.add(
            Customer(
                **(
                    dict(
                        customer_id=customer_id,
                        name=name,
                        normalized_name=normalize_name(name),
                        address=address,
                        normalized_address=normalize_address(address),
                        relation_status="EXISTING_CONFIRMED",
                        security_grade="PUBLIC",
                        discovery_source="CASE_FILE",
                        **COMMON,
                    )
                    | changes
                )
            )
        )


def snapshot(model):
    return [
        {column.name: getattr(row, column.name) for column in model.__table__.columns}
        for row in rows(model)
    ]


def test_registers_public_fields_ai_links_and_no_evaluation_or_contacts(registration_context):
    assert register() == RegistrationResult(1, 0, 0)
    (customer,) = rows(Customer)
    (opportunity,) = rows(Opportunity)
    assert (customer.name, customer.address) == ("가상볼트", "충남 아산시 가상길 1")
    assert customer.relation_status == "UNCONFIRMED" and customer.security_grade == "PUBLIC"
    assert customer.discovery_source == "FACTORY_FILE" and customer.ingest_batch_id == BATCH
    assert customer.fit_level == "HIGH" and customer.pick_reason == judgment().reason
    assert customer.industries == ["자동차 부품"] and customer.industries_source == "AI"
    assert customer.ingested_at.tzinfo and customer.industries_confirmed_at is None
    assert customer.main_phone is customer.main_phone_source is customer.homepage_url is None
    assert customer.created_by == "park-lee" and customer.session_ref == "registration-session"
    assert customer.dataset_kind == "VIRTUAL_REVIEWED" and customer.is_virtual
    assert opportunity.customer_id == customer.customer_id and opportunity.item == "볼트"
    links = rows(OppProcessLink)
    assert {link.process_code for link in links} == {"ZINC_PLATING", "ANODIZING"}
    assert all(
        link.source == "AI" and link.state == "PENDING" and link.confirmed_at is None
        for link in links
    )
    (path,) = rows(DiscoveryPath)
    assert (path.source_id, path.origin_key, path.opp_id) == (CSV, "row-a", opportunity.opp_id)
    assert not rows(EvaluationRun) and not rows(ItemJudgmentInput)
    (batch,) = rows(IngestBatch)
    assert batch.status == "RUNNING" and batch.new_count == 0


@pytest.mark.parametrize("biz_number", [None, "1234567890"])
def test_exact_match_preserves_every_existing_customer_field(registration_context, biz_number):
    existing(
        name="(주) 가상볼트",
        address="충남  아산시 가상길 1",
        biz_number=biz_number,
        fit_level="LOW",
        pick_reason="기존 담당자 값",
        industries=["반도체"],
        industries_source="STAFF",
    )
    before = snapshot(Customer)
    assert register() == RegistrationResult(0, 1, 0)
    assert snapshot(Customer) == before and not rows(Opportunity) and not rows(MergeCandidate)


@pytest.mark.parametrize(
    "name,address",
    [
        ("가상볼트", "충남 당진시 다른길 2"),
        ("가상볼트공업", "충남 아산시 가상길 1"),
    ],
)
def test_partial_identity_is_pending_pair_without_merging(registration_context, name, address):
    existing(name=name, address=address)
    before = snapshot(Customer)[0]
    assert register() == RegistrationResult(1, 0, 1)
    assert snapshot(Customer)[0] == before
    (pair,) = rows(MergeCandidate)
    assert pair.customer_id_a == "existing" and pair.customer_id_b != "existing"
    assert pair.status == "PENDING" and "확인 필요" in pair.match_basis
    assert pair.batch_id == BATCH and pair.decided_at is pair.decided_by is None
    assert register() == RegistrationResult(0, 1, 0)
    assert len(rows(MergeCandidate)) == 1 and len(rows(Customer)) == 2


def test_csv_precedes_api_and_duplicates_in_same_call_are_skipped(registration_context):
    with session_scope() as session:
        session.add(public_row("api-copy", source_id=API, file_date=None))
    assert register(judgment("api-copy"), judgment()) == RegistrationResult(1, 1, 0)
    assert rows(Customer)[0].discovery_source == "FACTORY_FILE"
    assert rows(DiscoveryPath)[0].origin_key == "row-a"


@pytest.mark.parametrize(
    "ai,industry,words,expected",
    [
        (True, None, [], "AI"),
        (False, "금속 도금업", ["도금업"], "INDUSTRY_NAME"),
        (False, "금속 도금업", [], None),
        (True, "금속 도금업", ["도금업"], "AI"),
    ],
)
def test_surface_flag_uses_ai_or_configured_industry_without_exclusion(
    registration_context, ai, industry, words, expected
):
    with session_scope() as session:
        row = session.get(SourceFactoryRow, "row-a")
        row.source_id, row.industry_name = API, industry
        settings = session.get(AppSetting, "ingestion")
        settings.value = settings.value | {"aiPick": {"surfaceTreatmentIndustryNames": words}}
    assert (
        register(
            judgment(
                ownPlatingLineSuspected=ai, ownPlatingLineBasis="자체 도금 설비" if ai else None
            )
        ).new_count
        == 1
    )
    (customer,) = rows(Customer)
    assert customer.discovery_source == "FACTORY_API"
    assert customer.own_plating_line_source == expected
    assert customer.own_plating_line_suspected is bool(expected)
    assert customer.own_plating_line_basis == (
        "자체 도금 설비" if ai else f"공장등록 업종명: {industry}" if expected else None
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"missing_since": utcnow()},
        {"region": "대전"},
        {"dataset_kind": "BROCHURE"},
        {"is_virtual": False},
        {"product_hash": "stale"},
        {"source_id": "unapproved"},
        {"company_name": ""},
        {"address": " "},
        {"company_name": "contact@example.invalid"},
    ],
)
def test_invalid_public_row_rejects_entire_registration(registration_context, changes):
    with session_scope() as session:
        session.add(public_row("bad", company_name="가상다른회사", address="충남 아산시 다른길 2"))
        session.flush()
        row = session.get(SourceFactoryRow, "bad")
        for key, value in changes.items():
            setattr(row, key, value)
    with pytest.raises(AppError):
        register(judgment(), judgment("bad"))
    assert not rows(Customer) and not rows(Opportunity)


@pytest.mark.parametrize(
    "changes",
    [
        {"isManufacturer": False},
        {"processCodes": ["UNKNOWN"]},
        {"processCodes": ["ANODIZING"]},
        {"industries": ["unknown"]},
        {"industries": ["자동차 부품"] * 4},
    ],
)
def test_unselected_or_invalid_judgments_are_not_registered(registration_context, changes):
    with pytest.raises(AppError):
        register(judgment(**changes))
    assert not rows(Customer)


def test_other_dataset_is_not_an_existing_company(registration_context):
    existing(dataset_kind="BROCHURE", is_virtual=False)
    assert register() == RegistrationResult(1, 0, 0)
    assert len(rows(Customer)) == 2 and not rows(MergeCandidate)


def test_caller_failure_rolls_back_registration_and_batch_together(registration_context):
    with pytest.raises(RuntimeError, match="집계 실패"):
        with session_scope() as session:
            result = register_candidates(session, BATCH, [judgment()])
            session.get(IngestBatch, BATCH).new_count = result.new_count
            session.flush()
            raise RuntimeError("집계 실패")
    assert not rows(Customer) and not rows(OppProcessLink) and rows(IngestBatch)[0].new_count == 0


def test_storage_failure_is_not_hidden_and_preserves_existing_company(registration_context):
    existing(address="충남 아산시 다른길 2")
    before = snapshot(Customer)

    def fail(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO opp_merge_candidate"):
            raise OperationalError("synthetic", {}, RuntimeError("synthetic"))

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(OperationalError):
            register()
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    assert snapshot(Customer) == before and not rows(Opportunity) and not rows(MergeCandidate)


def test_empty_selection_and_finished_batch(registration_context):
    with session_scope() as session:
        assert register_candidates(session, BATCH, []) == RegistrationResult(0, 0, 0)
        session.get(IngestBatch, BATCH).status = "DONE"
    with pytest.raises(AppError):
        register()


def test_missing_row_duplicate_id_and_revoked_source_are_rejected(registration_context):
    for selected in ([judgment("missing")], [judgment(), judgment()]):
        with pytest.raises(AppError):
            register(*selected)
    with session_scope() as session:
        session.get(SourceContract, CSV).confirmed_at = None
    with pytest.raises(AppError):
        register()
    assert not rows(Customer)


def test_concurrent_registration_does_not_duplicate_company(registration_context):
    barrier = Barrier(2)

    def attempt():
        barrier.wait(timeout=10)
        return register()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [future.result() for future in [pool.submit(attempt), pool.submit(attempt)]]
    assert sum(result.new_count for result in results) == 1
    assert sum(result.skipped_count for result in results) == 1
    assert len(rows(Customer)) == len(rows(Opportunity)) == 1


def test_existing_18_api_cards_scores_and_ranks_are_preserved(
    registration_context, tmp_path, capability_file_path
):
    import_capability(capability_file_path)
    for index in range(18):
        case = factories.apjeong_renamed_customer(f"old-{index}", f"기존가상기업{index}")
        case["customer"]["address"] = f"충남 천안시 기존가상길 {index}"
        import_case(_write(tmp_path, f"old-{index}.json", case))
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities", params={"pageSize": 50})
        assert response.status_code == 200, response.text
        before = response.json()["data"]
        saved_evaluations = snapshot(EvaluationRun)
        saved_customers = snapshot(Customer)
        assert len(before) == 18
        with session_scope() as session:
            session.add(
                public_row("old", company_name="기존가상기업0", address="충남 천안시 기존가상길 0")
            )
        assert register(judgment("old"), judgment()) == RegistrationResult(1, 1, 0)
        response = client.get("/api/v1/opportunities", params={"pageSize": 50})
        assert response.status_code == 200, response.text
        after = response.json()["data"]
    assert after == before and snapshot(EvaluationRun) == saved_evaluations
    assert snapshot(Customer)[:18] == saved_customers
    assert len(rows(Customer)) == len(rows(Opportunity)) == 19
    # 새 회사의 평가 전 기록과 카드 생성은 #427이 담당한다. 이 함수는 평가하지 않는다.


@pytest.mark.parametrize("virtual", [False, True])
def test_new_company_gets_factory_profile_only_for_real_batches(
    registration_context, tmp_path, virtual
):
    """#573: Given 같은 이름·주소의 팩토리온 행 / When 등록 / Then 실제 회차 회사에만 붙는다."""
    from tests.unit.u3 import test_factory_profile as profile

    with session_scope() as session:
        # 회차와 공장 행은 같은 자료 묶음이어야 등록된다.
        session.get(IngestBatch, BATCH).is_virtual = virtual
        session.get(SourceFactoryRow, "row-a").is_virtual = virtual
    profile._store(
        tmp_path,
        [profile.row(**{"회사명": "가상볼트", "공장주소(도로명)": "충남 아산시 가상길 1"})],
    )
    assert register() == RegistrationResult(1, 0, 0)
    (customer,) = rows(Customer)
    if virtual:
        assert customer.factory_profile_date is None and not customer.own_plating_line_suspected
    else:
        assert customer.factory_employee_count == 12 and customer.factory_scale == "소기업"
        assert customer.own_plating_line_source == "INDUSTRY_CODE"


def refresh(*judgments):
    with session_scope() as session:
        return refresh_registered_candidates(session, BATCH, judgments)


NEWER = dict(reason="볼트 냉간단조로 아연도금 외주 가능성", fitLevel="MEDIUM")


def test_refresh_moves_latest_reason_and_fit_to_ai_found_company(registration_context):
    """#615: AI가 올린 회사만 추천 이유·적합도·카드 문장을 최신 판단으로 바꾼다."""
    register()
    (opportunity,) = rows(Opportunity)
    links = snapshot(OppProcessLink)
    assert refresh(judgment(**NEWER, processCodes=["ZINC_PLATING"])) == [opportunity.opp_id]
    (customer,) = rows(Customer)
    assert (customer.pick_reason, customer.fit_level) == (NEWER["reason"], "MEDIUM")
    assert rows(Opportunity)[0].card_reason == NEWER["reason"]
    # 산업군·공정 연결·거래 관계는 이번 범위가 아니다.
    assert customer.industries == ["자동차 부품"] and customer.relation_status == "UNCONFIRMED"
    assert snapshot(OppProcessLink) == links


def test_refresh_keeps_case_file_company_and_hand_written_card_sentence(registration_context):
    """#615: 사례 파일 회사는 그대로, 손으로 고친 카드 문장도 그대로 둔다."""
    existing(fit_level="LOW", pick_reason="기존 담당자 값")
    before = snapshot(Customer)
    assert refresh(judgment(**NEWER)) == []
    assert snapshot(Customer) == before

    with session_scope() as session:
        session.add(public_row("row-b", company_name="가상너트", address="충남 아산시 가상길 2"))
    register(judgment("row-b"))
    with session_scope() as session:
        session.scalars(select(Opportunity)).one().card_reason = "담당자가 고친 문장"
    refresh(judgment("row-b", **NEWER))
    assert rows(Opportunity)[0].card_reason == "담당자가 고친 문장"
    assert {row.pick_reason for row in rows(Customer)} == {"기존 담당자 값", NEWER["reason"]}


def test_refresh_ignores_non_manufacturer_and_unregistered_rows(registration_context):
    """#615: "제조업 아님"으로 바뀐 판단과 목록에 없는 회사는 건드리지 않는다."""
    register()
    before = snapshot(Customer)
    assert refresh(judgment(isManufacturer=False, reason="", fitLevel="LOW")) == []
    with session_scope() as session:
        session.add(public_row("row-b", company_name="가상너트", address="충남 아산시 가상길 2"))
    assert refresh(judgment("row-b", **NEWER)) == []
    assert snapshot(Customer) == before and len(rows(Opportunity)) == 1


def test_refresh_prefers_file_row_when_file_and_lookup_rows_match(registration_context):
    """#615: 같은 회사가 파일·조회 양쪽에 있으면 등록 때처럼 파일 행 판단을 쓴다(C5)."""
    register()
    with session_scope() as session:
        session.add(public_row("row-api", source_id=API))
    refresh(judgment("row-api", reason="조회 행 판단", fitLevel="LOW"), judgment(**NEWER))
    assert rows(Customer)[0].pick_reason == NEWER["reason"]
