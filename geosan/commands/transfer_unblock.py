"""사용량 미확정 호출 조회·수동 정산. 외부 호출 없이 C8 명령을 실행한다."""

import logging
from decimal import Decimal, InvalidOperation

import typer

from geosan.config.errors import AppError, InputError, RunFailedError, exit_code_for
from geosan.evidence.reconciliation import list_unsettled, parse_age, reconcile_usage
from geosan.evidence.transfer import KST
from geosan.storage.base import utcnow
from geosan.storage.engine import database_path

logger = logging.getLogger(__name__)


def run_transfer_unblock(
    older_than: str,
    log_id: str | None,
    input_tokens: str | None,
    output_tokens: str | None,
    web_search_calls: str | None,
    cost_usd: str | None,
    staff_key: str | None,
    echo=typer.echo,
) -> int:
    try:
        age = parse_age(older_than)
        values = (log_id, input_tokens, output_tokens, web_search_calls, cost_usd, staff_key)
        write = any(value is not None for value in values)
        if write and any(value is None or not value.strip() for value in values):
            raise InputError(
                "정리에는 기록 번호·입력/출력 토큰·웹 검색 횟수·비용·처리자를 모두 넣어 주세요."
            )
        if not database_path().is_file():
            raise InputError("데이터베이스가 없습니다. 먼저 geosan init-db를 실행해 주세요.")
        if not write:
            rows = list_unsettled(age)
            now = utcnow()
            echo(f"정리 대상 {len(rows)}건(조회만 했습니다)")
            for row in rows:
                purpose = "검색" if row.purpose == "EXTERNAL_SEARCH" else "본문 추출"
                minutes = int((now - row.occurred_at).total_seconds() // 60)
                occurred = row.occurred_at.astimezone(KST).strftime("%Y-%m-%d %H:%M:%S KST")
                echo(
                    f"기록 {row.transfer_log_id} · {purpose} · {minutes}분 경과 · {occurred} "
                    f"· 모델 {row.model or '미기록'}"
                )
        else:
            try:
                # int('1.0')와 int('nan')은 허용하지 않는다. CLI 파싱 오류도 C8 종료 코드 1.
                tokens = [int(value) for value in (input_tokens, output_tokens, web_search_calls)]
                cost = Decimal(cost_usd)
            except (ValueError, InvalidOperation):
                raise InputError(
                    "토큰·웹 검색 횟수는 정수, 비용은 USD 숫자로 넣어 주세요."
                ) from None
            reconcile_usage(
                log_id,
                age=age,
                input_tokens=tokens[0],
                output_tokens=tokens[1],
                web_search_calls=tokens[2],
                cost_usd=cost,
                staff_key=staff_key,
            )
            echo("막힌 기록 1건을 정리했습니다. 원래 호출 횟수와 월 귀속은 유지됩니다.")
        return 0
    except Exception as exc:
        error = (
            exc
            if isinstance(exc, AppError)
            else RunFailedError(
                "전송 기록을 처리하지 못했습니다. 정리 중이었다면 변경을 되돌렸습니다.",
                next_action="geosan init-db로 DB 상태를 확인한 뒤 다시 조회해 주세요.",
            )
        )
        logger.error("사용량 정산 실패: ref=%s type=%s", error.ref, type(exc).__name__)
        echo(f"{error.message} {error.next_action} (문의 번호: {error.ref})")
        return exit_code_for(error)
