"""`geosan export-contracts [--check]` 본문 (Step 29, 계약 요약 2장 약속 파일).

FastAPI 앱이 코드에서 만든 OpenAPI 문서를 `contracts/openapi.json`에 쓴다. **사람이 명시적으로
실행할 때만** 갱신하고 서버 시작 시 자동 생성은 하지 않는다(코드가 기준이 되어 버리는 것을 막음).
`--check`는 파일을 쓰지 않고 생성본과 커밋본이 같은지만 본다(계약 요약 2장 3번 검사).

스키마 파일 4개(`contracts/*.schema.json`)는 이번 판에서는 사람이 손으로 관리하며 이 명령이
건드리지 않는다. 요약 줄에 그 사실을 밝혀 "다 생성됐다"로 오해하지 않게 한다.

종료 코드(C8): 0 성공·같음, 1 커밋본이 생성본과 다름(사람이 명령을 다시 돌려 고쳐야 함),
2 앱을 만들지 못해 OpenAPI를 뽑지 못함.
"""

from __future__ import annotations

import json
from pathlib import Path

import typer

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACTS_DIR = REPO_ROOT / "contracts"
OPENAPI_NAME = "openapi.json"
HAND_MANAGED_SCHEMAS = (
    "case-file.schema.json",
    "capability-file.schema.json",
    "rule-config.schema.json",
    "app-settings.schema.json",
)


def build_openapi() -> dict:
    """코드(FastAPI 라우터·pydantic 모델)에서 OpenAPI 문서를 만든다. 저장하지 않는다."""
    from geosan.api.app import create_app

    return create_app().openapi()


def render_openapi(document: dict) -> str:
    """같은 코드면 같은 글자가 나오도록 키를 정렬해 JSON 글자로 만든다(두 번 실행 같은 결과)."""
    return json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def run_export_contracts(*, check: bool = False, contracts_dir: Path | None = None) -> int:
    """OpenAPI를 `contracts/openapi.json`에 쓰거나(`check=False`) 커밋본과 비교만 한다."""
    contracts_dir = contracts_dir or CONTRACTS_DIR
    target = contracts_dir / OPENAPI_NAME
    try:
        generated = render_openapi(build_openapi())
    except Exception as exc:  # noqa: BLE001 - 어떤 원인이든 숨기지 않고 실패로 끝낸다
        typer.echo(f"오류: OpenAPI를 만들지 못했습니다 ({type(exc).__name__}).")
        typer.echo("API 코드가 불러와지는지 확인한 뒤 다시 실행해 주세요.")
        return EXIT_RUN_FAILED

    if check:
        if not target.is_file():
            typer.echo(f"다름: {target.name} 파일이 없습니다.")
            typer.echo("python -m geosan export-contracts 를 실행해 만들고 같은 PR에 넣어 주세요.")
            return EXIT_INPUT_ERROR
        if target.read_text(encoding="utf-8") != generated:
            typer.echo(f"다름: 코드가 만든 OpenAPI와 contracts/{target.name} 커밋본이 다릅니다.")
            typer.echo(
                "python -m geosan export-contracts 를 실행해 갱신하고 같은 PR에 넣어 주세요."
            )
            return EXIT_INPUT_ERROR
        typer.echo(f"같음: 코드가 만든 OpenAPI와 contracts/{target.name} 커밋본이 같습니다.")
        return EXIT_OK

    contracts_dir.mkdir(parents=True, exist_ok=True)
    changed = not target.is_file() or target.read_text(encoding="utf-8") != generated
    target.write_text(generated, encoding="utf-8")
    state = "갱신" if changed else "변경 없음"
    typer.echo(
        f"contracts/{target.name} {state}. 스키마 파일 {len(HAND_MANAGED_SCHEMAS)}개"
        "(*.schema.json)는 이 명령이 만들지 않으며 손으로 관리합니다."
    )
    typer.echo(
        "약속 파일을 바꿨으면 PR의 '약속 파일을 바꿨나요?' 항목에 표시하고 PM 확인을 받으세요."
    )
    return EXIT_OK
