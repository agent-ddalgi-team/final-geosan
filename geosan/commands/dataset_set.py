"""약속 C8의 활성 묶음 변경 명령."""

import typer
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.app_settings import set_active_dataset_kind
from geosan.config.errors import InputError
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope


def run_dataset_set(kind: str) -> int:
    db_path = database_path()
    if not db_path.is_file():
        typer.echo("데이터베이스가 없습니다. 먼저 geosan init-db를 실행해 주세요.")
        return 1
    try:
        with session_scope(db_path) as session:
            selected = set_active_dataset_kind(session, kind)
    except InputError as exc:
        typer.echo(f"오류: {exc.message}")
        return 1
    except SQLAlchemyError:
        typer.echo("활성 묶음을 저장하지 못했습니다. 데이터베이스 상태를 확인해 주세요.")
        return 2
    typer.echo(f"활성 묶음을 {selected}로 바꿨습니다. geosan evaluate로 다시 평가하세요.")
    return 0
