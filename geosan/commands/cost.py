"""검색과 추출이 함께 쓴 월 호출·토큰·비용을 보여 준다(C8)."""

import re
from datetime import UTC, datetime
from decimal import Decimal

import typer
from sqlalchemy import select

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, exit_code_for
from geosan.evidence.transfer import KST, TransferLog, accounted_cost
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope


def run_cost(month: str | None, echo=typer.echo) -> int:
    try:
        month = month or utcnow().astimezone(KST).strftime("%Y-%m")
        try:
            if not re.fullmatch(r"\d{4}-\d{2}", month):
                raise ValueError
            start = datetime.strptime(month, "%Y-%m").replace(tzinfo=KST)
            end = (
                start.replace(year=start.year + 1, month=1)
                if start.month == 12
                else start.replace(month=start.month + 1)
            )
        except ValueError:
            raise InputError("월은 YYYY-MM 형식으로 넣어 주세요.") from None
        with session_scope() as session:
            settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
            rows = session.scalars(
                select(TransferLog).where(
                    TransferLog.occurred_at >= start.astimezone(UTC),
                    TransferLog.occurred_at < end.astimezone(UTC),
                    TransferLog.purpose.in_(["EXTERNAL_SEARCH", "EXTERNAL_AI"]),
                )
            ).all()
        calls = sum(row.call_count for row in rows)
        confirmed_cost = sum((row.cost_usd or Decimal(0) for row in rows), Decimal(0))
        pending = [row for row in rows if row.call_count and row.cost_usd is None]
        cost = sum((accounted_cost(row, settings.llm) for row in rows), Decimal(0))
        estimated_cost = sum((accounted_cost(row, settings.llm) for row in pending), Decimal(0))
        input_tokens = sum(row.input_tokens or 0 for row in rows)
        output_tokens = sum(row.output_tokens or 0 for row in rows)
        rejected = sum(row.decision == "REJECTED" for row in rows)
        searches = sum(row.web_search_calls or 0 for row in rows)
        llm = settings.llm
        call_ratio = calls / llm.monthly_call_limit * 100 if llm.monthly_call_limit else 0
        cost_ratio = (
            float(cost) / llm.monthly_cost_limit_usd * 100 if llm.monthly_cost_limit_usd else 0
        )
        echo(
            f"{month} (한국 시간) 호출 {calls}/{llm.monthly_call_limit}회 "
            f"({call_ratio:.1f}%), 거부 {rejected}건"
        )
        echo(f"입력 {input_tokens}·출력 {output_tokens}토큰, 웹 검색 {searches}회")
        echo(f"확인된 비용 ${confirmed_cost:.6f}")
        if pending:
            echo(f"추정 비용 ${estimated_cost:.6f} (사용량 미확정 {len(pending)}건)")
        echo(f"한도 계산 비용 ${cost:.6f}/${llm.monthly_cost_limit_usd:.2f} ({cost_ratio:.1f}%)")
        if cost >= Decimal(str(llm.monthly_cost_limit_usd)) * Decimal(str(llm.cost_alert_ratio)):
            echo("알림: 이번 달 비용이 알림 기준에 도달했습니다.")
        if pending:
            echo(
                "사용량 미확정 호출이 있습니다. 실제 총비용은 미확인입니다. "
                "추정 비용을 포함해 한도를 계산하며, 필요할 때만 실제 사용량으로 정산합니다."
            )
            return 2
        return 0
    except AppError as error:
        echo(f"{error.message} {error.next_action}")
        return exit_code_for(error)
