"""`geosan` 명령줄 앱 (Typer). 계약 C8의 명령 9개 + `db merge-heads`.

Part A(기본 틀)에서는 명령 이름과 인자만 등록한다. 본문은 Step 19(담당: 이강욱)에서
명령별 파일(`init_db.py`, `serve.py`, …)로 채운다. 아직 구현되지 않은 명령은 오류를
숨기지 않고 "아직 구현되지 않았습니다" 한 줄을 내고 종료 코드 2로 끝난다.

종료 코드 규칙(C8): 0 성공, 1 입력 오류, 2 실행 실패.
"""

from __future__ import annotations

from pathlib import Path

import typer

from geosan import __version__

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

app = typer.Typer(
    name="geosan",
    help=(
        "거산 영업지원 운영 명령. 모든 명령은 끝에 쉬운 한국어 요약 한 줄과 "
        "종료 코드(0 성공, 1 입력 오류, 2 실행 실패)를 냅니다."
    ),
    no_args_is_help=True,
    add_completion=False,
    rich_markup_mode=None,
)
db_app = typer.Typer(
    name="db",
    help="데이터베이스 마이그레이션 보조 명령.",
    no_args_is_help=True,
    add_completion=False,
    rich_markup_mode=None,
)
app.add_typer(db_app, name="db")


def not_implemented_yet(command: str, owner: str = "이강욱", step: str = "Step 19") -> None:
    """미구현 명령의 공통 종료. 성공처럼 보이지 않게 종료 코드 2로 끝낸다."""
    typer.echo(f"'{command}' 명령은 아직 구현되지 않았습니다(담당: {owner}, {step}).")
    raise typer.Exit(code=EXIT_RUN_FAILED)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"geosan {__version__}")
        raise typer.Exit(code=EXIT_OK)


@app.callback()
def _root(
    version: bool = typer.Option(
        False,
        "--version",
        help="버전을 보이고 끝냅니다.",
        callback=_version_callback,
        is_eager=True,
    ),
) -> None:
    """거산 영업지원 운영 명령."""


@app.command("init-db")
def init_db() -> None:
    """데이터베이스 파일을 만들고 마이그레이션을 적용합니다(처음·갱신 모두, 다시 실행해도 안전)."""
    from geosan.commands.init_db import run_init_db

    raise typer.Exit(code=run_init_db())


@app.command("serve")
def serve(
    port: int = typer.Option(
        8000, "--port", help="듣는 포트. 기본 8000, 127.0.0.1에서만 듣습니다."
    ),
) -> None:
    """설정을 검사한 뒤 서버(API + 화면)를 한 덩어리로 띄웁니다."""
    not_implemented_yet("serve")


@app.command("check-config")
def check_config(
    rule_config: Path | None = typer.Argument(None, help="규칙 설정 파일(rule-config.yaml)"),
    app_settings: Path | None = typer.Argument(None, help="앱 설정 파일(app-settings.yaml)"),
) -> None:
    """규칙 설정·앱 설정 파일의 형식을 검사합니다. 오류는 '몇 번째 줄 어느 항목이 왜'로 보입니다."""
    not_implemented_yet("check-config")


@app.command("import-capability")
def import_capability(
    file: Path = typer.Argument(..., help="거산 역량 파일(JSON)"),
) -> None:
    """거산 역량 파일을 검사한 뒤 저장합니다(재투입 규칙 적용). 평가는 자동으로 돌지 않습니다."""
    not_implemented_yet("import-capability")


@app.command("import-case")
def import_case(
    file: Path = typer.Argument(..., help="사례 파일(JSON). 가상 사례·실제 기업 모두 같은 형식"),
) -> None:
    """사례 파일(가상·실제 기업)을 검사한 뒤 한 트랜잭션으로 저장합니다."""
    not_implemented_yet("import-case")


@app.command("check-case")
def check_case(
    file: Path = typer.Argument(..., help="사례 파일(JSON)"),
    capability: Path | None = typer.Option(
        None,
        "--capability",
        help="함께 검사할 거산 역량 파일(선택). 없으면 공정 코드 존재는 검사하지 않습니다.",
    ),
) -> None:
    """저장 없이 사례 파일의 형식·허용 값·연락처 패턴만 검사합니다.

    DB 없이 팀원 컴퓨터에서 실행할 수 있습니다.
    """
    from geosan.commands.check_case import run_check_case

    raise typer.Exit(code=run_check_case(file, capability))


@app.command("evaluate")
def evaluate(
    opp: list[str] = typer.Option(
        [], "--opp", help="평가할 기회 ID(여러 번 지정 가능). 없으면 전체"
    ),
    base_date: str | None = typer.Option(None, "--base-date", help="평가 기준일 YYYY-MM-DD"),
) -> None:
    """평가 흐름 ⓪을 실행합니다. 출력: 묶음 ID, 기회 수, 분류별 건수."""
    not_implemented_yet("evaluate")


@app.command("verify-case")
def verify_case(
    file: Path = typer.Argument(..., help="expected 블록이 있는 사례 파일(JSON)"),
) -> None:
    """사례 파일의 기준일로 평가한 뒤 expected와 비교해 항목별 일치/불일치 표를 냅니다."""
    not_implemented_yet("verify-case")


@app.command("export-contracts")
def export_contracts(
    check: bool = typer.Option(
        False, "--check", help="생성본과 contracts/ 커밋본이 같은지만 검사합니다(3.7)."
    ),
) -> None:
    """OpenAPI와 스키마 4개를 contracts/ 폴더에 씁니다. 사람이 명시적으로만 실행합니다."""
    not_implemented_yet("export-contracts")


@db_app.command("merge-heads")
def db_merge_heads() -> None:
    """마이그레이션 머리가 둘일 때 하나로 합칩니다."""
    from geosan.commands.db_merge_heads import run_db_merge_heads

    raise typer.Exit(code=run_db_merge_heads())


def main() -> None:
    """콘솔 스크립트 `geosan`과 `python -m geosan`의 공통 진입점."""
    app()


if __name__ == "__main__":
    main()
