"""`geosan` 명령줄 앱 (Typer). 계약 C8의 운영 명령과 `db merge-heads`.

명령 본문은 명령별 파일(`init_db.py`, `evaluate.py`, `verify_case.py`, `export_contracts.py`, …)에
있다. 앞으로 새 명령을 먼저 등록만 할 때는 `not_implemented_yet`으로 오류를 숨기지 않고
"아직 구현되지 않았습니다" 한 줄을 내고 종료 코드 2로 끝낸다.

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


@app.command("geocode")
def geocode(
    missing_only: bool = typer.Option(
        False, "--missing-only", help="기존 공공좌표는 다시 조회하지 않습니다."
    ),
) -> None:
    """위치자료와 API로 실제 회사 좌표를 확인하고 공공좌표만 저장합니다."""
    from geosan.commands.geocode import run_geocode

    raise typer.Exit(run_geocode(missing_only))


@app.command("source-confirm")
def source_confirm(
    source_id: str = typer.Argument(
        ...,
        help="kicox-factory-csv, kicox-production-api, factoryon-xlsx, nier-water-csv 중 하나",
    ),
    staff_key: str = typer.Option(..., "--by", help="설정에 등록된 기록 담당자 키"),
    terms: str | None = typer.Option(None, "--terms", help="운영자가 확인한 소스 약관 주소"),
    on: str | None = typer.Option(None, "--on", help="확인일 YYYY-MM-DD, 기본은 서울 오늘"),
) -> None:
    """공공 소스의 이용·저장 확인을 기록합니다. 기존 기록은 덮어쓰지 않습니다."""
    from geosan.commands.source_confirm import run_source_confirm

    raise typer.Exit(code=run_source_confirm(source_id, staff_key=staff_key, terms=terms, on=on))


@app.command("source-load")
def source_load(
    source_id: str = typer.Argument(..., help="factoryon-xlsx 또는 nier-water-csv"),
    files: list[Path] = typer.Argument(..., help="불러올 파일. 이름에 기준일 YYYYMMDD가 있어야 함"),
) -> None:
    """팩토리온 공장조회·수질 명단을 넣고 목록 회사에 공장 정보·표면처리 표시를 붙입니다."""
    from geosan.commands.source_load import run_source_load

    raise typer.Exit(code=run_source_load(source_id, files))


@app.command("ingest")
def ingest(
    source_id: str = typer.Argument(..., help="공개 공장현황 소스 kicox-factory-csv"),
    process: list[str] = typer.Option(..., "--process", help="찾을 공정 코드, 여러 번 지정 가능"),
    region: list[str] | None = typer.Option(None, "--region", help="찾을 지역, 생략하면 설정 전체"),
    industry: list[str] | None = typer.Option(None, "--industry", help="찾을 산업, 생략하면 전체"),
    maximum: int | None = typer.Option(None, "--max", help="등록 후보 최대 건수, 설정 상한 이내"),
    rejudge: bool = typer.Option(
        False, "--rejudge", help="저장한 판단을 무시하고 다시 판단, 비용 발생"
    ),
):
    """공개 공장 자료에서 후보를 찾고 등록·재평가·신규 회사 조사를 이어서 실행합니다."""
    from geosan.commands.ingest import run_ingest_command

    raise typer.Exit(
        code=run_ingest_command(
            source_id,
            processes=process,
            regions=region or [],
            industries=industry or [],
            maximum=maximum,
            rejudge=rejudge,
        )
    )


db_app = typer.Typer(
    name="db",
    help="데이터베이스 마이그레이션 보조 명령.",
    no_args_is_help=True,
    add_completion=False,
    rich_markup_mode=None,
)
app.add_typer(db_app, name="db")


def not_implemented_yet(command: str, owner: str = "PM 세션", step: str = "Part F") -> None:
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
    port: int = typer.Option(8000, "--port", help="듣는 포트. 기본 8000."),
    host: str = typer.Option(
        "127.0.0.1", "--host", help="듣는 주소. 기본 127.0.0.1, 배포 시 0.0.0.0."
    ),
) -> None:
    """설정을 검사한 뒤 서버(API + 화면)를 한 덩어리로 띄웁니다."""
    from geosan.commands.serve import run_serve

    raise typer.Exit(code=run_serve(port, host))


@app.command("backup")
def backup(
    to: Path | None = typer.Option(
        None,
        "--to",
        help="백업을 둘 폴더. 기본은 현재 폴더의 backups/. 배포 서버에서는 영구 저장 공간 안 폴더",
    ),
) -> None:
    """지금 데이터베이스를 파일 하나로 복사해 둡니다(서버가 켜져 있어도 안전, 계약 C8·#214)."""
    from geosan.commands.backup import run_backup

    raise typer.Exit(code=run_backup(to))


@app.command("restore")
def restore(
    backup_file: Path = typer.Argument(
        ..., help="되돌릴 백업 파일(.db). `geosan backup`이 만든 파일"
    ),
) -> None:
    """서버를 멈춘 상태에서 백업 파일로 되돌립니다.

    지금 DB는 먼저 따로 보관하고 확인 질문을 한 번 합니다.
    """
    from geosan.commands.restore import run_restore

    raise typer.Exit(code=run_restore(backup_file))


@app.command("check-config")
def check_config(
    rule_config: Path | None = typer.Argument(None, help="규칙 설정 파일(rule-config.yaml)"),
    app_settings: Path | None = typer.Argument(None, help="앱 설정 파일(app-settings.yaml)"),
) -> None:
    """규칙 설정·앱 설정 파일의 형식을 검사합니다. 오류는 '몇 번째 줄 어느 항목이 왜'로 보입니다."""
    from geosan.commands.check_config import run_check_config

    register = rule_config is not None or app_settings is not None
    raise typer.Exit(code=run_check_config(rule_config, app_settings, register=register))


@app.command("dataset-set")
def dataset_set(
    kind: str = typer.Argument(..., metavar="DATASET_KIND", help="활성화할 거산 값 묶음"),
) -> None:
    """DB의 활성 묶음을 바꾸고 재평가 방법을 안내합니다."""
    from geosan.commands.dataset_set import run_dataset_set

    raise typer.Exit(code=run_dataset_set(kind))


@app.command("review-set")
def review_set(
    target: list[str] = typer.Argument(
        None, help="대상 종류 ID REVIEWED|RECHECK 또는 --all REVIEWED"
    ),
    all_values: bool = typer.Option(
        False, "--all", help="소개서 값을 거산 확인 완료 묶음으로 복사"
    ),
    reviewer: str | None = typer.Option(None, "--by", help="검수자 이름"),
    basis: str | None = typer.Option(None, "--basis", help="확인 근거(연락처 제외)"),
    no_evaluate: bool = typer.Option(False, "--no-evaluate", help="전체 전환 뒤 재평가를 생략"),
) -> None:
    """검수 이력을 남기고 재평가합니다. --all은 소개서 원본을 보존해 확인 묶음을 만듭니다."""
    from geosan.commands.review_set import run_review_set

    raise typer.Exit(
        code=run_review_set(
            target or [],
            all_values=all_values,
            reviewer=reviewer,
            basis=basis,
            no_evaluate=no_evaluate,
        )
    )


@app.command("import-capability")
def import_capability(
    file: Path = typer.Argument(..., help="거산 역량 파일(JSON)"),
) -> None:
    """거산 역량 파일을 검사한 뒤 저장합니다(재투입 규칙 적용). 평가는 자동으로 돌지 않습니다."""
    from geosan.commands.import_capability import run_import_capability

    raise typer.Exit(code=run_import_capability(file))


@app.command("import-case")
def import_case(
    file: Path = typer.Argument(..., help="사례 파일(JSON). 가상 사례·실제 기업 모두 같은 형식"),
) -> None:
    """사례 파일(가상·실제 기업)을 검사한 뒤 한 트랜잭션으로 저장합니다."""
    from geosan.commands.import_case import run_import_case

    raise typer.Exit(code=run_import_case(file))


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
    from geosan.commands.evaluate import run_evaluate

    raise typer.Exit(code=run_evaluate(opp, base_date))


@app.command("verify-case")
def verify_case(
    file: Path = typer.Argument(..., help="expected 블록이 있는 사례 파일(JSON)"),
) -> None:
    """사례 파일의 기준일로 평가한 뒤 expected와 비교해 항목별 일치/불일치 표를 냅니다."""
    from geosan.commands.verify_case import run_verify_case

    raise typer.Exit(code=run_verify_case(file))


@app.command("transfer-unblock")
def transfer_unblock(
    older_than: str = typer.Option("10m", "--older-than", help="미확정 호출 경과 시간, 최소 10m"),
    log_id: str | None = typer.Option(None, "--log-id", help="정리할 전송 기록 번호 하나"),
    input_tokens: str | None = typer.Option(None, "--input-tokens", help="확인한 입력 토큰"),
    output_tokens: str | None = typer.Option(None, "--output-tokens", help="확인한 출력 토큰"),
    web_search_calls: str | None = typer.Option(
        None, "--web-search-calls", help="확인한 웹 검색 횟수"
    ),
    cost_usd: str | None = typer.Option(None, "--cost-usd", help="제공사에서 확인한 실제 USD 비용"),
    staff_key: str | None = typer.Option(
        None, "--by", help="설정에 등록된 처리자 키, 보기 전용 제외"
    ),
) -> None:
    """기본은 미확정 호출 조회만 합니다. 제공사 사용량을 확인한 뒤 기록별로 정리합니다."""
    from geosan.commands.transfer_unblock import run_transfer_unblock

    raise typer.Exit(
        code=run_transfer_unblock(
            older_than, log_id, input_tokens, output_tokens, web_search_calls, cost_usd, staff_key
        )
    )


@app.command("research")
def research(
    missing_homepage: bool = typer.Option(False, "--missing-homepage", help="홈페이지 없는 사례만"),
    all_companies: bool = typer.Option(False, "--all", help="주소가 있는 사례도 다시 조사"),
    limit: str | None = typer.Option(
        None, "--limit", metavar="N", help="이번 최대 사례 수, 1 이상"
    ),
) -> None:
    """공개 신규 사례를 검색·추출·재평가합니다.

    기본은 홈페이지가 없거나, 주소는 있는데 아직 조사가 안 된 실제 사례입니다.
    """
    from geosan.commands.research import run_research

    raise typer.Exit(code=run_research(missing_homepage, all_companies, limit))


@app.command("cost")
def cost(
    month: str | None = typer.Option(None, "--month", help="비용을 볼 월 YYYY-MM. 기본 이번 달"),
) -> None:
    """이번 달 검색·근거 추출의 호출 수·토큰·확인된 비용과 한도를 보여 줍니다."""
    from geosan.commands.cost import run_cost

    raise typer.Exit(code=run_cost(month))


@app.command("export-contracts")
def export_contracts(
    check: bool = typer.Option(
        False,
        "--check",
        help="파일을 쓰지 않고 생성본과 contracts/openapi.json 커밋본이 같은지만 검사합니다.",
    ),
) -> None:
    """코드가 만든 OpenAPI를 contracts/openapi.json에 씁니다. 사람이 명시적으로만 실행합니다.

    스키마 파일 4개(*.schema.json)는 이번 판에서는 손으로 관리하며 이 명령이 건드리지 않습니다.
    """
    from geosan.commands.export_contracts import run_export_contracts

    raise typer.Exit(code=run_export_contracts(check=check))


@app.command("demo-report")
def demo_report(
    capability: Path = typer.Option(
        ..., "--capability", help="거산 역량 파일(JSON). 묶음(datasetKind)은 이 파일을 따릅니다."
    ),
    cases: Path = typer.Option(..., "--cases", help="사례 파일(*.json)이 든 폴더"),
    out: Path = typer.Option(..., "--out", help="결과를 쓸 폴더(없으면 만듭니다)"),
    base_date: str | None = typer.Option(
        None, "--base-date", help="평가 기준일 YYYY-MM-DD. 없으면 사례 파일의 baseDate"
    ),
) -> None:
    """DB·화면 없이 역량 파일 + 사례 파일만으로 시연 자료(순위표·기업별 근거·사실표)를 뽑습니다.

    10/29 부분 시연용 예비 경로(계약 C8). 저장하지 않으며 모든 출력 머리에
    '시연용 초안·거산 확인 전'이 붙습니다. 연락처 패턴이 있으면 쓰지 않고 종료 코드 1.
    """
    from geosan.commands.demo_report import run_demo_report

    raise typer.Exit(code=run_demo_report(capability, cases, out, base_date))


@app.command("seed-demo-records")
def seed_demo_records(
    file: Path | None = typer.Argument(
        None, help="가상 영업 기록 파일(YAML). 기본 examples/demo-records.yaml"
    ),
) -> None:
    """발표 시연용 DB에 가상 회사의 영업 기록(성사·거절)을 넣습니다.

    시연 표시가 있는 DB에서만 동작합니다. 실제 DB에는 넣지 않습니다(종료 코드 1).
    이미 영업 기록이 있는 회사는 건너뜁니다(#274, 계약 C8).
    """
    from geosan.commands.seed_demo_records import run_seed_demo_records

    raise typer.Exit(code=run_seed_demo_records(file))


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
