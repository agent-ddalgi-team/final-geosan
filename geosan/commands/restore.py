"""`geosan restore <backup-file>` 본문 (계약 C8, #214).

서버가 멈춘 상태에서만 허용한다(켜져 있으면 거부, `serving_marker`). 순서:
① 백업 파일 검사(SQLite인지·무결성·거산 DB인지) → ② 서버 실행 중이면 거부 → ③ 확인 질문 1회 →
④ 지금 DB를 백업 파일과 같은 폴더에 `geosan-before-restore-<날짜시각>.db`로 자동 보관 →
⑤ 백업 파일을 복사해 DB 자리에 바꿔 넣고 옛 `-wal`·`-shm`을 지운다.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import typer

from geosan.commands.backup import check_backup_file, create_backup
from geosan.commands.serving_marker import running_server
from geosan.storage.engine import database_path

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

BEFORE_RESTORE_PREFIX = "geosan-before-restore"
SIDE_FILE_SUFFIXES = ("-wal", "-shm")


def replace_database(db_path: Path, backup_file: Path) -> None:
    """백업 파일을 DB 자리에 넣는다. 같은 폴더에 먼저 복사한 뒤 한 번에 바꿔 끼운다."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    staging = db_path.with_name(db_path.name + ".restoring")
    shutil.copyfile(backup_file, staging)
    os.replace(staging, db_path)
    # 옛 DB의 WAL·공유 메모리 파일이 남아 있으면 새 파일에 잘못 적용되므로 지운다.
    for suffix in SIDE_FILE_SUFFIXES:
        db_path.with_name(db_path.name + suffix).unlink(missing_ok=True)


def run_restore(backup_file: Path) -> int:
    db_path = database_path()
    backup_file = backup_file.expanduser().resolve()

    # ① 입력 검사
    if not backup_file.is_file():
        typer.echo(f"오류: 백업 파일이 없습니다 ({backup_file}).")
        return EXIT_INPUT_ERROR
    if backup_file == db_path:
        typer.echo(
            f"오류: 지금 쓰는 데이터베이스 파일 자체입니다 ({db_path}). 백업 파일을 지정해 주세요."
        )
        return EXIT_INPUT_ERROR
    problem = check_backup_file(backup_file)
    if problem is not None:
        typer.echo(f"오류: 백업 파일로 쓸 수 없습니다 — {problem} ({backup_file}).")
        return EXIT_INPUT_ERROR

    # ② 서버가 켜져 있으면 거부
    server = running_server(db_path)
    if server is not None:
        typer.echo(
            f"오류: 서버가 켜져 있습니다 (pid {server['pid']}, 포트 {server.get('port')}). "
            "서버를 멈춘 뒤 다시 실행해 주세요. 복원하지 않았습니다."
        )
        return EXIT_RUN_FAILED

    # ③ 확인 질문 1회
    typer.echo(f"되돌릴 대상: {db_path}")
    typer.echo(f"되돌릴 백업: {backup_file}")
    if db_path.exists():
        typer.echo(
            f"지금 DB는 복원 전에 {backup_file.parent}에 "
            f"'{BEFORE_RESTORE_PREFIX}-…'로 따로 보관합니다."
        )
    else:
        typer.echo("지금 DB 파일은 없어 보관할 것이 없습니다.")
    if not typer.confirm("계속할까요?", default=False):
        typer.echo("복원하지 않았습니다. 바뀐 것 없음")
        return EXIT_OK

    # ④ 지금 DB 자동 보관
    kept: Path | None = None
    if db_path.exists():
        try:
            kept = create_backup(db_path, backup_file.parent, prefix=BEFORE_RESTORE_PREFIX)
        except Exception as exc:  # 보관에 실패하면 되돌리지 않는다
            typer.echo(
                f"오류: 지금 DB를 보관하지 못해 복원을 멈췄습니다 ({type(exc).__name__}: {exc})"
            )
            typer.echo("바뀐 것 없음")
            return EXIT_RUN_FAILED

    # ⑤ 바꿔 넣기
    try:
        replace_database(db_path, backup_file)
    except Exception as exc:
        typer.echo(f"오류: 데이터베이스를 바꿔 넣지 못했습니다 ({type(exc).__name__}: {exc})")
        if kept is not None:
            typer.echo(f"복원 전 DB 보관본: {kept}")
        return EXIT_RUN_FAILED

    kept_line = f" 복원 전 DB는 {kept}에 보관했습니다." if kept is not None else ""
    typer.echo(f"복원 완료: {db_path} ← {backup_file.name}.{kept_line}")
    typer.echo(
        "이제 `geosan init-db`로 마이그레이션이 최신인지 확인한 뒤 "
        "`geosan serve`로 서버를 다시 시작하세요."
    )
    return EXIT_OK
