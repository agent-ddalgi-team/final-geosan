"""`geosan init-db` 본문 (기능 명세 W9, 계약 C8). 재실행 안전."""

from __future__ import annotations

import typer

from geosan.storage.engine import database_path
from geosan.storage.init_db import init_db
from geosan.storage.migrate import current_revisions

EXIT_OK = 0
EXIT_RUN_FAILED = 2


def run_init_db() -> int:
    path = database_path()
    try:
        existed = path.exists()
        before = current_revisions(path) if existed else []
        init_db(path)
        after = current_revisions(path)
    except Exception as exc:  # 어떤 실패든 숨기지 않고 쉬운 말 + 원인으로 낸다
        typer.echo(f"오류: 데이터베이스를 준비하지 못했습니다 ({type(exc).__name__}: {exc})")
        typer.echo(
            f"경로 {path}에 쓸 수 있는지, 마이그레이션 파일(migrations/)이 있는지 확인해 주세요."
        )
        return EXIT_RUN_FAILED
    head = ", ".join(after) if after else "(없음)"
    if existed and before == after:
        typer.echo(f"이미 최신입니다. 데이터베이스 {path} (마이그레이션 {head}). 바뀐 것 없음")
    else:
        typer.echo(f"데이터베이스 준비 완료: {path} (마이그레이션 {head} 적용)")
    return EXIT_OK
