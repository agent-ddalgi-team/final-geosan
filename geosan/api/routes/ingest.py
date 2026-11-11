"""#317 회차 접수 창구. 실행 함수는 연결하는 쪽에서 명시적으로 전달한다."""

import logging
from collections.abc import Callable
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, Query, Request
from pydantic import Field, ValidationError
from sqlalchemy import select

from geosan.api.deps import SessionDep, get_session, require_staff, runtime_for
from geosan.api.ingest_batches import reserve_ingest_batch
from geosan.api.ingest_conditions import IngestRequest, validate_ingest_conditions
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.capability.models import Process
from geosan.config.errors import AppError, InputError, RunFailedError, new_ref
from geosan.opportunity.ingest_preview import preview_counts
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


class FitCounts(_ApiModel):
    """적합도별 맞는 공장 수. 칸 이름은 코드값 그대로(HIGH·MEDIUM·LOW)."""

    high: int = Field(alias="HIGH", ge=0)
    medium: int = Field(alias="MEDIUM", ge=0)
    low: int = Field(alias="LOW", ge=0)


class IngestPreview(_ApiModel):
    """C1 GET /ingest/preview의 숫자 칸(#549 1단계). 예상 금액·잠금 칸은 2단계에서 더한다."""

    matched_count: int = Field(ge=0, description="맞는 공장 수(제조업 + 고른 공정·산업)")
    fit_counts: FitCounts
    registered_count: int = Field(ge=0, description="그중 이미 영업 후보로 들어온 곳")
    addable_count: int = Field(ge=0, description="아직 안 들어온 곳")
    addable_high_count: int = Field(ge=0)
    unjudged_count: int = Field(ge=0, description="고른 지역의 공장 중 판단이 없거나 낡은 곳")
    add_count: int = Field(ge=0, description="지금 누르면 더할 최대 곳 수")


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

    @router.get("/ingest/preview", response_model=Envelope[IngestPreview])
    def ingest_preview(
        session: SessionDep,
        process_codes: Annotated[list[str], Query(alias="processCodes")] = [],  # noqa: B006
        regions: Annotated[list[str], Query()] = [],  # noqa: B006
        industries: Annotated[list[str], Query()] = [],  # noqa: B006
    ):
        """고른 조건의 맞는 공장 수를 저장된 판단으로만 센다. 외부 호출·저장 없음, 키 없이 읽음."""
        runtime = runtime_for(session)
        dataset_kind = runtime.app_settings.active_dataset_kind.value
        try:
            body = IngestRequest.model_validate(
                {"processCodes": process_codes, "regions": regions, "industries": industries}
            )
        except ValidationError:
            raise InputError(
                "찾기 조건을 확인해 주세요.", "공정을 하나 이상 골라 주세요."
            ) from None
        codes = session.scalars(select(Process.code).where(Process.dataset_kind == dataset_kind))
        prepared = validate_ingest_conditions(
            body, settings=runtime.app_settings, available_process_codes=set(codes)
        )
        counts = preview_counts(
            session,
            process_codes=prepared.process_codes,
            regions=prepared.regions,
            industries=prepared.industries,
            max_candidates=prepared.max_candidates,
            dataset_kind=dataset_kind,
        )
        data = IngestPreview(
            matched_count=counts.matched_count,
            fit_counts=FitCounts(
                HIGH=counts.fit_counts["HIGH"],
                MEDIUM=counts.fit_counts["MEDIUM"],
                LOW=counts.fit_counts["LOW"],
            ),
            registered_count=counts.registered_count,
            addable_count=counts.addable_count,
            addable_high_count=counts.addable_high_count,
            unjudged_count=counts.unjudged_count,
            add_count=counts.add_count,
        )
        return Envelope[IngestPreview](data=data, meta=Meta(dataset_kind=dataset_kind))

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
