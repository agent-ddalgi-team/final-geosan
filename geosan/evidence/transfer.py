"""C4·C6. 전송 전에 호출을 기록하고 응답 뒤 사용량을 채운다. 본문은 저장하지 않는다."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import CheckConstraint, Integer, Numeric, String, select
from sqlalchemy.orm import Mapped, mapped_column

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    LlmSettings,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, NotFoundError
from geosan.evidence.research_context import current_research
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import Base, CommonColumns, UtcDateTime, new_id, utcnow
from geosan.storage.session import session_scope

KST = timezone(timedelta(hours=9))


def configuration_error() -> AppError:
    """C4: 담당자가 재시도로 해결할 수 없는 조사 설정 오류."""
    return AppError(
        "AI 조사 설정이 아직 되어 있지 않습니다",
        "문의 번호와 함께 운영자에게 알려 주세요",
        status=503,
        kind="LLM_NOT_CONFIGURED",
    )


class TransferLog(CommonColumns, Base):
    """외부 호출 한 번의 기록. 이 표의 열은 PM 세션만 고친다.

    영업기회가 있는 호출은 opp_id, 회사가 목록에 들어오기 전의 후보 판단은 batch_id(회차 번호)를
    채운다. 둘 중 하나는 꼭 있어야 한다(#327, PM 결정 2026-11-06).
    """

    __tablename__ = "tg_transfer_log"
    __table_args__ = (
        CheckConstraint(
            "opp_id IS NOT NULL OR batch_id IS NOT NULL", name="ck_tg_transfer_log_ref"
        ),
    )

    transfer_log_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, index=True)
    opp_id: Mapped[str | None] = mapped_column(String(40))
    batch_id: Mapped[str | None] = mapped_column(String(40), index=True)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    model: Mapped[str | None] = mapped_column(String(80))
    security_grade: Mapped[str] = mapped_column(String(24), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    reject_reason: Mapped[str | None] = mapped_column(String(300))
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system")
    call_count: Mapped[int] = mapped_column(Integer, nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    web_search_calls: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    reconciled_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    reconciled_by: Mapped[str | None] = mapped_column(String(64))


@dataclass(frozen=True)
class SearchTicket:
    log_id: str
    llm: LlmSettings


def accounted_cost(row: TransferLog, llm: LlmSettings) -> Decimal:
    """실제 비용이 없을 때만 추정한다. 원본을 채우지 않아 나중에 실제 값으로 정산할 수 있다."""
    if not row.call_count:
        return Decimal(0)
    if row.cost_usd is not None:
        return row.cost_usd
    return Decimal(str(llm.unconfirmed_call_cost_usd)) * row.call_count


def record_search_rejection(
    opp_id: str, reason: str, db_path: Path | str | None, *, purpose: str = "EXTERNAL_SEARCH"
) -> None:
    with session_scope(db_path) as session:
        session.add(
            TransferLog(
                transfer_log_id=new_id("transfer"),
                occurred_at=utcnow(),
                opp_id=opp_id,
                purpose=purpose,
                kind="WEB_SEARCH" if purpose == "EXTERNAL_SEARCH" else "PUBLIC_TEXT",
                mode="NONE",
                security_grade="UNKNOWN",
                decision="REJECTED",
                reject_reason=reason,
                call_count=0,
            )
        )


def reserve_search(opp_id: str, key_present: bool, db_path: Path | str | None) -> SearchTicket:
    return _reserve(opp_id, key_present, db_path, "EXTERNAL_SEARCH", "system")


def reserve_extraction(
    opp_id: str, key_present: bool, db_path: Path | str | None, requested_by: str
) -> SearchTicket:
    return _reserve(opp_id, key_present, db_path, "EXTERNAL_AI", requested_by)


def reserve_candidate_judgment(
    batch_id: str, key_present: bool, db_path: Path | str | None = None
) -> SearchTicket:
    """후보 판단의 호출을 회차에 예약한다(C4·C6, #366). 본문 전송 승인은 별도다.

    응답 사용량은 기존 finish_search로 확정한다. 본문 검사·실제 HTTP 호출·재시도는
    후속 어댑터가 담당하며, 이 함수만 불렀다고 외부 전송이 승인된 것은 아니다.
    """
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise InputError("후보 찾기 회차 번호를 확인해 주세요.")
    return _reserve(None, key_present, db_path, "EXTERNAL_AI", "SYSTEM", batch_id=batch_id)


def reserve_candidate_search(
    batch_id: str, key_present: bool, db_path: Path | str | None = None
) -> SearchTicket:
    """C4·C9: 후보 웹 검색의 하루 한도는 별도, 월 호출·비용(미확정은 추정)은 공유한다."""
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise InputError("후보 찾기 회차 번호를 확인해 주세요.")
    return _reserve(None, key_present, db_path, "EXTERNAL_SEARCH", "SYSTEM", batch_id=batch_id)


def _reserve(
    opp_id: str | None,
    key_present: bool,
    db_path: Path | str | None,
    purpose: str,
    requested_by: str,
    *,
    batch_id: str | None = None,
) -> SearchTicket:
    """검사와 호출 수 증가를 같은 쓰기 잠금에서 처리한다. HTTP 중에는 잠금을 잡지 않는다."""
    now = utcnow()
    local = now.astimezone(KST)
    month_start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    error = None
    with session_scope(db_path) as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        batch = None
        if batch_id is not None:
            batch = session.get(IngestBatch, batch_id)
            if batch is None:
                raise NotFoundError("후보 찾기 회차를 찾을 수 없습니다.")
            if batch.status != "RUNNING":
                raise AppError(
                    "실행 중인 후보 찾기 회차가 아닙니다.",
                    "현재 찾기 상태를 확인해 주세요.",
                    status=409,
                )
            requested_by = batch.requested_by
        settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        llm = settings.llm
        rows = session.scalars(
            select(TransferLog).where(
                TransferLog.occurred_at >= month_start,
                TransferLog.purpose.in_(["EXTERNAL_SEARCH", "EXTERNAL_AI"]),
                TransferLog.call_count > 0,
            )
        ).all()
        daily_calls = sum(
            row.call_count
            for row in rows
            if row.kind == "WEB_SEARCH"
            and row.occurred_at >= day_start
            and (row.batch_id is not None) == (batch_id is not None)
        )
        cost = sum((accounted_cost(row, llm) for row in rows), Decimal(0))
        is_search = purpose == "EXTERNAL_SEARCH"
        search_enabled = (
            settings.candidate_web_search.enabled
            if batch_id
            else settings.homepage_discovery.enabled
        )
        daily_limit = (
            settings.candidate_web_search.daily_search_limit
            if batch_id
            else settings.homepage_discovery.daily_call_limit
        )
        minimum_search_cost = (
            Decimal(str(llm.web_search_cost_per_thousand_calls)) / 1000 if is_search else Decimal(0)
        )
        if (is_search and not search_enabled) or llm.mode != "EXTERNAL":
            error = configuration_error()
        elif not key_present:
            error = configuration_error()
        elif (
            not llm.model
            or llm.model not in llm.allowed_models
            or min(
                llm.input_cost_per_million_tokens,
                llm.output_cost_per_million_tokens,
                llm.web_search_cost_per_thousand_calls if is_search else 1,
            )
            <= 0
        ):
            error = configuration_error()
        elif is_search and daily_calls >= daily_limit:
            error = AppError(
                "오늘 검색 한도 초과",
                "다음 날 다시 조사해 주세요.",
                status=503,
                kind="SEARCH_LIMIT",
            )
        elif sum(row.call_count for row in rows) >= llm.monthly_call_limit:
            error = AppError(
                "이번 달 호출 한도 초과",
                "다음 달 다시 조사해 주세요.",
                status=503,
                kind="LLM_LIMIT",
            )
        elif cost + minimum_search_cost >= Decimal(str(llm.monthly_cost_limit_usd)):
            error = AppError(
                "이번 달 비용 한도 초과",
                "다음 달 다시 조사해 주세요.",
                status=503,
                kind="LLM_LIMIT",
            )
        log_id = new_id("transfer")
        session.add(
            TransferLog(
                transfer_log_id=log_id,
                occurred_at=now,
                opp_id=opp_id,
                batch_id=batch_id,
                purpose=purpose,
                kind="WEB_SEARCH" if is_search else "PUBLIC_TEXT",
                mode=llm.mode,
                model=llm.model,
                security_grade="PUBLIC",
                decision="REJECTED" if error else "ALLOWED",
                reject_reason=error.message if error else None,
                call_count=0 if error else 1,
                requested_by=requested_by,
                is_virtual=batch.is_virtual if batch is not None else False,
                dataset_kind=batch.dataset_kind if batch is not None else None,
                session_ref=batch.session_ref if batch is not None else None,
            )
        )
    context = current_research.get()
    if context is not None:
        context.log_ids.append(log_id)
    if error:
        raise error
    return SearchTicket(log_id, llm)


def finish_search(
    ticket: SearchTicket,
    input_tokens: int,
    output_tokens: int,
    web_search_calls: int,
    db_path: Path | str | None,
) -> None:
    """사용량은 홈페이지 저장과 별도로 확정한다. 같은 기록의 이중 정산은 거부한다."""
    if any(
        type(value) is not int or value < 0
        for value in (input_tokens, output_tokens, web_search_calls)
    ):
        raise ValueError("사용량은 0 이상의 정수여야 합니다.")
    prices = ticket.llm
    cost = (
        Decimal(input_tokens) * Decimal(str(prices.input_cost_per_million_tokens)) / 1_000_000
        + Decimal(output_tokens) * Decimal(str(prices.output_cost_per_million_tokens)) / 1_000_000
        + Decimal(web_search_calls) * Decimal(str(prices.web_search_cost_per_thousand_calls)) / 1000
    )
    with session_scope(db_path) as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        row = session.get(TransferLog, ticket.log_id)
        if row is None or row.cost_usd is not None:
            raise AppError(
                "사용량 기록을 확정할 수 없습니다.", "전송 기록을 확인해 주세요.", status=500
            )
        row.input_tokens = input_tokens
        row.output_tokens = output_tokens
        row.web_search_calls = web_search_calls
        row.cost_usd = cost
