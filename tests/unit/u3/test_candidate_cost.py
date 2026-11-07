"""#366: 회차 비용과 기존 홈페이지·추출 비용의 합산을 실제 SQLite로 검사."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Barrier

import pytest
from sqlalchemy import select

from geosan.commands.cost import run_cost
from geosan.config.errors import AppError, InputError, NotFoundError
from geosan.config.models import AppSetting
from geosan.evidence.reconciliation import list_unsettled, reconcile_usage
from geosan.evidence.transfer import (
    TransferLog,
    finish_search,
    reserve_candidate_judgment,
    reserve_extraction,
    reserve_search,
)
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import utcnow
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope


def logs():
    with session_scope() as session:
        return session.scalars(select(TransferLog).order_by(TransferLog.created_at)).all()


def settings(**values):
    with session_scope() as session:
        row = session.get(AppSetting, "llm")
        row.value = row.value | values


def test_batch_reference_and_requester_survive_usage_and_cost_command(ingest_batch):
    ticket = reserve_candidate_judgment(ingest_batch, True)
    (row,) = logs()
    assert (row.opp_id, row.batch_id, row.requested_by) == (None, ingest_batch, "park-lee")
    assert (row.purpose, row.kind, row.call_count, row.cost_usd) == (
        "EXTERNAL_AI",
        "PUBLIC_TEXT",
        1,
        None,
    )
    assert row.is_virtual
    assert (row.dataset_kind, row.session_ref) == ("VIRTUAL_REVIEWED", "test-session")
    finish_search(ticket, 1000, 200, 0, None)
    (row,) = logs()
    assert row.cost_usd == Decimal("0.004")
    assert (row.opp_id, row.batch_id) == (None, ingest_batch)
    output = []
    assert run_cost(None, output.append) == 0
    assert any("호출 1/1000회" in line for line in output)
    assert any("$0.004000" in line for line in output)
    with pytest.raises(AppError):
        finish_search(ticket, 1000, 200, 0, None)


@pytest.mark.parametrize("reserve", [reserve_search, reserve_extraction])
def test_unknown_batch_usage_blocks_other_purposes(ingest_batch, reserve):
    reserve_candidate_judgment(ingest_batch, True)
    args = ("opp-test", True, None) + (("park-lee",) if reserve == reserve_extraction else ())
    with pytest.raises(AppError) as error:
        reserve(*args)
    assert error.value.kind == "USAGE_UNCONFIRMED"
    assert [row.call_count for row in logs()] == [1, 0]
    assert run_cost(None, lambda _: None) == 2


def test_existing_usage_counts_toward_batch_monthly_limit_after_restart(ingest_batch):
    ticket = reserve_search("opp-test", True, None)
    finish_search(ticket, 1000, 200, 1, None)
    settings(monthlyCallLimit=1)
    dispose_engines()
    with pytest.raises(AppError) as error:
        reserve_candidate_judgment(ingest_batch, True)
    assert error.value.kind == "LLM_LIMIT"
    assert logs()[-1].batch_id == ingest_batch and logs()[-1].call_count == 0


def test_batch_cost_and_calls_block_later_search(ingest_batch):
    ticket = reserve_candidate_judgment(ingest_batch, True)
    finish_search(ticket, 1000, 200, 0, None)
    settings(monthlyCostLimitUsd=0.004)
    with pytest.raises(AppError) as error:
        reserve_search("opp-test", True, None)
    assert error.value.kind == "LLM_LIMIT"


@pytest.mark.parametrize("key_present,changes", [(False, {}), (True, {"mode": "NONE"})])
def test_rejection_is_recorded_against_batch_without_call(ingest_batch, key_present, changes):
    settings(**changes)
    with pytest.raises(AppError) as error:
        reserve_candidate_judgment(ingest_batch, key_present)
    assert error.value.kind == "LLM_NOT_CONFIGURED"
    (row,) = logs()
    assert (row.batch_id, row.opp_id, row.call_count, row.decision) == (
        ingest_batch,
        None,
        0,
        "REJECTED",
    )


@pytest.mark.parametrize("status", ["DONE", "FAILED"])
def test_finished_batch_cannot_reserve(ingest_batch, status):
    with session_scope() as session:
        session.get(IngestBatch, ingest_batch).status = status
    with pytest.raises(AppError) as error:
        reserve_candidate_judgment(ingest_batch, True)
    assert error.value.status == 409
    assert logs() == []


def test_missing_or_invalid_batch_never_creates_fake_opportunity(tmp_db):
    with pytest.raises(NotFoundError):
        reserve_candidate_judgment("missing", True)
    for value in [None, "", "  ", 1]:
        with pytest.raises(InputError):
            reserve_candidate_judgment(value, True)
    assert logs() == []


def test_manual_reconciliation_preserves_batch_and_unblocks(ingest_batch):
    ticket = reserve_candidate_judgment(ingest_batch, True)
    with session_scope() as session:
        session.get(TransferLog, ticket.log_id).occurred_at = utcnow() - timedelta(minutes=11)
    assert [row.transfer_log_id for row in list_unsettled(timedelta(minutes=10))] == [ticket.log_id]
    reconcile_usage(
        ticket.log_id,
        age=timedelta(minutes=10),
        input_tokens=1000,
        output_tokens=200,
        web_search_calls=0,
        cost_usd=Decimal("0.004"),
        staff_key="park-lee",
    )
    (row,) = logs()
    assert row.batch_id == ingest_batch and row.opp_id is None
    assert row.reconciled_by == "park-lee" and row.cost_usd == Decimal("0.004")
    assert reserve_candidate_judgment(ingest_batch, True).log_id != ticket.log_id


def test_concurrent_reservations_cannot_bypass_pending_usage(ingest_batch):
    barrier = Barrier(2)

    def reserve():
        barrier.wait(timeout=10)
        try:
            return reserve_candidate_judgment(ingest_batch, True)
        except AppError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert sum(isinstance(value, AppError) for value in results) == 1
    assert (
        next(value for value in results if isinstance(value, AppError)).kind == "USAGE_UNCONFIRMED"
    )
    assert sorted(row.call_count for row in logs()) == [0, 1]
