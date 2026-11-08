"""#327: 후보 찾기 저장 표가 생기고, 되돌리면 사라지고, 기존 자료가 남는지 확인한다.

임시 파일 DB에 실제 DB 변경 파일(migrations/)을 돌려서 본다. 찾기 코드·AI·웹 연결 검사는 아니다.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy.exc import IntegrityError

from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import new_id
from geosan.storage.metadata import metadata
from geosan.storage.migrate import alembic_config, current_revisions, downgrade, upgrade_to_head
from geosan.storage.session import session_scope

BEFORE = "opp_007"
HEAD = "src_002"
NEW_TABLES = {
    "opp_ingest_batch",
    "opp_merge_candidate",
    "src_source_contract",
    "src_ingestion_run",
    "src_factory_row",
    "src_candidate_judgment",
    "src_complex_fetch",
    "src_web_search_run",
    "src_web_candidate",
}
NEW_CUSTOMER_COLUMNS = {
    "ingest_batch_id",
    "ingested_at",
    "discovery_source",
    "discovery_source_url",
    "registry_status",
    "fit_level",
    "pick_reason",
    "own_plating_line_suspected",
    "own_plating_line_basis",
    "own_plating_line_source",
}
NEW_LINK_COLUMNS = {"source", "state", "confirmed_by", "evidence_ref"}
CHANGED_TABLES = {"opp_customer", "opp_process_link", "tg_transfer_log"}
# 사람 이름·연락처를 담는 칸 이름에 흔히 들어가는 글자(CON-11). 새 표·새 칸에 하나도 없어야 한다.
PERSONAL_WORDS = (
    "representative",
    "ceo",
    "owner",
    "person",
    "manager",
    "fax",
    "phone",
    "tel",
    "mobile",
    "email",
    "contact",
)
STAMP = "2026-11-06T00:00:00+00:00"


def _tables(db: Path) -> set[str]:
    with sqlite3.connect(db) as con:
        return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _columns(db: Path, table: str) -> dict[str, bool]:
    """칸 이름 → 꼭 채워야 하는 칸인지."""
    with sqlite3.connect(db) as con:
        return {r[1]: bool(r[3]) for r in con.execute(f"PRAGMA table_info({table})")}


def _indexes(db: Path, table: str) -> set[str]:
    with sqlite3.connect(db) as con:
        return {r[1] for r in con.execute(f"PRAGMA index_list({table})")}


def _insert_filled(con: sqlite3.Connection, table: str, **values: object) -> None:
    """꼭 채워야 하는 칸을 빠짐없이 채워 한 줄을 넣는다(옛 표 모양에도 쓰려고 칸을 DB에서 읽음)."""
    row = dict(values)
    for _, name, col_type, notnull, default, _ in con.execute(f"PRAGMA table_info({table})"):
        if name in row or not notnull or default is not None:
            continue
        kind = (col_type or "").upper()
        if "INT" in kind or "BOOL" in kind:
            row[name] = 0
        elif "FLOAT" in kind or "NUMERIC" in kind or "REAL" in kind:
            row[name] = 0
        elif "JSON" in kind:
            row[name] = "[]"
        elif "DATE" in kind:
            row[name] = "2026-11-06"
        else:
            row[name] = STAMP if name.endswith("_at") else "x"
    names = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    con.execute(f"INSERT INTO {table} ({names}) VALUES ({marks})", tuple(row.values()))


def _seed_old_rows(db: Path) -> None:
    with sqlite3.connect(db) as con:
        _insert_filled(con, "opp_customer", customer_id="cust-old", name="가상기업")
        _insert_filled(con, "opp_opportunity", opp_id="opp-old", customer_id="cust-old")
        _insert_filled(
            con, "opp_process_link", opp_id="opp-old", process_code="ZN_ELECTRO", superseded_at=None
        )
        _insert_filled(
            con,
            "tg_transfer_log",
            transfer_log_id="transfer-old",
            opp_id="opp-old",
            call_count=1,
            cost_usd="0.0123000000",
        )


def _old_rows(db: Path) -> tuple[object, ...]:
    with sqlite3.connect(db) as con:
        customer = con.execute(
            "SELECT name FROM opp_customer WHERE customer_id='cust-old'"
        ).fetchone()
        link = con.execute(
            "SELECT process_code FROM opp_process_link WHERE opp_id='opp-old'"
        ).fetchone()
        log = con.execute(
            "SELECT opp_id, call_count, cost_usd FROM tg_transfer_log "
            "WHERE transfer_log_id='transfer-old'"
        ).fetchone()
        assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    return customer, link, log


def _running_batch(**overrides: object) -> IngestBatch:
    values: dict[str, object] = {
        "batch_id": new_id("batch"),
        "source_id": "kicox-factory-csv",
        "requested_by": "SYSTEM",
        "started_at": datetime.now(UTC),
        "status": "RUNNING",
        "is_virtual": True,
    }
    return IngestBatch(**{**values, **overrides})


def _transfer_log(**overrides: object) -> TransferLog:
    values: dict[str, object] = {
        "transfer_log_id": new_id("transfer"),
        "occurred_at": datetime.now(UTC),
        "purpose": "EXTERNAL_AI",
        "kind": "PUBLIC_TEXT",
        "mode": "EXTERNAL",
        "security_grade": "PUBLIC",
        "decision": "ALLOWED",
        "call_count": 1,
        "is_virtual": True,
    }
    return TransferLog(**{**values, **overrides})


def test_empty_db_gets_all_candidate_search_tables(tmp_db: Path) -> None:
    """Given 빈 DB / When 최신으로 올림 / Then 새 표 9개와 회사·공정 연결·비용 기록 새 칸이 있다."""
    assert current_revisions(tmp_db) == [HEAD]
    assert NEW_TABLES <= _tables(tmp_db)
    assert NEW_CUSTOMER_COLUMNS <= set(_columns(tmp_db, "opp_customer"))
    assert NEW_LINK_COLUMNS <= set(_columns(tmp_db, "opp_process_link"))
    log_columns = _columns(tmp_db, "tg_transfer_log")
    assert log_columns["opp_id"] is False and log_columns["batch_id"] is False
    assert {"ix_tg_transfer_log_batch_id", "ix_tg_transfer_log_occurred_at"} <= _indexes(
        tmp_db, "tg_transfer_log"
    )


@pytest.mark.parametrize("table", sorted(NEW_TABLES | CHANGED_TABLES))
def test_model_and_migration_have_the_same_columns(tmp_db: Path, table: str) -> None:
    """표 정의(코드)와 DB 변경 파일이 만든 표의 칸 이름·필수 여부가 같다. 어긋나면 저장이 깨진다."""
    model = metadata().tables[table]
    expected = {column.name: not column.nullable for column in model.columns}
    assert _columns(tmp_db, table) == expected


def test_existing_rows_get_case_file_defaults_and_survive_round_trip(tmp_path: Path) -> None:
    """Given 옛 DB의 회사·공정 연결·비용 기록 / When 올리고 내리고 다시 올림 / Then 그대로다."""
    db = tmp_path / "existing.db"
    command.upgrade(alembic_config(db), BEFORE)
    _seed_old_rows(db)
    before = _old_rows(db)

    assert upgrade_to_head(db) == [HEAD]
    assert _old_rows(db) == before == (("가상기업",), ("ZN_ELECTRO",), ("opp-old", 1, 0.0123))
    with sqlite3.connect(db) as con:
        assert con.execute(
            "SELECT discovery_source, own_plating_line_suspected, ingest_batch_id, fit_level "
            "FROM opp_customer WHERE customer_id='cust-old'"
        ).fetchone() == ("CASE_FILE", 0, None, None)
        assert con.execute(
            "SELECT source, state FROM opp_process_link WHERE opp_id='opp-old'"
        ).fetchone() == ("CASE_FILE", "CONFIRMED")
        assert con.execute(
            "SELECT batch_id FROM tg_transfer_log WHERE transfer_log_id='transfer-old'"
        ).fetchone() == (None,)

    assert downgrade(db, BEFORE) == [BEFORE]
    assert not NEW_TABLES & _tables(db)
    assert not NEW_CUSTOMER_COLUMNS & set(_columns(db, "opp_customer"))
    assert not NEW_LINK_COLUMNS & set(_columns(db, "opp_process_link"))
    old_log = _columns(db, "tg_transfer_log")
    assert old_log["opp_id"] is True and "batch_id" not in old_log
    assert "ix_tg_transfer_log_occurred_at" in _indexes(db, "tg_transfer_log")
    assert _old_rows(db) == before

    assert upgrade_to_head(db) == [HEAD]
    assert NEW_TABLES <= _tables(db)
    assert _old_rows(db) == before


def test_new_tables_have_no_person_or_contact_columns(tmp_db: Path) -> None:
    """대표자 이름·팩스·전화·사람 연락처를 담는 칸이 새 표·새 칸에 없다(CON-11, #221 완료 기준)."""
    names = set(NEW_CUSTOMER_COLUMNS | NEW_LINK_COLUMNS | {"batch_id"})
    for table in NEW_TABLES:
        names |= {f"{table}.{column}" for column in _columns(tmp_db, table)}
    found = sorted(
        name
        for name in names
        if any(word in name.split(".")[-1].split("_") for word in PERSONAL_WORDS)
    )
    assert found == []


def test_only_one_batch_can_be_running(tmp_db: Path) -> None:
    """Given 실행 중 회차 / When 두 번째 실행 중 회차 저장 / Then DB가 막고, 끝나면 다시 된다."""
    first = _running_batch()
    with session_scope(tmp_db) as session:
        session.add(first)
    with pytest.raises(IntegrityError):
        with session_scope(tmp_db) as session:
            session.add(_running_batch())
    with session_scope(tmp_db) as session:
        batch = session.get(IngestBatch, first.batch_id)
        assert batch is not None
        assert (batch.rejudge, batch.new_count, batch.skipped_count) == (False, 0, 0)
        batch.status = "DONE"
        session.add(_running_batch(status="FAILED", failure_reason="소스 읽기 실패 — 가상"))
    with session_scope(tmp_db) as session:
        session.add(_running_batch(max_candidates=50, rejudge=True))
    with sqlite3.connect(tmp_db) as con:
        assert con.execute(
            "SELECT status, COUNT(*) FROM opp_ingest_batch GROUP BY status ORDER BY status"
        ).fetchall() == [("DONE", 1), ("FAILED", 1), ("RUNNING", 1)]


def test_ai_usage_row_needs_opportunity_or_batch(tmp_db: Path) -> None:
    """후보 판단 비용은 회차 번호만으로 남길 수 있고, 둘 다 없는 기록은 DB가 거부한다."""
    with session_scope(tmp_db) as session:
        session.add(_transfer_log(batch_id="batch-virtual"))
        session.add(_transfer_log(opp_id="opp-virtual"))
    with pytest.raises(IntegrityError):
        with session_scope(tmp_db) as session:
            session.add(_transfer_log())
    with sqlite3.connect(tmp_db) as con:
        assert con.execute(
            "SELECT opp_id, batch_id FROM tg_transfer_log ORDER BY batch_id IS NULL"
        ).fetchall() == [(None, "batch-virtual"), ("opp-virtual", None)]


def test_downgrade_stops_instead_of_dropping_batch_only_usage(tmp_db: Path) -> None:
    """회차로만 남긴 비용 기록이 있으면 되돌리기를 멈춘다. 지우거나 가짜 번호로 채우지 않는다."""
    with session_scope(tmp_db) as session:
        session.add(_transfer_log(batch_id="batch-virtual"))
    with pytest.raises(RuntimeError, match="1건이 있어 tg_003을 되돌릴 수 없습니다"):
        downgrade(tmp_db, "src_001")
    assert current_revisions(tmp_db) == [HEAD]
    with sqlite3.connect(tmp_db) as con:
        assert con.execute("SELECT opp_id, batch_id FROM tg_transfer_log").fetchall() == [
            (None, "batch-virtual")
        ]
