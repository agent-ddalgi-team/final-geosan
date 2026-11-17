"""#390·#393: 실제 임시 SQLite로 공장등록 조회 한도와 AI 비용 분리를 검사한다."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from threading import Barrier

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from geosan.commands.cost import run_cost
from geosan.config.errors import AppError, InputError, NotFoundError
from geosan.config.models import AppSetting
from geosan.evidence import public_source
from geosan.evidence.public_source import FactoryRegistryLimitError, reserve_factory_registry
from geosan.evidence.reconciliation import list_unsettled
from geosan.evidence.transfer import TransferLog, finish_search, reserve_candidate_judgment
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.opportunity.source_models import SourceContract
from geosan.storage.base import new_id
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope

NOW = datetime(2026, 11, 7, 14, 59, 59, tzinfo=UTC)  # 한국 시간 11월 7일 23:59:59


@pytest.fixture
def registry(ingest_batch, monkeypatch):
    monkeypatch.setattr(public_source, "utcnow", lambda: NOW)
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id="kicox-production-api",
                source_name="가상 등록 조회",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
        session.add(
            Customer(
                customer_id="customer-test",
                name="가상공장",
                normalized_name="가상공장",
                relation_status="UNCONFIRMED",
                security_grade="PUBLIC",
                is_virtual=True,
            )
        )
        session.flush()
        session.add(
            Opportunity(
                opp_id="opp-test",
                customer_id="customer-test",
                item="가상 부품",
                purpose="NEW_PROPOSAL",
                is_virtual=True,
                dataset_kind="VIRTUAL_REVIEWED",
                session_ref="opp-session",
            )
        )
    return ingest_batch


def logs():
    with session_scope() as session:
        return session.scalars(select(TransferLog)).all()


def seed_calls(count, **changes):
    with session_scope() as session:
        for _ in range(count):
            values = dict(
                transfer_log_id=new_id("transfer"),
                occurred_at=NOW,
                batch_id="batch-test",
                purpose="PUBLIC_SOURCE",
                kind="FACTORY_REGISTRY",
                mode="NONE",
                security_grade="PUBLIC",
                decision="ALLOW",
                call_count=1,
                cost_usd=Decimal(0),
            )
            session.add(TransferLog(**(values | changes)))


def test_record_has_only_contract_metadata_and_survives_restart(registry):
    log_id = reserve_factory_registry(batch_id=registry)
    dispose_engines()
    (row,) = logs()
    assert row.transfer_log_id == log_id
    assert (row.batch_id, row.opp_id, row.requested_by, row.created_by) == (
        registry,
        None,
        "park-lee",
        "park-lee",
    )
    assert (row.purpose, row.kind, row.mode, row.model, row.security_grade) == (
        "PUBLIC_SOURCE",
        "FACTORY_REGISTRY",
        "NONE",
        None,
        "PUBLIC",
    )
    assert (row.decision, row.reject_reason, row.call_count, row.cost_usd) == (
        "ALLOW",
        None,
        1,
        Decimal(0),
    )
    assert (row.input_tokens, row.output_tokens, row.web_search_calls) == (None, None, None)
    assert (row.is_virtual, row.dataset_kind, row.session_ref) == (
        True,
        "VIRTUAL_REVIEWED",
        "test-session",
    )


def test_company_lookup_uses_real_opportunity_and_its_metadata(registry):
    reserve_factory_registry(opp_id="opp-test", requested_by="park-lee")
    (row,) = logs()
    assert (row.opp_id, row.batch_id, row.requested_by) == ("opp-test", None, "park-lee")
    assert (row.is_virtual, row.dataset_kind, row.session_ref) == (
        True,
        "VIRTUAL_REVIEWED",
        "opp-session",
    )


def test_batch_and_company_requests_share_1000_limit_even_after_restart(registry):
    seed_calls(500)
    seed_calls(499, batch_id=None, opp_id="opp-test")
    reserve_factory_registry(batch_id=registry)
    dispose_engines()
    for reference in ({"opp_id": "opp-test"}, {"batch_id": registry}):
        with pytest.raises(FactoryRegistryLimitError) as error:
            reserve_factory_registry(**reference)
        assert error.value.skipped_reason == "DAILY_LIMIT"
    rows = logs()
    assert sum(row.call_count for row in rows if row.decision == "ALLOW") == 1000
    rejected = [row for row in rows if row.decision == "REJECT"]
    assert len(rejected) == 2
    assert all(row.reject_reason == "DAILY_LIMIT" and row.call_count == 1 for row in rejected)


def test_kst_day_excludes_yesterday_tomorrow_rejections_and_ai(registry, monkeypatch):
    start = datetime(2026, 11, 6, 15, tzinfo=UTC)
    seed_calls(1000, occurred_at=start - timedelta(microseconds=1))
    seed_calls(999, occurred_at=start)
    seed_calls(1, occurred_at=start + timedelta(days=1))
    seed_calls(1, decision="REJECT", reject_reason="DAILY_LIMIT")
    seed_calls(1, purpose="EXTERNAL_AI", decision="ALLOWED")
    reserve_factory_registry(batch_id=registry)
    with pytest.raises(FactoryRegistryLimitError):
        reserve_factory_registry(batch_id=registry)
    monkeypatch.setattr(public_source, "utcnow", lambda: NOW + timedelta(seconds=1))
    reserve_factory_registry(batch_id=registry)


def test_two_requests_cannot_take_the_last_slot(registry):
    seed_calls(999)
    barrier = Barrier(2)

    def reserve():
        barrier.wait(timeout=10)
        try:
            return reserve_factory_registry(batch_id=registry)
        except FactoryRegistryLimitError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert sum(isinstance(value, FactoryRegistryLimitError) for value in results) == 1
    assert sum(row.call_count for row in logs() if row.decision == "ALLOW") == 1000


def test_public_calls_do_not_use_monthly_ai_limit_cost_or_unsettled_list(registry, monkeypatch):
    monkeypatch.setattr("geosan.evidence.transfer.utcnow", lambda: NOW)
    seed_calls(1000)
    with pytest.raises(FactoryRegistryLimitError):
        reserve_factory_registry(batch_id=registry)
    with session_scope() as session:
        setting = session.get(AppSetting, "llm")
        setting.value = setting.value | {"monthlyCallLimit": 1}
    output = []
    assert run_cost("2026-11", output.append) == 0
    assert "호출 0/1회" in output[0] and "거부 0건" in output[0]
    assert list_unsettled(timedelta(0)) == []
    ticket = reserve_candidate_judgment(registry, True)
    finish_search(ticket, 1000, 200, 0, None)
    output.clear()
    assert run_cost("2026-11", output.append) == 0
    assert "호출 1/1회" in output[0]
    assert any("$0.004000" in line for line in output)
    with pytest.raises(AppError) as error:
        reserve_candidate_judgment(registry, True)
    assert error.value.kind == "LLM_LIMIT"


@pytest.mark.parametrize("status", ["DONE", "FAILED"])
def test_closed_batch_cannot_add_call(registry, status):
    with session_scope() as session:
        session.get(IngestBatch, registry).status = status
    with pytest.raises(AppError) as error:
        reserve_factory_registry(batch_id=registry)
    assert error.value.status == 409
    assert logs() == []


@pytest.mark.parametrize("reference", [{"batch_id": "missing"}, {"opp_id": "missing"}])
def test_nonexistent_reference_cannot_create_log(registry, reference):
    with pytest.raises(NotFoundError):
        reserve_factory_registry(**reference)
    assert logs() == []


@pytest.mark.parametrize(
    "reference",
    [
        {},
        {"batch_id": "batch-test", "opp_id": "opp-test"},
        {"batch_id": ""},
        {"opp_id": "  "},
        {"batch_id": 1},
        {"opp_id": []},
        {"batch_id": "batch-test", "requested_by": ""},
    ],
)
def test_invalid_input_does_not_record_or_expose_input(registry, reference):
    with pytest.raises(InputError):
        reserve_factory_registry(**reference)
    assert logs() == []


@pytest.mark.parametrize("missing", [True, False])
def test_source_confirmation_is_required_before_recording(registry, missing):
    with session_scope() as session:
        source = session.get(SourceContract, "kicox-production-api")
        if missing:
            session.delete(source)
        else:
            source.confirmed_at = None
    with pytest.raises(InputError, match="이용·저장 확인"):
        reserve_factory_registry(batch_id=registry)
    assert logs() == []


def test_storage_failure_propagates_without_retry_or_a_reserved_call(registry):
    attempts = []

    def fail_commit(session):
        attempts.append(1)
        raise RuntimeError("가상 저장 실패")

    event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="가상 저장 실패"):
            reserve_factory_registry(batch_id=registry)
    finally:
        event.remove(Session, "before_commit", fail_commit)
    assert attempts == [1]
    assert logs() == []
