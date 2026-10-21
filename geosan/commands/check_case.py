"""`geosan check-case <file.json> [--capability <file.json>]` 본문 (계약 C8, BR2.9).

저장 없이, DB 없이 사례 파일의 형식·허용 값·연락처 패턴·파일 안 참조·일치도 단계만 검사한다.
오류는 "N번째 줄 <항목>: <이유>"로 전부 나열하고(첫 오류에서 멈추지 않음) 마지막 줄에
쉬운 한국어 요약을 낸다. 종료 코드: 0 통과, 1 입력 오류, 2 실행 실패.

Step 17(이강욱)의 `import_case`는 같은 검사기 `geosan.config.file_checks.check_case_file`을 부른다.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import typer

from geosan.config.errors import AppError
from geosan.config.file_checks import CheckReport, check_case_file
from geosan.config.paths import normalize_input_path

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2


def print_report(report: CheckReport, echo: Callable[[str], None] = typer.echo) -> None:
    """검사 결과를 사람이 읽는 줄로 출력한다(안내 → 경고 → 오류 순)."""
    for notice in report.notices:
        echo(f"안내: {notice}")
    for warning in report.warnings:
        echo(f"경고: {warning}")
    for line in report.error_lines():
        echo(f"오류: {line}")


def run_check_case(file: Path, capability: Path | None = None) -> int:
    """명령 본문. 출력하고 종료 코드를 돌려준다(typer.Exit은 app.py가 던진다)."""
    try:
        case_path = normalize_input_path(file)
        capability_path = normalize_input_path(capability) if capability is not None else None
    except AppError as exc:
        typer.echo(f"오류: {exc.message}")
        typer.echo(exc.next_action)
        return EXIT_INPUT_ERROR

    try:
        report = check_case_file(case_path, capability_path)
    except AppError as exc:
        typer.echo(f"오류: {exc.message}")
        typer.echo(f"검사하지 못했습니다. {exc.next_action}")
        return EXIT_RUN_FAILED
    except Exception as exc:  # 검사기 자체의 예상 못 한 실패도 숨기지 않는다
        typer.echo(f"오류: 검사 중 실행 실패 ({type(exc).__name__}: {exc})")
        typer.echo("검사하지 못했습니다. 계속되면 PM에게 이 메시지를 알려 주세요.")
        return EXIT_RUN_FAILED

    print_report(report)
    name = case_path.name
    if report.ok:
        case = report.case
        counts = ""
        if case is not None:
            counts = (
                f" (요구 {len(case.requirements)}·신호 {len(case.signals)}·"
                f"근거 {len(case.evidence)}·항목 입력 {len(case.item_inputs)}, "
                f"경고 {len(report.warnings)}건)"
            )
        typer.echo(f"검사 통과: {name}{counts}. 저장하지 않았습니다. 투입은 geosan import-case")
        return EXIT_OK
    typer.echo(
        f"검사 실패: {name}에 오류 {len(report.errors)}건. "
        "위 줄 번호의 항목을 고친 뒤 다시 실행해 주세요."
    )
    return EXIT_INPUT_ERROR
