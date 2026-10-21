"""Alembic 실행 환경.

DB 경로는 코드가 넘긴 값 → GEOSAN_DB_PATH → ./data/geosan.db 순이고, 모델은 geosan.storage.metadata.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection

from geosan.storage.engine import database_url, get_engine
from geosan.storage.metadata import metadata

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logging", True):
    fileConfig(config.config_file_name)

target_metadata = metadata()


def _url() -> str:
    url = config.get_main_option("sqlalchemy.url")
    return url if url else database_url()


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run_with_connection(connection: Connection) -> None:
    """우리가 연 트랜잭션 하나 안에서 모든 마이그레이션을 돌리고 끝에 커밋한다.

    SQLite는 DDL도 트랜잭션에 넣을 수 있다. Alembic의 자체 트랜잭션 처리에 맡기지 않고 여기서
    명시적으로 begin/commit 하므로 SQLAlchemy 판이 바뀌어도 중간에 되돌아가는 일이 없다.
    """
    with connection.begin():
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            transactional_ddl=True,
        )
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = config.attributes.get("connection")
    if connectable is not None:
        _run_with_connection(connectable)
        return

    # 앱과 같은 엔진(WAL·busy_timeout·foreign_keys PRAGMA 포함)을 쓴다.
    engine = get_engine(config.attributes.get("db_path"))
    with engine.connect() as connection:
        _run_with_connection(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
