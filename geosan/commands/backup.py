"""`geosan backup [--to <dir>]` 본문 (계약 C8, #214).

SQLite의 `VACUUM INTO`로 지금 DB를 새 파일 하나에 복사한다. 서버가 켜져 있어도 일관된 사본이
나오고 WAL에만 있던 기록도 들어간다. 사본은 WAL 없는 독립 파일이라 그대로 `restore`에 쓴다.
기본 저장 폴더는 현재 폴더의 `backups/`(저장소에서는 .gitignore). 배포 서버에서는 `--to`로
영구 저장 공간 안 폴더를 지정한다. 파일 이름은 `geosan-<날짜>-<시각>.db`이고 같은 이름이
있으면 `-2`, `-3`을 붙인다.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

import typer

from geosan.storage.engine import database_path

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

DEFAULT_BACKUP_DIR = Path("backups")
SQLITE_HEADER = b"SQLite format 3\x00"


def _now() -> datetime:
    """테스트에서 바꾸기 쉽게 따로 둔다."""
    return datetime.now()


def backup_file_name(when: datetime, prefix: str = "geosan") -> str:
    return f"{prefix}-{when:%Y-%m-%d-%H%M}.db"


def unique_path(folder: Path, name: str) -> Path:
    """같은 이름이 있으면 `-2`, `-3`…을 붙여 겹치지 않는 경로를 돌려준다."""
    candidate = folder / name
    stem, suffix = candidate.stem, candidate.suffix
    counter = 2
    while candidate.exists():
        candidate = folder / f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def create_backup(db_path: Path, folder: Path, prefix: str = "geosan") -> Path:
    """DB를 folder 안 새 파일로 복사하고 그 경로를 돌려준다. 실패하면 예외를 그대로 올린다."""
    folder.mkdir(parents=True, exist_ok=True)
    target = unique_path(folder, backup_file_name(_now(), prefix))
    connection = sqlite3.connect(str(db_path), timeout=5)
    try:
        connection.execute("VACUUM INTO ?", (str(target),))
    finally:
        connection.close()
    return target


def check_backup_file(path: Path) -> str | None:
    """복원에 써도 되는 파일인지 본다. 문제가 없으면 None, 있으면 이유 한 줄."""
    try:
        with path.open("rb") as handle:
            header = handle.read(len(SQLITE_HEADER))
    except OSError as exc:
        return f"읽을 수 없음 ({exc.strerror or exc})"
    if header != SQLITE_HEADER:
        return "SQLite 데이터베이스 파일이 아님"
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error as exc:
        return f"열 수 없음 ({exc})"
    try:
        (result,) = connection.execute("PRAGMA integrity_check").fetchone()
        if result != "ok":
            return f"무결성 검사 실패 ({result})"
        has_version = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'alembic_version'"
        ).fetchone()
    except sqlite3.Error as exc:
        return f"검사 실패 ({exc})"
    finally:
        connection.close()
    if has_version is None:
        return "거산 데이터베이스가 아님 (마이그레이션 표 alembic_version 없음)"
    return None


def human_size(size: int) -> str:
    if size < 1024 * 1024:
        return f"{max(size, 1) / 1024:.0f}KB"
    return f"{size / (1024 * 1024):.1f}MB"


def run_backup(to: Path | None) -> int:
    db_path = database_path()
    if not db_path.exists():
        typer.echo(f"오류: 데이터베이스 파일이 없습니다 ({db_path}).")
        typer.echo("먼저 `geosan init-db`를 실행해 주세요. 백업할 것이 없습니다.")
        return EXIT_INPUT_ERROR
    folder = (to or DEFAULT_BACKUP_DIR).expanduser().resolve()
    try:
        target = create_backup(db_path, folder)
    except Exception as exc:  # 어떤 실패든 숨기지 않고 쉬운 말 + 원인으로 낸다
        typer.echo(f"오류: 백업을 만들지 못했습니다 ({type(exc).__name__}: {exc})")
        typer.echo(
            f"폴더 {folder}에 쓸 수 있는지, DB 파일 {db_path}을 읽을 수 있는지 확인해 주세요."
        )
        return EXIT_RUN_FAILED
    typer.echo(
        f"백업 저장: {target} ({human_size(target.stat().st_size)}). "
        f"원본 {db_path.name}은 그대로이고, 서버가 켜져 있어도 됩니다."
    )
    return EXIT_OK
