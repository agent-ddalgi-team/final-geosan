"""#536: 검토 대상 제외인 회사의 관심을 끄는 DB 변경 파일(rec_011)이 옛 기록을 제대로 고치는지 본다.

임시 파일 DB를 rec_010까지 올리고 관심·검토 의견 행을 직접 넣은 뒤 최신으로 올린다.
"관심 켬 + 최신 의견 제외"인 회사만 관심 끔 행이 하나 더해지고, 다른 행은 그대로인지,
되돌리면 더한 행만 빠지는지 확인한다. 가상 자료만 쓴다.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic import command

from geosan.storage.migrate import alembic_config, current_revisions, downgrade, upgrade_to_head
from tests.unit.u3.test_ingest_tables import _insert_filled

BEFORE = "rec_010"
HEAD = "src_005"


def _seed(db: Path) -> None:
    with sqlite3.connect(db) as con:
        _insert_filled(con, "opp_customer", customer_id="cust-old", name="가상기업")
        for opp_id, dataset_kind, is_virtual in (
            ("opp-excluded", "VIRTUAL_REVIEWED", 1),
            ("opp-excluded-real", "BROCHURE", 0),
            ("opp-back", "VIRTUAL_REVIEWED", 1),
            ("opp-off", "VIRTUAL_REVIEWED", 1),
            ("opp-check", "VIRTUAL_REVIEWED", 1),
            ("opp-tie", "VIRTUAL_REVIEWED", 1),
        ):
            _insert_filled(
                con,
                "opp_opportunity",
                opp_id=opp_id,
                customer_id="cust-old",
                dataset_kind=dataset_kind,
                is_virtual=is_virtual,
            )

        def bookmark(bookmark_id, opp_id, version, active, dataset_kind="VIRTUAL_REVIEWED"):
            _insert_filled(
                con,
                "rec_bookmark",
                bookmark_id=bookmark_id,
                opp_id=opp_id,
                version=version,
                active=active,
                staff_key="park-lee",
                source="MANUAL",
                session_ref=None,
                dataset_kind=dataset_kind,
                is_virtual=1 if dataset_kind == "VIRTUAL_REVIEWED" else 0,
            )

        def opinion(opinion_id, opp_id, version, value, staff="park-lee", at="2026-11-06T01:00"):
            _insert_filled(
                con,
                "rec_review_opinion",
                opinion_id=opinion_id,
                opp_id=opp_id,
                version=version,
                opinion=value,
                staff_name=staff,
                recorded_at=at,
            )

        # 관심을 켰다 끈 뒤 다시 켜고, 최신 의견이 제외 → 끄는 대상(버전 4로).
        bookmark("bm-ex-1", "opp-excluded", 1, 1)
        bookmark("bm-ex-2", "opp-excluded", 2, 0)
        bookmark("bm-ex-3", "opp-excluded", 3, 1)
        opinion("op-ex-1", "opp-excluded", 1, "WORTH_REVIEW")
        opinion("op-ex-2", "opp-excluded", 2, "NOT_TARGET", staff="kim-gwajang")
        # 실제 소개서 묶음 회사도 같은 규칙. 자료 묶음·가상 표시는 그 회사 것을 따른다.
        bookmark("bm-real-1", "opp-excluded-real", 1, 1, dataset_kind="BROCHURE")
        opinion("op-real-1", "opp-excluded-real", 1, "NOT_TARGET")
        # 제외였다가 의견을 되돌린 회사 → 그대로.
        bookmark("bm-back-1", "opp-back", 1, 1)
        opinion("op-back-1", "opp-back", 1, "NOT_TARGET")
        opinion("op-back-2", "opp-back", 2, "NEED_CHECK")
        # 이미 꺼진 회사 → 그대로.
        bookmark("bm-off-1", "opp-off", 1, 1)
        bookmark("bm-off-2", "opp-off", 2, 0)
        opinion("op-off-1", "opp-off", 1, "NOT_TARGET")
        # 제외가 아닌 관심 기업 → 그대로.
        bookmark("bm-check-1", "opp-check", 1, 1)
        opinion("op-check-1", "opp-check", 1, "NEED_CHECK")
        # 같은 버전이면 나중에 저장한 의견이 최신(화면·대시보드와 같은 순서) → 제외라서 끈다.
        bookmark("bm-tie-1", "opp-tie", 1, 1)
        opinion("op-tie-a", "opp-tie", 1, "WORTH_REVIEW", at="2026-11-06T01:00")
        opinion("op-tie-b", "opp-tie", 1, "NOT_TARGET", staff="lee-daeri", at="2026-11-06T02:00")


def _bookmarks(db: Path) -> list[tuple]:
    with sqlite3.connect(db) as con:
        return con.execute(
            "SELECT opp_id, version, active, source, staff_key, created_by, dataset_kind, "
            "is_virtual FROM rec_bookmark ORDER BY opp_id, version"
        ).fetchall()


def _old_db(tmp_path: Path) -> Path:
    db = tmp_path / "old.db"
    command.upgrade(alembic_config(db), BEFORE)
    _seed(db)
    return db


def test_upgrade_turns_off_bookmark_of_excluded_companies_only(tmp_path: Path) -> None:
    """Given 관심 켬 + 최신 의견 제외인 회사가 섞인 옛 DB / When 최신으로 올림
    / Then 그 회사들만 관심 끔 행이 하나 더해지고, 나머지 행은 하나도 바뀌지 않는다."""
    db = _old_db(tmp_path)
    before = _bookmarks(db)
    assert upgrade_to_head(db) == [HEAD]
    after = _bookmarks(db)
    added = sorted(set(after) - set(before))
    assert set(before) <= set(after)
    assert added == [
        ("opp-excluded", 4, 0, "AUTO_RECORD", "kim-gwajang", "kim-gwajang", "VIRTUAL_REVIEWED", 1),
        ("opp-excluded-real", 2, 0, "AUTO_RECORD", "park-lee", "park-lee", "BROCHURE", 0),
        ("opp-tie", 2, 0, "AUTO_RECORD", "lee-daeri", "lee-daeri", "VIRTUAL_REVIEWED", 1),
    ]
    # 다시 올려도 더하지 않는다(이미 최신).
    assert upgrade_to_head(db) == [HEAD]
    assert _bookmarks(db) == after


def test_downgrade_removes_only_rows_added_by_this_migration(tmp_path: Path) -> None:
    """Given 최신으로 올린 뒤 담당자가 관심을 또 바꿈 / When rec_010으로 되돌림
    / Then 이 파일이 더한 행만 빠지고 원래 행과 담당자가 남긴 행은 남는다."""
    db = _old_db(tmp_path)
    before = _bookmarks(db)
    upgrade_to_head(db)
    with sqlite3.connect(db) as con:
        _insert_filled(
            con,
            "rec_bookmark",
            bookmark_id="bm-check-2",
            opp_id="opp-check",
            version=2,
            active=0,
            staff_key="park-lee",
            source="MANUAL",
            session_ref=None,
            dataset_kind="VIRTUAL_REVIEWED",
            is_virtual=1,
        )
    assert downgrade(db, BEFORE) == [BEFORE]
    assert current_revisions(db) == [BEFORE]
    assert _bookmarks(db) == sorted(
        [*before, ("opp-check", 2, 0, "MANUAL", "park-lee", "x", "VIRTUAL_REVIEWED", 1)]
    )
