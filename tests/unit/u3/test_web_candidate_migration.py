"""#499 승인 마이그레이션: 기존 공장 판단 보존·외래키·둘 중 하나·내리기 보호."""

import sqlite3

import pytest
from alembic import command

from geosan.storage.metadata import metadata
from geosan.storage.migrate import alembic_config, downgrade, upgrade_to_head
from tests.unit.u3.test_ingest_tables import _insert_filled


def test_upgrade_preserves_old_judgment_and_round_trip(tmp_path):
    path = tmp_path / "old.db"
    command.upgrade(alembic_config(path), "rec_009")
    with sqlite3.connect(path) as con:
        _insert_filled(con, "src_factory_row", row_id="factory-old")
        _insert_filled(
            con, "src_candidate_judgment", judgment_id="judgment-old", row_id="factory-old"
        )
        con.row_factory = sqlite3.Row
        before = dict(con.execute("SELECT * FROM src_candidate_judgment").fetchone())
    for _ in range(2):
        assert upgrade_to_head(path) == ["opp_010"]
        with sqlite3.connect(path) as con:
            con.row_factory = sqlite3.Row
            assert dict(
                con.execute("SELECT * FROM src_candidate_judgment").fetchone()
            ) == before | {"web_candidate_id": None}
            for table in ("src_web_candidate", "src_candidate_judgment"):
                assert {r[1] for r in con.execute(f"PRAGMA table_info({table})")} == set(
                    metadata().tables[table].columns.keys()
                )
            assert con.execute("PRAGMA foreign_key_check").fetchall() == []
        assert downgrade(path, "rec_009") == ["rec_009"]
        with sqlite3.connect(path) as con:
            con.row_factory = sqlite3.Row
            assert dict(con.execute("SELECT * FROM src_candidate_judgment").fetchone()) == before

    upgrade_to_head(path)
    with sqlite3.connect(path) as con:
        _insert_filled(con, "src_web_search_run", run_id="with-snippet")
        _insert_filled(
            con,
            "src_web_candidate",
            candidate_id="with-snippet",
            run_id="with-snippet",
            snippet="볼트 생산",
        )
    with pytest.raises(RuntimeError, match="데이터 손실"):
        downgrade(path, "rec_009")


def test_database_rejects_both_neither_and_missing_reference(tmp_db):
    with sqlite3.connect(tmp_db) as con:
        con.execute("PRAGMA foreign_keys=ON")
        _insert_filled(con, "src_factory_row", row_id="factory")
        _insert_filled(con, "src_web_search_run", run_id="web-run")
        _insert_filled(con, "src_web_candidate", candidate_id="web", run_id="web-run")
        con.commit()
        for factory, web in [(None, None), ("factory", "web"), (None, "missing")]:
            with pytest.raises(sqlite3.IntegrityError):
                _insert_filled(
                    con,
                    "src_candidate_judgment",
                    judgment_id="bad",
                    row_id=factory,
                    web_candidate_id=web,
                )
            con.rollback()
        _insert_filled(
            con, "src_candidate_judgment", judgment_id="good", row_id=None, web_candidate_id="web"
        )
        con.commit()
        assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    with pytest.raises(RuntimeError, match="데이터 손실"):
        downgrade(tmp_db, "rec_009")
    with sqlite3.connect(tmp_db) as con:
        assert con.execute(
            "SELECT web_candidate_id FROM src_candidate_judgment WHERE judgment_id='good'"
        ).fetchone() == ("web",)
