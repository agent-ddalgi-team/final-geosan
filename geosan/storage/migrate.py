"""마이그레이션 실행 (계약 C6, 안정성 설계 6장): `init-db`와 `db merge-heads`의 바탕.

Alembic 설정은 저장소 루트의 `alembic.ini`·`migrations/`를 쓴다(편집 설치 전제, README 설치 절).
"""

from __future__ import annotations

import re
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from geosan.storage.engine import database_path, database_url

REPO_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI = REPO_ROOT / "alembic.ini"
MIGRATIONS_DIR = REPO_ROOT / "migrations"
VERSIONS_DIR = MIGRATIONS_DIR / "versions"


def alembic_config(db_path: Path | str | None = None) -> Config:
    """코드에서 쓰는 Alembic 설정. 로그 설정은 건너뛰어 명령 출력을 어지럽히지 않는다."""
    if not ALEMBIC_INI.exists():
        raise FileNotFoundError(
            f"alembic.ini를 찾을 수 없습니다: {ALEMBIC_INI} (저장소를 편집 설치했는지 확인)"
        )
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("version_locations", str(VERSIONS_DIR))
    config.set_main_option("sqlalchemy.url", database_url(db_path))
    config.attributes["db_path"] = str(database_path(db_path))
    config.attributes["configure_logging"] = False
    return config


def upgrade_to_head(db_path: Path | str | None = None) -> list[str]:
    """`alembic upgrade head`. 다시 실행해도 안전하다(이미 최신이면 아무것도 하지 않음)."""
    config = alembic_config(db_path)
    command.upgrade(config, "head")
    return current_revisions(db_path)


def downgrade(db_path: Path | str | None, target: str = "-1") -> list[str]:
    config = alembic_config(db_path)
    command.downgrade(config, target)
    return current_revisions(db_path)


def current_revisions(db_path: Path | str | None = None) -> list[str]:
    """DB에 적용된 현재 리비전 목록(머리가 둘이면 둘 다)."""
    from alembic.runtime.migration import MigrationContext

    from geosan.storage.engine import get_engine

    with get_engine(db_path).connect() as connection:
        context = MigrationContext.configure(connection)
        return sorted(context.get_current_heads())


def script_heads() -> list[str]:
    """마이그레이션 파일들의 머리(head) 목록."""
    script = ScriptDirectory.from_config(alembic_config())
    return sorted(script.get_heads())


def next_merge_rev_id() -> str:
    existing = sorted(p.name for p in VERSIONS_DIR.glob("merge_*.py"))
    numbers = [int(m.group(1)) for name in existing if (m := re.match(r"merge_(\d{3})_", name))]
    return f"merge_{(max(numbers) + 1 if numbers else 1):03d}"


def merge_heads(message: str = "merge heads") -> Path | None:
    """머리가 둘 이상이면 합치는 마이그레이션 파일을 만들고 경로를 돌려준다. 하나면 None."""
    heads = script_heads()
    if len(heads) < 2:
        return None
    rev_id = next_merge_rev_id()
    command.merge(alembic_config(), "heads", message=message, rev_id=rev_id)
    created = sorted(VERSIONS_DIR.glob(f"{rev_id}_*.py"))
    return created[-1] if created else None
