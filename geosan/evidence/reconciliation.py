"""제공사에서 확인한 사용량으로만 미확정 기록을 정산한다(C4·C6, #218)."""

import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import select

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import InputError
from geosan.evidence.transfer import TransferLog
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope


def parse_age(value: str) -> timedelta:
    try:
        if not re.fullmatch(r"[0-9]+m", value) or int(value[:-1]) < 10:
            raise ValueError
        age = timedelta(minutes=int(value[:-1]))
        utcnow() - age  # 날짜로 나타낼 수 없는 경과 시간도 입력 오류로 거부한다.
        return age
    except (ValueError, OverflowError):
        raise InputError("경과 시간은 10m 이상 정수 분으로 넣어 주세요. 예: 10m, 30m.") from None


def _unsettled_conditions(cutoff: datetime):
    return (
        TransferLog.purpose.in_(["EXTERNAL_SEARCH", "EXTERNAL_AI"]),
        TransferLog.mode == "EXTERNAL",
        TransferLog.decision == "ALLOWED",
        TransferLog.call_count > 0,
        TransferLog.cost_usd.is_(None),
        TransferLog.reconciled_at.is_(None),
        TransferLog.reconciled_by.is_(None),
        TransferLog.occurred_at <= cutoff,
    )


def list_unsettled(age: timedelta) -> list[TransferLog]:
    with session_scope() as session:
        return list(
            session.scalars(
                select(TransferLog)
                .where(*_unsettled_conditions(utcnow() - age))
                .order_by(TransferLog.occurred_at, TransferLog.transfer_log_id)
            )
        )


def reconcile_usage(
    log_id: str,
    *,
    age: timedelta,
    input_tokens: int,
    output_tokens: int,
    web_search_calls: int,
    cost_usd: Decimal,
    staff_key: str,
) -> None:
    """정상 응답 정산과 같은 쓰기 잠금으로 대상 재검사·정산·감사 기록을 묶는다."""
    if age < timedelta(minutes=10):
        raise InputError("호출 후 최소 10분이 지난 기록만 정리할 수 있습니다.")
    if any(
        type(value) is not int or not 0 <= value <= 2**63 - 1
        for value in (input_tokens, output_tokens, web_search_calls)
    ):
        raise InputError("토큰·웹 검색 횟수는 DB에 저장 가능한 0 이상의 정수로 넣어 주세요.")
    try:
        if not cost_usd.is_finite() or cost_usd < 0:
            raise ValueError
        # 기존 Numeric(20, 10)에 담기지 않는 값은 0으로 반올림하거나 잘라 저장하지 않는다.
        if cost_usd >= Decimal("10000000000") or cost_usd != cost_usd.quantize(
            Decimal("0.0000000001")
        ):
            raise ValueError
    except (InvalidOperation, ValueError):
        raise InputError(
            "비용은 저장 가능한 0 이상 USD 숫자로 넣어 주세요(소수 10자리까지)."
        ) from None
    with session_scope() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        now = utcnow()
        settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        if not settings.is_recording_staff(staff_key):
            raise InputError(
                "설정에 등록된 기록 담당자 키를 넣어 주세요. 보기 전용은 처리할 수 없습니다."
            )
        row = session.scalar(
            select(TransferLog).where(
                TransferLog.transfer_log_id == log_id, *_unsettled_conditions(now - age)
            )
        )
        if row is None:
            raise InputError(
                "정리 대상이 아니거나 이미 확정된 기록입니다. 조회부터 다시 실행해 주세요."
            )
        if row.purpose == "EXTERNAL_AI" and web_search_calls != 0:
            raise InputError("본문 추출 기록의 웹 검색 횟수는 0이어야 합니다.")
        row.input_tokens = input_tokens
        row.output_tokens = output_tokens
        row.web_search_calls = web_search_calls
        row.cost_usd = cost_usd
        row.reconciled_at = now
        row.reconciled_by = staff_key
        session.flush()
