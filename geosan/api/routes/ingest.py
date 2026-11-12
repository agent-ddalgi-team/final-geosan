"""#317 회차 접수 창구. 실행 함수는 연결하는 쪽에서 명시적으로 전달한다."""

import logging
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import asdict
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Header, Query, Request
from pydantic import Field, ValidationError
from sqlalchemy import select

from geosan.api.deps import SessionDep, get_session, require_staff, runtime_for
from geosan.api.ingest_batches import reserve_ingest_batch
from geosan.api.ingest_conditions import IngestRequest, validate_ingest_conditions
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.capability.models import Process
from geosan.config.errors import AppError, InputError, RunFailedError, new_ref
from geosan.opportunity.ingest_preview import ingest_budget, read_month_usage
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


class IngestEstimate(_ApiModel):
    """지금 누르면 들 것으로 보는 호출 수와 금액(달러, 추정). 단가는 설정 ingestion.costEstimate."""

    judge_rows: int = Field(ge=0, description="AI가 새로 판단할 공장 수(판단 전 수)")
    judge_calls: int = Field(ge=0)
    judge_usd: float = Field(ge=0)
    research_count: int = Field(ge=0, description="자동 조사할 곳 수(자동 조사가 꺼져 있으면 0)")
    research_calls: int = Field(ge=0)
    research_usd: float = Field(ge=0)
    web_search_usd: float = Field(ge=0, description="같은 조건의 저장된 웹 검색 결과가 있으면 0")
    total_usd: float = Field(ge=0)


class IngestMonth(_ApiModel):
    """이번 달(한국 시간) 사용액·호출 수와 한도. 전송 보호의 월 합과 같은 계산이다."""

    used_usd: float = Field(ge=0)
    limit_usd: float = Field(ge=0)
    used_calls: int = Field(ge=0)
    limit_calls: int = Field(ge=0)


class IngestBlocked(_ApiModel):
    """예상 금액이 이번 달 남은 한도를 넘어 단추를 잠가야 하는 이유."""

    kind: Literal["OVER_COST", "OVER_CALLS"]
    judgeable_rows: int = Field(ge=0, description="남은 금액·호출로 판단할 수 있는 공장 수")


class IngestPreview(_ApiModel):
    """C1 GET /ingest/preview(#549). 조건 없이 부르면 month만 채우고 나머지는 null이다."""

    matched_count: int | None = Field(ge=0, description="맞는 공장 수(제조업 + 고른 공정·산업)")
    fit_counts: FitCounts | None
    registered_count: int | None = Field(ge=0, description="그중 이미 영업 후보로 들어온 곳")
    addable_count: int | None = Field(ge=0, description="아직 안 들어온 곳")
    addable_high_count: int | None = Field(ge=0)
    unjudged_count: int | None = Field(
        ge=0, description="고른 지역의 공장 중 판단이 없거나 낡은 곳"
    )
    add_count: int | None = Field(ge=0, description="지금 누르면 더할 최대 곳 수")
    estimate: IngestEstimate | None
    month: IngestMonth
    blocked: IngestBlocked | None = Field(description="한도를 넘지 않으면 null")


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
        """고른 조건의 맞는 공장 수와 예상 금액을 저장된 자료로만 센다. 외부 호출·저장 없음."""
        runtime = runtime_for(session)
        settings = runtime.app_settings
        dataset_kind = settings.active_dataset_kind.value
        meta = Meta(dataset_kind=dataset_kind)
        if not (process_codes or regions or industries):
            # [다시 조사]·[붙여넣고 조사]용: 이번 달 사용액만 돌려준다.
            month = IngestMonth(**asdict(read_month_usage(session, settings)))
            data = IngestPreview(
                matched_count=None,
                fit_counts=None,
                registered_count=None,
                addable_count=None,
                addable_high_count=None,
                unjudged_count=None,
                add_count=None,
                estimate=None,
                month=month,
                blocked=None,
            )
            return Envelope[IngestPreview](data=data, meta=meta)
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
            body, settings=settings, available_process_codes=set(codes)
        )
        budget = ingest_budget(
            session,
            process_codes=prepared.process_codes,
            regions=prepared.regions,
            industries=prepared.industries,
            max_candidates=prepared.max_candidates,
            settings=settings,
        )
        counts = budget.counts
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
            estimate=IngestEstimate(**asdict(budget.estimate)),
            month=IngestMonth(**asdict(budget.month)),
            blocked=IngestBlocked(**asdict(budget.blocked)) if budget.blocked else None,
        )
        return Envelope[IngestPreview](data=data, meta=meta)

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
