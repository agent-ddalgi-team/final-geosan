"""C4·C6. 전송 전에 호출을 기록하고 응답 뒤 사용량을 채운다. 본문은 저장하지 않는다."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Integer, Numeric, String, select
from sqlalchemy.orm import Mapped, mapped_column

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    LlmSettings,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError
from geosan.storage.base import Base, CommonColumns, UtcDateTime, new_id, utcnow
from geosan.storage.session import session_scope

KST = timezone(timedelta(hours=9))


class TransferLog(CommonColumns, Base):
    __tablename__ = "tg_transfer_log"

    transfer_log_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, index=True)
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
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


@dataclass(frozen=True)
class SearchTicket:
    log_id: str
    llm: LlmSettings


def record_search_rejection(opp_id: str, reason: str, db_path: Path | str | None) -> None:
    with session_scope(db_path) as session:
        session.add(
            TransferLog(
                transfer_log_id=new_id("transfer"),
                occurred_at=utcnow(),
                opp_id=opp_id,
                purpose="EXTERNAL_SEARCH",
                kind="WEB_SEARCH",
                mode="NONE",
                security_grade="UNKNOWN",
                decision="REJECTED",
                reject_reason=reason,
                call_count=0,
            )
        )


def reserve_search(opp_id: str, key_present: bool, db_path: Path | str | None) -> SearchTicket:
    """검사와 호출 수 증가를 같은 쓰기 잠금에서 처리한다. HTTP 중에는 잠금을 잡지 않는다."""
    now = utcnow()
    local = now.astimezone(KST)
    month_start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    error = None
    with session_scope(db_path) as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
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
            if row.kind == "WEB_SEARCH" and row.occurred_at >= day_start
        )
        cost = sum((row.cost_usd or Decimal(0) for row in rows), Decimal(0))
        minimum_search_cost = Decimal(str(llm.web_search_cost_per_thousand_calls)) / 1000
        if not settings.homepage_discovery.enabled or llm.mode != "EXTERNAL":
            error = AppError(
                "홈페이지 외부 검색이 꺼져 있습니다.", "앱 설정을 확인해 주세요.", status=503
            )
        elif not key_present:
            error = AppError(
                "OPENAI_API_KEY가 설정되지 않았습니다.",
                "실행 환경에 키를 설정해 주세요.",
                status=503,
            )
        elif (
            not llm.model
            or llm.model not in llm.allowed_models
            or min(
                llm.input_cost_per_million_tokens,
                llm.output_cost_per_million_tokens,
                llm.web_search_cost_per_thousand_calls,
            )
            <= 0
        ):
            error = AppError(
                "허용 모델과 입력·출력·검색 단가를 설정해 주세요.",
                "앱 설정을 확인해 주세요.",
                status=503,
            )
        elif daily_calls >= settings.homepage_discovery.daily_call_limit:
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
        elif any(row.cost_usd is None for row in rows):
            error = AppError(
                "앞선 호출의 사용량이 확인되지 않아 검색을 멈췄습니다.",
                "제공사 사용량과 전송 기록을 확인해 주세요.",
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
                purpose="EXTERNAL_SEARCH",
                kind="WEB_SEARCH",
                mode=llm.mode,
                model=llm.model,
                security_grade="PUBLIC",
                decision="REJECTED" if error else "ALLOWED",
                reject_reason=error.message if error else None,
                call_count=0 if error else 1,
            )
        )
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
