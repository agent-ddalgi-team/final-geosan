"""#366: 실제 CSV·임시 SQLite 연결. AI 사용량만 가상 값이며 HTTP 호출은 없다."""

from datetime import date
from decimal import Decimal

import pytest
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import event, select
from sqlalchemy.exc import SQLAlchemyError

from geosan.commands.cost import run_cost
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.errors import AppError, RunFailedError
from geosan.evidence.transfer import (
    TransferLog,
    finish_search,
    reserve_candidate_judgment,
    reserve_search,
)
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.factory_store import store_factory_csv
from geosan.opportunity.models import Customer, IngestBatch
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

scenarios("u3/ingest_storage.feature")
OLD = date(2025, 12, 31)
NEW = date(2026, 6, 30)


def public_file(tmp_path, *, changed=False, reverse=False):
    values = ["1,가상공장가,,볼트,충남 아산시 가상길 1", "2,가상공장나,,너트,충남 아산시 가상길 2"]
    if changed:
        values = [values[0].replace("볼트", "핀")]
    if reverse:
        values.reverse()
    path = tmp_path / "public.csv"
    path.write_text("순번,회사명,단지명,생산품,공장주소\n" + "\n".join(values), encoding="utf-8")
    return path


@given("이용 확인을 마친 소스와 실행 중인 가상 후보 찾기 회차가 있다", target_fixture="batch")
def running_batch(tmp_db, app_settings_path):
    settings = load_app_settings(app_settings_path)
    settings.llm.mode = "EXTERNAL"
    with session_scope() as session:
        sync_app_settings(session, settings)
        session.add(
            SourceContract(
                source_id=SOURCE_ID,
                source_name="가상 공장 파일",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=OLD,
                is_virtual=True,
            )
        )
        session.add(
            IngestBatch(
                batch_id="batch-scenario",
                source_id=SOURCE_ID,
                requested_by="park-lee",
                started_at=utcnow(),
                status="RUNNING",
                criteria={"regions": ["충남"]},
                is_virtual=True,
            )
        )
    return "batch-scenario"


@when("두 공장 원본을 저장하고 순서를 바꿔 다시 저장한다", target_fixture="stored")
def store_twice(batch, tmp_path):
    first = store_factory_csv(batch, public_file(tmp_path), OLD)
    second = store_factory_csv(batch, public_file(tmp_path, reverse=True), OLD)
    return first, second


@then("공장 행 번호가 유지되고 회사 등록과 회차 완료는 아직 하지 않는다")
def retained(stored, batch):
    first, second = stored
    assert first.row_ids == tuple(reversed(second.row_ids))
    with session_scope() as session:
        assert len(session.scalars(select(SourceFactoryRow)).all()) == 2
        assert session.scalars(select(Customer)).all() == []
        assert session.get(IngestBatch, batch).status == "RUNNING"


@when("기존 두 공장 중 한 곳의 생산품만 바꾼 새 파일을 저장한다", target_fixture="stored")
def store_changed(batch, tmp_path):
    first = store_factory_csv(batch, public_file(tmp_path), OLD)
    second = store_factory_csv(batch, public_file(tmp_path, changed=True), NEW)
    return first, second


@then("변경된 공장의 행 번호가 유지되고 빠진 공장은 삭제 대신 누락 날짜가 남는다")
def changed(stored):
    first, second = stored
    assert second.row_ids == (first.row_ids[0],)
    with session_scope() as session:
        updated = session.get(SourceFactoryRow, first.row_ids[0])
        assert updated.product == "핀" and updated.product_hash != first.csv.rows[0].product_hash
        missing = session.get(SourceFactoryRow, first.row_ids[1])
        assert missing.product == "너트" and missing.missing_since == NEW


@when("회차 호출의 사용량을 확정한 뒤 공개 행 저장 중 오류가 난다", target_fixture="ticket")
def failed_save(batch, tmp_path):
    ticket = reserve_candidate_judgment(batch, True)
    finish_search(ticket, 1000, 200, 0, None)

    def fail_save(*args):
        raise SQLAlchemyError("가상 저장 오류")

    event.listen(SourceFactoryRow, "before_insert", fail_save)
    try:
        with pytest.raises(RunFailedError):
            store_factory_csv(batch, public_file(tmp_path), OLD)
    finally:
        event.remove(SourceFactoryRow, "before_insert", fail_save)
    return ticket


@then("공개 행은 전부 취소되고 비용 명령에는 확정한 회차 비용이 남는다")
def cost_survives(ticket, batch):
    with session_scope() as session:
        assert session.scalars(select(SourceFactoryRow)).all() == []
        row = session.get(TransferLog, ticket.log_id)
        assert row.batch_id == batch and row.opp_id is None
        assert row.cost_usd == Decimal("0.004")
    output = []
    assert run_cost(None, output.append) == 0
    assert any("$0.004000" in line for line in output)


@then("원문 없이 저장 실패의 원인 분류와 문의 번호가 로그에 남는다")
def safe_failure_record(caplog):
    records = [
        row for row in caplog.records if row.getMessage().startswith("ingest.factory.failed.")
    ]
    assert len(records) == 1 and records[0].ref
    assert "sqlalchemy_error" in records[0].getMessage()
    assert "가상 저장 오류" not in caplog.text
    assert records[0].exc_info is None


@when("회차 호출의 사용량을 확정하지 않은 채 홈페이지 검색을 요청한다", target_fixture="failure")
def unconfirmed(batch):
    reserve_candidate_judgment(batch, True)
    with pytest.raises(AppError) as error:
        reserve_search("opp-scenario", True, None)
    return error.value


@then("사용량 미확정 오류를 알리고 검색 호출 수를 늘리지 않는다")
def blocked(failure):
    assert failure.kind == "USAGE_UNCONFIRMED"
    with session_scope() as session:
        rows = session.scalars(select(TransferLog)).all()
        assert sum(row.call_count for row in rows) == 1
        assert next(row for row in rows if row.purpose == "EXTERNAL_SEARCH").call_count == 0
