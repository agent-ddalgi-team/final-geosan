"""#317 담당자·조건을 확인하고 실행 중 회차를 하나만 예약한다."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.deps import require_staff, runtime_for
from geosan.api.ingest_conditions import IngestRequest, validate_ingest_conditions
from geosan.capability.models import Process
from geosan.config.errors import AppError
from geosan.opportunity.ingest_preview import ingest_budget, over_budget_error
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import new_id, utcnow


def reserve_ingest_batch(
    session: Session,
    body: IngestRequest,
    *,
    staff_key: str | None,
) -> IngestBatch:
    """담당자·조건 검사 뒤 실행 중 회차를 하나만 저장한다. 확정·실행 예약은 호출자 책임이다.

    SQLite 쓰기 잠금을 먼저 잡아 두 요청이 동시에 빈 회차 목록을 읽는 일을 막는다.
    DB의 단일 RUNNING 제약도 유지하며 저장 실패를 성공·중복 요청으로 바꾸지 않는다.
    호출자가 같은 세션의 트랜잭션을 확정한 뒤에만 찾기 실행을 예약해야 한다.
    """
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    staff = require_staff(session, staff_key)
    runtime = runtime_for(session)
    dataset_kind = runtime.app_settings.active_dataset_kind.value
    codes = session.scalars(select(Process.code).where(Process.dataset_kind == dataset_kind))
    prepared = validate_ingest_conditions(
        body, settings=runtime.app_settings, available_process_codes=set(codes)
    )
    running = session.scalar(
        select(IngestBatch.batch_id).where(IngestBatch.status == "RUNNING").limit(1)
    )
    if running is not None:
        raise AppError(
            "지금 가져오는 중입니다.",
            "현재 찾기가 끝난 뒤 다시 눌러 주세요.",
            status=409,
            kind="INGEST_RUNNING",
        )
    # 화면 잠금만 믿지 않고 회차를 만들기 전에 같은 계산을 다시 한다(C1 #549).
    budget = ingest_budget(
        session,
        process_codes=prepared.process_codes,
        regions=prepared.regions,
        industries=prepared.industries,
        max_candidates=prepared.max_candidates,
        settings=runtime.app_settings,
    )
    if budget.blocked is not None:
        raise over_budget_error()
    now = utcnow()
    batch = IngestBatch(
        batch_id=new_id("batch"),
        source_id=prepared.source_id,
        requested_by=staff,
        started_at=now,
        status="RUNNING",
        criteria={
            "processCodes": list(prepared.process_codes),
            "regions": prepared.regions,
            "industries": prepared.industries,
        },
        max_candidates=prepared.max_candidates,
        rejudge=False,
        estimated_usd=budget.estimate.total_usd,
        dataset_kind=dataset_kind,
        is_virtual=dataset_kind == "VIRTUAL_REVIEWED",
        created_at=now,
        created_by=staff,
    )
    session.add(batch)
    session.flush()
    return batch
