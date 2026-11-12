"""#450: 임시 파일 DB의 옛 기록을 실제 마이그레이션으로 올리고 내린다."""

import sqlite3

from alembic import command

from geosan.storage.metadata import metadata
from geosan.storage.migrate import alembic_config, downgrade, upgrade_to_head
from tests.unit.u3.test_ingest_tables import _insert_filled


def test_old_records_stay_empty_and_survive_schema_round_trip(tmp_path):
    """Given 평가 번호 칸 없는 기록 / When 두 번 올리고 내렸다 올림 / Then 원문 보존·번호 비움."""
    db = tmp_path / "old-records.db"
    command.upgrade(alembic_config(db), "src_002")
    before = {}
    with sqlite3.connect(db) as connection:
        _insert_filled(connection, "opp_customer", customer_id="cust-old", name="가상 기업")
        _insert_filled(connection, "opp_opportunity", opp_id="opp-old", customer_id="cust-old")
        _insert_filled(connection, "rec_note", note_id="note-old", opp_id="opp-old", text="옛 메모")
        _insert_filled(
            connection, "rec_outcome", outcome_id="outcome-old", opp_id="opp-old", status="WON"
        )
        for table in ("rec_note", "rec_outcome"):
            before[table] = connection.execute(f"SELECT * FROM {table}").fetchall()
    for _ in range(2):
        assert upgrade_to_head(db) == ["rec_012"]
        with sqlite3.connect(db) as connection:
            for table, rows in before.items():
                assert connection.execute(f"SELECT * FROM {table}").fetchall() == [
                    # rec_outcome에는 뒤이어 judgment_check(rec_010)와 step_override(rec_012)도
                    # 비어 있는 채로 붙는다.
                    (*row, None, *([None, None] if table == "rec_outcome" else []))
                    for row in rows
                ]
                columns = {row[1]: row for row in connection.execute(f"PRAGMA table_info({table})")}
                assert columns["eval_id"][2:4] == ("VARCHAR(40)", 0)
                assert set(columns) == set(metadata().tables[table].columns.keys())
            assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert downgrade(db, "src_002") == ["src_002"]
        with sqlite3.connect(db) as connection:
            for table, rows in before.items():
                assert connection.execute(f"SELECT * FROM {table}").fetchall() == rows
    assert upgrade_to_head(db) == ["rec_012"]
