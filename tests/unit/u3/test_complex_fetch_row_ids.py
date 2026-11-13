"""#405: 단지 조회 기록의 "받은 행 번호 목록" 칸.

옛 DB를 올리면 빈 목록으로 채워지고, 새 기록은 조회마다 자기 목록을 보존한다.

실제 DB 변경 파일(migrations/)을 임시 파일 DB에 돌린다. 가상 자료만 쓰고 외부 호출은 없다.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from sqlalchemy import select

from geosan.opportunity.source_models import ComplexFetch
from geosan.storage.migrate import alembic_config, current_revisions, downgrade, upgrade_to_head
from geosan.storage.session import session_scope
from tests.unit.u3.test_ingest_tables import _columns, _insert_filled

BEFORE = "rec_008"
HEAD = "rec_014"


def test_old_fetch_rows_get_an_empty_row_id_list_and_survive_round_trip(tmp_path: Path) -> None:
    """Given 칸이 없던 옛 기록 / When 최신으로 올림 / Then 빈 목록, 되돌려도 기록 유지."""
    db = tmp_path / "old.db"
    command.upgrade(alembic_config(db), BEFORE)
    assert "row_ids" not in _columns(db, "src_complex_fetch")
    with sqlite3.connect(db) as con:
        _insert_filled(
            con, "src_complex_fetch", fetch_id="fetch-old", complex_name="가상단지", row_count=3
        )

    assert upgrade_to_head(db) == [HEAD]
    assert _columns(db, "src_complex_fetch")["row_ids"] is True  # 꼭 채우는 칸
    with sqlite3.connect(db) as con:
        assert con.execute("SELECT row_ids FROM src_complex_fetch").fetchall() == [("[]",)]

    assert downgrade(db, BEFORE) == [BEFORE]
    assert "row_ids" not in _columns(db, "src_complex_fetch")
    with sqlite3.connect(db) as con:
        assert con.execute("SELECT fetch_id, row_count FROM src_complex_fetch").fetchall() == [
            ("fetch-old", 3)
        ]
    assert upgrade_to_head(db) == [HEAD]
    assert current_revisions(db) == [HEAD]


def test_new_fetch_keeps_its_own_row_list_even_when_another_fetch_shares_rows(tmp_db) -> None:
    """Given 두 조회가 같은 행을 받음 / When 저장 / Then 각 조회의 목록은 그대로, 기본은 빈 목록."""
    now = datetime.now(UTC)
    with session_scope() as session:
        session.add(
            ComplexFetch(
                fetch_id="fetch-short",
                complex_name="천안제3",
                fetched_at=now,
                expires_at=now + timedelta(days=15),
                row_count=2,
                status="OK",
                row_ids=["row-a", "row-b"],
                created_by="system",
            )
        )
        session.add(
            ComplexFetch(
                fetch_id="fetch-full",
                complex_name="천안제3일반산업단지",
                fetched_at=now + timedelta(hours=1),
                expires_at=now + timedelta(days=15, hours=1),
                row_count=3,
                status="OK",
                row_ids=["row-b", "row-c", "row-d"],
                created_by="system",
            )
        )
        session.add(
            ComplexFetch(
                fetch_id="fetch-empty",
                complex_name="가상빈단지",
                fetched_at=now,
                expires_at=now + timedelta(days=15),
                row_count=0,
                status="OK",
                created_by="system",
            )
        )
    with session_scope() as session:
        rows = {
            row.fetch_id: row.row_ids
            for row in session.scalars(select(ComplexFetch).order_by(ComplexFetch.fetch_id))
        }
    assert rows == {
        "fetch-empty": [],
        "fetch-full": ["row-b", "row-c", "row-d"],
        "fetch-short": ["row-a", "row-b"],
    }
