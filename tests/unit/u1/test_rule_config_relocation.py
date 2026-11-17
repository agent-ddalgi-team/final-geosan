"""다른 PC로 옮긴 같은 규칙 파일을 기존 버전에 다시 연결한다(#185)."""

from pathlib import Path

import pytest
from sqlalchemy import func, select

from geosan.config.models import RuleConfigVersion
from geosan.config.registry import DEFAULT_RULE_CONFIG_PATH, load_runtime_config
from geosan.config.rule_config import load_rule_config, register_rule_config_version
from geosan.storage.session import session_scope


@pytest.mark.parametrize("status", ["DRAFT", "FIXED"])
def test_same_rule_config_in_new_path_only_relinks_path(
    bare_db: Path, tmp_path: Path, status: str
) -> None:
    """Given 같은 내용의 이동본 / When 재등록 / Then 경로만 바뀌고 조회가 복구된다."""
    old_path = tmp_path / "old-rule.yaml"
    new_path = tmp_path / "moved-rule.yaml"
    old_path.write_bytes(DEFAULT_RULE_CONFIG_PATH.read_bytes())
    new_path.write_bytes(old_path.read_bytes())
    config = load_rule_config(old_path)
    with session_scope(bare_db) as session:
        row = register_rule_config_version(session, config, old_path)
        row.status = status
        session.flush()
        before = {column.name: getattr(row, column.name) for column in row.__table__.columns}
    old_path.unlink()

    with session_scope(bare_db) as session:
        row = register_rule_config_version(session, load_rule_config(new_path), new_path)
        session.flush()
        after = {column.name: getattr(row, column.name) for column in row.__table__.columns}
        assert after.pop("file_path") == str(new_path.resolve())
        before.pop("file_path")
        assert after == before
        assert session.scalar(select(func.count()).select_from(RuleConfigVersion)) == 1

    with session_scope(bare_db) as session:
        assert load_runtime_config(session).rule_config_path == new_path.resolve()
