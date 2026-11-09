"""#317 회차 접수 창구. 실행 함수는 연결하는 쪽에서 명시적으로 전달한다."""

import logging
from collections.abc import Callable
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, Request
from pydantic import Field

from geosan.api.deps import get_session, require_staff
from geosan.api.ingest_batches import reserve_ingest_batch
from geosan.api.ingest_conditions import IngestRequest
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.errors import AppError, InputError, RunFailedError, new_ref
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

logger = logging.getLogger("geosan")


class IngestAccepted(_ApiModel):
    """C1 POST /ingest 접수 시점의 회차 번호·건수. 찾기 완료를 뜻하지 않는다."""

    batch_id: str
    new_count: int = Field(strict=True, ge=0)
    merge_candidate_count: int = Field(strict=True, ge=0)
    skipped_count: int = Field(strict=True, ge=0)


def _execute_batch(run_batch: Callable[[str], None], batch_id: str) -> None:
    """요청 세션이 닫힌 뒤 한 번 실행. 실패는 새 세션으로 회차에 남기고 재시도하지 않는다."""
    try:
        run_batch(batch_id)
        with session_scope() as session:
            batch = session.get(IngestBatch, batch_id)
            if batch is None or batch.status not in {"DONE", "FAILED"}:
                raise RunFailedError("후보 찾기의 완료 상태를 확인해 주세요.")
    except Exception as error:
        # 실행 흐름이 기록한 안전한 사유를 보존하고, 외부 예외 원문은 복사하지 않는다.
        # 실패 기록 자체를 저장하지 못하면 예외가 그대로 올라가며 성공으로 숨기지 않는다.
        with session_scope() as session:
            batch = session.get(IngestBatch, batch_id)
            if batch is None:
                raise RunFailedError("후보 찾기 회차를 확인해 주세요.") from None
            if batch.status != "FAILED" or not batch.failure_reason:
                batch.failure_reason = (
                    error.message
                    if isinstance(error, (InputError, RunFailedError))
                    else "후보 찾기를 끝내지 못했습니다. 다시 시도해 주세요."
                )
            batch.status = "FAILED"
            batch.finished_at = utcnow()
        logger.error("ingest.failed", extra={"batchId": batch_id, "ref": new_ref()})


def create_ingest_router(run_batch: Callable[[str], None] | None) -> APIRouter:
    """명세와 실제 경로를 함께 등록하고, 찾기 연결이 없으면 접수를 거부한다."""
    router = APIRouter()

    @router.post("/ingest", response_model=Envelope[IngestAccepted])
    def start_ingest(
        body: IngestRequest,
        background_tasks: BackgroundTasks,
        request: Request,
        staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
    ):
        with contextmanager(get_session)(request) as session:
            if run_batch is None:
                require_staff(session, staff_key)
                raise AppError(
                    "후보 찾기 실행 연결이 아직 준비되지 않았습니다.",
                    "연결이 준비된 뒤 다시 시도해 주세요.",
                    status=503,
                )
            batch = reserve_ingest_batch(session, body, staff_key=staff_key)
            data = IngestAccepted(
                batch_id=batch.batch_id,
                new_count=batch.new_count,
                merge_candidate_count=batch.merge_candidate_count,
                skipped_count=batch.skipped_count,
            )
            updated_at = batch.created_at
        # with 블록이 정상 종료돼 확정된 회차만 예약한다. 확정 실패면 여기까지 오지 않는다.
        background_tasks.add_task(_execute_batch, run_batch, data.batch_id)
        return Envelope[IngestAccepted](data=data, meta=Meta(updated_at=updated_at))

    return router
