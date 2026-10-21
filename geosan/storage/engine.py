"""SQLite 연결 (계약 C6, 안정성 설계 3장, 보안 설계 3장).

- 경로: 환경 변수 `GEOSAN_DB_PATH`(기본 `./data/geosan.db`). U1이 읽는 환경 변수는 이것 하나다
  (BR11.3).
- 연결마다 PRAGMA: `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`.
- 엔진은 경로별로 하나씩 캐시한다. 테스트는 `dispose_engines()`로 비운다.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event

DB_PATH_ENV = "GEOSAN_DB_PATH"
DEFAULT_DB_PATH = Path("data") / "geosan.db"
BUSY_TIMEOUT_MS = 5000

_engines: dict[str, Engine] = {}


def database_path(db_path: Path | str | None = None) -> Path:
    """쓸 DB 파일 경로(절대 경로). 인자 → 환경 변수 → 기본값 순."""
    raw = db_path or os.environ.get(DB_PATH_ENV) or DEFAULT_DB_PATH
    return Path(raw).expanduser().resolve()


def database_url(db_path: Path | str | None = None) -> str:
    return f"sqlite+pysqlite:///{database_path(db_path)}"


def _apply_pragmas(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


def get_engine(db_path: Path | str | None = None) -> Engine:
    """경로별 엔진 하나. 폴더가 없으면 만든다(data/ 기본 폴더)."""
    path = database_path(db_path)
    key = str(path)
    engine = _engines.get(key)
    if engine is None:
        path.parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(
            database_url(path),
            connect_args={"timeout": BUSY_TIMEOUT_MS / 1000, "check_same_thread": False},
            future=True,
        )
        event.listen(engine, "connect", _apply_pragmas)
        _engines[key] = engine
    return engine


def dispose_engines() -> None:
    """캐시한 엔진을 모두 닫는다(테스트 뒤 정리)."""
    for engine in _engines.values():
        engine.dispose()
    _engines.clear()
