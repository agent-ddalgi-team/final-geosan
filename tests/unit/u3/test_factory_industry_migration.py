"""#617: 회사 표에 공장 등록 업종명 열을 더하는 DB 변경 파일(src_005).

실제 DB 변경 파일(migrations/)을 임시 파일 DB에 돌린다. 가상 자료만 쓰고 외부 호출은 없다.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic import command

from geosan.storage.migrate import alembic_config, current_revisions, downgrade, upgrade_to_head
from tests.unit.u3.test_ingest_tables import _columns, _insert_filled

BEFORE = "src_004"
HEAD = "merge_002"  # 최신 이관(#549의 예상 금액 칸이 맨 뒤에 붙는다)


def test_old_companies_keep_their_values_and_get_an_empty_industry_name(tmp_path: Path) -> None:
    """Given 열이 없던 옛 회사 / When 최신으로 올림 / Then 빈 업종명, 되돌려도 회사 유지."""
    db = tmp_path / "old.db"
    command.upgrade(alembic_config(db), BEFORE)
    assert "factory_industry_name" not in _columns(db, "opp_customer")
    with sqlite3.connect(db) as con:
        _insert_filled(con, "opp_customer", customer_id="cust-old", factory_scale="소기업")

    assert upgrade_to_head(db) == [HEAD]
    assert _columns(db, "opp_customer")["factory_industry_name"] is False  # 비워 둘 수 있는 칸
    with sqlite3.connect(db) as con:
        rows = con.execute(
            "SELECT customer_id, factory_scale, factory_industry_name FROM opp_customer"
        ).fetchall()
    assert rows == [("cust-old", "소기업", None)]

    assert downgrade(db, BEFORE) == [BEFORE]
    assert "factory_industry_name" not in _columns(db, "opp_customer")
    with sqlite3.connect(db) as con:
        assert con.execute("SELECT customer_id FROM opp_customer").fetchall() == [("cust-old",)]
    assert upgrade_to_head(db) == [HEAD]
    assert current_revisions(db) == [HEAD]
