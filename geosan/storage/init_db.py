"""`geosan init-db`의 바탕 함수 (기능 명세 W9): DB 파일 생성 + 마이그레이션 적용. 재실행 안전."""

from __future__ import annotations

from pathlib import Path

from geosan.storage.engine import database_path, get_engine
from geosan.storage.migrate import upgrade_to_head


def init_db(db_path: Path | str | None = None) -> Path:
    """DB 파일을 만들고(없으면) 마이그레이션을 끝(head)까지 적용한 뒤 파일 경로를 돌려준다."""
    path = database_path(db_path)
    get_engine(path)  # 폴더 생성 + PRAGMA(WAL 등) 적용
    upgrade_to_head(path)
    return path
