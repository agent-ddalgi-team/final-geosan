"""`geosan db merge-heads` 본문 (계약 C6 마이그레이션 동시 작업 규칙)."""

from __future__ import annotations

import typer

from geosan.storage.migrate import merge_heads, script_heads

EXIT_OK = 0
EXIT_RUN_FAILED = 2


def run_db_merge_heads() -> int:
    try:
        heads = script_heads()
        if len(heads) < 2:
            head = heads[0] if heads else "없음"
            typer.echo(f"마이그레이션 머리는 하나({head})입니다. 합칠 것이 없습니다.")
            return EXIT_OK
        created = merge_heads()
    except Exception as exc:
        typer.echo(f"오류: 머리를 합치지 못했습니다 ({type(exc).__name__}: {exc})")
        typer.echo("migrations/versions/ 파일의 revision·down_revision을 확인해 주세요.")
        return EXIT_RUN_FAILED
    typer.echo(f"머리 {len(heads)}개({', '.join(heads)})를 합치는 파일을 만들었습니다: {created}")
    typer.echo("합침 완료. 다음은 geosan init-db로 적용하고 PR에 표시해 주세요.")
    return EXIT_OK
