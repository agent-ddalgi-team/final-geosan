"""#356: 관심 표(rec_bookmark)를 만드는 DB 변경 파일이 옛 기록을 제대로 옮기는지 본다.

임시 파일 DB에 실제 DB 변경 파일(migrations/)을 돌린다. 옛 DB(tg_003)에 메모·영업 기록·검토
의견을 직접 넣고 최신으로 올려서, 기록이 있던 회사만 관심으로 켜지고 영업 단계 INTERESTED가
NOT_EXECUTED로 바뀌는지 확인한다. 가상 자료만 쓴다.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from alembic import command
from sqlalchemy import select

from geosan.records.models import Bookmark
from geosan.storage.metadata import metadata
from geosan.storage.migrate import alembic_config, current_revisions, downgrade, upgrade_to_head
from geosan.storage.session import session_scope
from tests.unit.u3.test_ingest_tables import (
    PERSONAL_WORDS,
    _columns,
    _indexes,
    _insert_filled,
    _tables,
)

BEFORE = "tg_003"
HEAD = "src_006"
RECORD_TABLES = ("rec_note", "rec_outcome", "rec_review_opinion")
# 기회 번호 → (자료 묶음, 가상 여부). opp-none만 기록이 하나도 없다.
OPPORTUNITIES = {
    "opp-note": ("VIRTUAL_REVIEWED", 1),
    "opp-interest": ("VIRTUAL_REVIEWED", 1),
    "opp-stages": ("VIRTUAL_REVIEWED", 1),
    "opp-opinion": ("BROCHURE", 0),
    "opp-all": ("VIRTUAL_REVIEWED", 1),
    "opp-none": ("VIRTUAL_REVIEWED", 1),
}
RECORDED = set(OPPORTUNITIES) - {"opp-none"}


def _seed_old_records(db: Path) -> None:
    with sqlite3.connect(db) as con:
        _insert_filled(con, "opp_customer", customer_id="cust-old", name="가상기업")
        for opp_id, (dataset_kind, is_virtual) in OPPORTUNITIES.items():
            _insert_filled(
                con,
                "opp_opportunity",
                opp_id=opp_id,
                customer_id="cust-old",
                dataset_kind=dataset_kind,
                is_virtual=is_virtual,
            )

        def note(note_id, opp_id, version=1):
            _insert_filled(con, "rec_note", note_id=note_id, opp_id=opp_id, version=version)

        def outcome(outcome_id, opp_id, status, version=1):
            _insert_filled(
                con,
                "rec_outcome",
                outcome_id=outcome_id,
                opp_id=opp_id,
                status=status,
                version=version,
            )

        def opinion(opinion_id, opp_id, value):
            _insert_filled(
                con, "rec_review_opinion", opinion_id=opinion_id, opp_id=opp_id, opinion=value
            )

        note("note-1", "opp-note")
        note("note-2", "opp-note", version=2)
        outcome("outcome-interest", "opp-interest", "INTERESTED")
        # 단계 이력: 관심 → 접촉 → 관심. 관심이던 행만 미접촉으로 바뀌어야 한다.
        outcome("outcome-s1", "opp-stages", "INTERESTED", 1)
        outcome("outcome-s2", "opp-stages", "IN_PROGRESS", 2)
        outcome("outcome-s3", "opp-stages", "INTERESTED", 3)
        opinion("opinion-1", "opp-opinion", "NEED_CHECK")
        note("note-all", "opp-all")
        outcome("outcome-all-1", "opp-all", "WON")
        outcome("outcome-all-2", "opp-all", "LOST", 2)
        opinion("opinion-all", "opp-all", "WORTH_REVIEW")
        # 어느 기회에도 붙지 않은 옛 의견(이 표의 기회 번호는 연결 검사가 없다)은 옮기지 않는다.
        opinion("opinion-orphan", "opp-gone", "WORTH_REVIEW")


def _record_counts(db: Path) -> dict[str, int]:
    with sqlite3.connect(db) as con:
        return {
            table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in RECORD_TABLES
        }


def _stages(db: Path) -> dict[str, str]:
    with sqlite3.connect(db) as con:
        return dict(con.execute("SELECT outcome_id, status FROM rec_outcome"))


def _old_db(tmp_path: Path) -> Path:
    db = tmp_path / "old.db"
    command.upgrade(alembic_config(db), BEFORE)
    assert "rec_bookmark" not in _tables(db)
    _seed_old_records(db)
    return db


def test_new_db_has_bookmark_table_matching_the_model(tmp_db: Path) -> None:
    """Given 빈 DB / When 최신으로 올림 / Then 관심 표의 칸·필수 여부가 코드와 같고 색인이 있다."""
    assert current_revisions(tmp_db) == [HEAD]
    model = metadata().tables["rec_bookmark"]
    expected = {column.name: not column.nullable for column in model.columns}
    assert _columns(tmp_db, "rec_bookmark") == expected
    assert set(expected) == {
        "bookmark_id",
        "opp_id",
        "active",
        "staff_key",
        "source",
        "version",
        "created_at",
        "created_by",
        "session_ref",
        "dataset_kind",
        "is_virtual",
    }
    assert {index.name for index in model.indexes} == {"ix_rec_bookmark_opp_id"}
    assert "ix_rec_bookmark_opp_id" in _indexes(tmp_db, "rec_bookmark")
    # 사람 이름·연락처를 담는 칸은 없다(CON-11).
    assert not [name for name in expected if set(name.split("_")) & set(PERSONAL_WORDS)]


def test_upgrade_bookmarks_recorded_companies_and_retires_interested(tmp_path: Path) -> None:
    """Given 옛 DB의 기록 / When 최신으로 올림 / Then 기록 있던 회사만 관심, 관심 단계는 미접촉."""
    db = _old_db(tmp_path)
    counts = _record_counts(db)
    assert counts == {"rec_note": 3, "rec_outcome": 6, "rec_review_opinion": 3}

    assert upgrade_to_head(db) == [HEAD]

    with sqlite3.connect(db) as con:
        rows = con.execute(
            "SELECT opp_id, active, source, staff_key, version, created_by, dataset_kind, "
            "is_virtual, session_ref FROM rec_bookmark ORDER BY opp_id"
        ).fetchall()
        assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    # 기록이 있던 회사마다 한 행(켬). 기록 없는 회사와 떨어진 의견의 기회는 없다.
    assert rows == [
        (opp_id, 1, "MIGRATED", "system", 1, "system", *OPPORTUNITIES[opp_id], None)
        for opp_id in sorted(RECORDED)
    ]
    # 관심 단계 행만 미접촉이 되고 다른 단계는 그대로다. 행 수도 그대로다.
    assert _stages(db) == {
        "outcome-interest": "NOT_EXECUTED",
        "outcome-s1": "NOT_EXECUTED",
        "outcome-s2": "IN_PROGRESS",
        "outcome-s3": "NOT_EXECUTED",
        "outcome-all-1": "WON",
        "outcome-all-2": "LOST",
    }
    assert _record_counts(db) == counts
    # 저장 시각은 다른 표와 같은 글자 모양(UTC)이라 코드가 그대로 읽는다.
    with session_scope(db) as session:
        bookmarks = list(session.scalars(select(Bookmark)))
        assert {row.opp_id for row in bookmarks} == RECORDED
        assert all(row.bookmark_id.startswith("bookmark-") for row in bookmarks)
        assert len({row.bookmark_id for row in bookmarks}) == len(RECORDED)
        assert all(row.active is True for row in bookmarks)
        assert all(row.created_at.utcoffset() == timedelta(0) for row in bookmarks)
    with sqlite3.connect(db) as con:
        stamps = [row[0] for row in con.execute("SELECT created_at FROM rec_bookmark")]
    assert all(stamp.endswith("+00:00") and "." in stamp for stamp in stamps)
    assert all(datetime.fromisoformat(stamp).tzinfo is not None for stamp in stamps)
    # 다시 올려도 같은 상태다(행이 두 번 생기지 않는다).
    assert upgrade_to_head(db) == [HEAD]
    with sqlite3.connect(db) as con:
        assert con.execute("SELECT COUNT(*) FROM rec_bookmark").fetchone()[0] == len(RECORDED)


def test_round_trip_keeps_records_and_does_not_restore_interested(tmp_path: Path) -> None:
    """Given 올린 DB / When 한 단계 내렸다 다시 올림 / Then 메모·의견·영업 기록 행 수는 그대로다."""
    db = _old_db(tmp_path)
    counts = _record_counts(db)
    assert upgrade_to_head(db) == [HEAD]
    migrated = _stages(db)

    assert downgrade(db, BEFORE) == [BEFORE]
    assert "rec_bookmark" not in _tables(db)
    assert _record_counts(db) == counts
    # 되돌려도 관심 단계로 복구하지 않는다(약속 C6).
    assert _stages(db) == migrated
    assert "INTERESTED" not in migrated.values()

    assert upgrade_to_head(db) == [HEAD]
    assert _record_counts(db) == counts
    assert _stages(db) == migrated
    with sqlite3.connect(db) as con:
        rows = con.execute(
            "SELECT opp_id, active, source, version FROM rec_bookmark ORDER BY opp_id"
        ).fetchall()
    assert rows == [(opp_id, 1, "MIGRATED", 1) for opp_id in sorted(RECORDED)]
