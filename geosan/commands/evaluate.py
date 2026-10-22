"""`geosan evaluate [--opp <id>...] [--base-date YYYY-MM-DD]` 본문 (계약 C8, 기능 명세 W3).

평가 흐름 ⓪(`geosan.workflows.flow_evaluate.run_evaluation`)을 명령으로 연결한다
(Step 19 나머지, PM 세션 몫). 출력: 묶음 ID, 기회 수, 분류별 건수 요약 한 줄.
종료 코드: 0 성공, 1 입력 오류, 2 실행 실패.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

import typer

from geosan.api.app import configure_logging, logger, request_ref
from geosan.config.errors import AppError, InputError, exit_code_for, new_ref
from geosan.workflows.flow_evaluate import run_evaluation

EXIT_OK = 0


def parse_base_date(raw: str | None) -> date | None:
    """`--base-date` 문자열을 날짜로. 형식이 틀리면 InputError(종료 코드 1)."""
    if raw is None:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise InputError(
            message=f"--base-date는 YYYY-MM-DD 형식이어야 하는데 '{raw}'이 적혀 있습니다",
            next_action="예: --base-date 2026-10-27",
        ) from None


def print_error(error: AppError, ref: str, echo: Callable[[str], None]) -> None:
    for field in error.fields:
        line = f"{field.line}번째 줄 " if field.line is not None else ""
        echo(f"오류: {line}{field.path}: {field.message}")
    echo(f"{error.message} {error.next_action} (문의 시 이 번호: {ref})")


def run_evaluate(
    opp: list[str] | None,
    base_date: str | None,
    echo: Callable[[str], None] = typer.echo,
) -> int:
    """명령 본문. 출력하고 종료 코드를 돌려준다(typer.Exit은 app.py가 던진다)."""
    ref = new_ref()
    token = request_ref.set(ref)
    try:
        configure_logging()
        try:
            base = parse_base_date(base_date)
        except InputError as exc:
            print_error(exc, ref, echo)
            return exit_code_for(exc)
        opp_ids = [value.strip() for value in opp if value.strip()] if opp else None
        result = run_evaluation(opp_ids=opp_ids, base_date=base, requested_by="cli")
        if result.ok:
            logger.info("cmd.evaluate.done")
            echo(f"{result.summary} (문의 시 이 번호: {ref})")
            return EXIT_OK
        error = result.error or InputError("평가하지 못했습니다.")
        logger.error("cmd.evaluate.failed", extra={"ref": ref})
        print_error(error, ref, echo)
        return exit_code_for(error)
    finally:
        request_ref.reset(token)
