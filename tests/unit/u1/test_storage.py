"""저장소 단위 테스트 (Step 12, 단위 테스트 지침 3장 storage/ 6개 + 시각 보존 1개).

구현 뒤에 쓰는 단위 테스트(Testing Contract custom). 임시 파일 DB(tmp_db)만 쓰고 메모리 DB는
쓰지 않는다.
"""

from __future__ import annotations

import re
import sqlite3
import time
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import StatementError

from geosan.capability.models import Process
from geosan.storage.base import new_id, new_ulid
from geosan.storage.engine import BUSY_TIMEOUT_MS, get_engine
from geosan.storage.init_db import init_db
from geosan.storage.metadata import TABLE_PREFIXES, table_names
from geosan.storage.migrate import (
    ALEMBIC_INI,
    current_revisions,
    downgrade,
    script_heads,
    upgrade_to_head,
)
from geosan.storage.session import session_scope

ULID_PATTERN = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def _table_names(db_path: Path) -> list[str]:
    with sqlite3.connect(db_path) as con:
        rows = con.execute("select name from sqlite_master where type='table' order by name")
        return [r[0] for r in rows]


def _column_names(db_path: Path, table: str) -> list[str]:
    with sqlite3.connect(db_path) as con:
        return [r[1] for r in con.execute(f"PRAGMA table_info({table})")]


def test_connection_uses_wal_busy_timeout_and_foreign_keys(tmp_db: Path) -> None:
    """연결마다 WAL·busy_timeout 5000·외래 키 검사가 켜진다(계약 C6, 안정성 설계 3장)."""
    with get_engine(tmp_db).connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert connection.execute(text("PRAGMA busy_timeout")).scalar() == BUSY_TIMEOUT_MS
        assert connection.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_common_columns_are_filled_automatically(tmp_db: Path) -> None:
    """created_at(UTC, 시간대 포함)·created_by·is_virtual을 저장소가 자동으로 채운다 (보안 6장)."""
    before = datetime.now(UTC) - timedelta(seconds=1)
    with session_scope(tmp_db) as session:
        session.add(
            Process(
                process_id=new_id("proc"),
                code="ANODIZING",
                name="아노다이징 — 가상",
                material_codes=["AL"],
                performance_tags=["CORROSION"],
                review_status="REVIEWED",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    with session_scope(tmp_db) as session:
        row = session.scalars(select(Process)).one()
        assert row.created_by == "system"
        assert row.session_ref is None
        assert row.is_virtual is True
        assert row.created_at.tzinfo is not None
        assert row.created_at.utcoffset() == timedelta(0)
        assert before <= row.created_at <= datetime.now(UTC)


def test_init_db_applies_migrations_and_is_safe_to_rerun(tmp_db: Path) -> None:
    """init-db는 마이그레이션을 끝까지 적용하고 다시 실행해도 같은 상태다(NFR7.6)."""
    first = current_revisions(tmp_db)
    assert first == script_heads() == ["rec_005"]
    tables_before = _table_names(tmp_db)
    init_db(tmp_db)
    assert current_revisions(tmp_db) == first
    assert _table_names(tmp_db) == tables_before


def test_downgrade_one_step_drops_last_prefix_and_upgrade_restores(tmp_db: Path) -> None:
    """#209 새 기록과 고객 열을 역순으로 되돌린 뒤 U1 복원까지 검증한다."""
    assert downgrade(tmp_db, "-1") == ["opp_003"]
    assert "kind" not in _column_names(tmp_db, "rec_note")
    assert downgrade(tmp_db, "-1") == ["rec_004"]
    assert "main_phone_confirmed_at" not in _column_names(tmp_db, "opp_customer")
    assert downgrade(tmp_db, "-1") == ["rec_003"]
    assert "rec_outcome" not in _table_names(tmp_db)
    assert "rec_note" in _table_names(tmp_db)
    assert downgrade(tmp_db, "-1") == ["opp_002"]
    assert "rec_note" not in _table_names(tmp_db)
    assert downgrade(tmp_db, "-1") == ["rec_002"]
    assert "summary_line" not in _column_names(tmp_db, "opp_customer")
    assert downgrade(tmp_db, "-1") == ["rec_001"]
    assert "card_reason" not in _column_names(tmp_db, "opp_opportunity")
    assert "rec_review_opinion" in _table_names(tmp_db)
    assert downgrade(tmp_db, "-1") == ["q_001"]
    names = _table_names(tmp_db)
    assert "rec_review_opinion" not in names
    assert "q_question" in names
    assert upgrade_to_head(tmp_db) == ["rec_005"]
    assert {"rec_note", "rec_outcome"} <= set(_table_names(tmp_db))
    assert "summary_line" in _column_names(tmp_db, "opp_customer")
    assert "rec_review_opinion" in _table_names(tmp_db)
    assert "card_reason" in _column_names(tmp_db, "opp_opportunity")
    assert "summary" in _column_names(tmp_db, "eval_item_judgment")


def test_all_prefixed_tables_exist_and_match_models(tmp_db: Path) -> None:
    """계약 C6의 U1 28개와 #209 기록 2개가 모델과 일치한다."""
    expected_counts = {
        "cfg_": 2,
        "cap_": 7,
        "opp_": 7,
        "ev_": 1,
        "eval_": 7,
        "q_": 3,
        "rec_": 3,
    }
    db_tables = set(_table_names(tmp_db)) - {"alembic_version"}
    assert db_tables == set(table_names())
    assert len(db_tables) == 30
    for prefix in TABLE_PREFIXES:
        assert len(table_names(prefix)) == expected_counts[prefix], prefix
    assert all(any(name.startswith(p) for p in TABLE_PREFIXES) for name in db_tables)


def test_id_has_prefix_and_ulid_shape() -> None:
    """ID는 '접두사-ULID(26자)'이고 서로 겹치지 않으며 시간순으로 정렬된다."""
    ids = {new_id("opp") for _ in range(500)}
    assert len(ids) == 500
    sample = next(iter(ids))
    prefix, ulid = sample.split("-", 1)
    assert prefix == "opp"
    assert ULID_PATTERN.match(ulid), ulid
    assert ULID_PATTERN.match(new_ulid())
    earlier = new_ulid()
    time.sleep(0.003)
    later = new_ulid()
    assert earlier < later
    with pytest.raises(ValueError):
        new_id("bad-prefix")


def test_datetime_keeps_timezone_and_rejects_naive(tmp_db: Path) -> None:
    """시각은 시간대와 함께 저장·복원되고(UTC로 정규화), 시간대 없는 값은 거부한다(NFR12)."""
    seoul = timezone(timedelta(hours=9))
    stamped = datetime(2026, 10, 19, 9, 0, tzinfo=seoul)
    with session_scope(tmp_db) as session:
        session.add(
            Process(
                process_id=new_id("proc"),
                code="CHROMATE",
                name="크로메이트 — 가상",
                material_codes=[],
                performance_tags=[],
                review_status="PENDING",
                created_at=stamped,
            )
        )
    with session_scope(tmp_db) as session:
        row = session.scalars(select(Process)).one()
        assert row.created_at == stamped
        assert row.created_at.utcoffset() == timedelta(0)
    with pytest.raises(StatementError, match="시간대"):
        with session_scope(tmp_db) as session:
            session.add(
                Process(
                    process_id=new_id("proc"),
                    code="PASSIVATION",
                    name="부동태 — 가상",
                    material_codes=[],
                    performance_tags=[],
                    review_status="PENDING",
                    created_at=datetime(2026, 10, 19, 9, 0),
                )
            )


def test_alembic_ini_is_ascii_only() -> None:
    """`alembic.ini`에 한글이 없다. Alembic이 운영체제 기본 인코딩으로 읽어 윈도우(CP949)에서
    한글 주석이 있으면 init-db가 깨진다(이슈 #33). 설명은 migrate.py 머리글에 둔다."""
    text = ALEMBIC_INI.read_bytes()
    bad = [i + 1 for i, line in enumerate(text.splitlines()) if not line.isascii()]
    assert bad == [], f"alembic.ini {bad}번째 줄에 영문이 아닌 글자가 있습니다"
    text.decode("cp949")  # 윈도우 기본 인코딩으로도 읽힌다
