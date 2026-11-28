"""#984 달력 날짜 메모(GET·POST /day-memos, DELETE /day-memos/{memoId}). PM 결정 2026-11-28.

실제 임시 DB(SQLite)와 실제 API로 확인한다. 외부 호출 없음. 메모 글은 모두 가상이다.
담당자 키는 예시 설정의 역할 이름이다(영업 담당 park-lee, 검수 담당 kim-gwajang, 보기 전용 viewer).
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.api.routes import day_memos as route
from geosan.config.app_settings import set_active_dataset_kind
from geosan.records.models import DAY_MEMO_TEXT_MAX_LENGTH, DayMemo
from geosan.storage.migrate import alembic_config, current_revisions, downgrade, upgrade_to_head
from geosan.storage.session import session_scope

URL = "/api/v1/day-memos"
SALES = {"X-Staff-Key": "park-lee"}
TECH = {"X-Staff-Key": "kim-gwajang"}
VIEWER = {"X-Staff-Key": "viewer"}
START = datetime(2026, 11, 5, 1, 0, tzinfo=UTC)
DAY = "2026-11-05"
BEFORE = "rec_019"
HEAD = "rec_021"


@pytest.fixture
def memo_client(tmp_db, monkeypatch):
    """임시 DB에 붙은 API. 시각은 부를 때마다 1초씩 가는 고정 시계로 둔다(쓴 순서를 분명히)."""
    ticks = iter(START + timedelta(seconds=step) for step in range(10_000))
    monkeypatch.setattr(route, "utcnow", lambda: next(ticks))
    with TestClient(create_app()) as client:
        yield client


def add(client, day, text, headers=SALES):
    return client.post(URL, json={"day": day, "text": text}, headers=headers)


def added(client, day, text, headers=SALES):
    response = add(client, day, text, headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def read(client, day_from, day_to, headers=None):
    response = client.get(URL, params={"from": day_from, "to": day_to}, headers=headers or {})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def remove(client, memo_id, headers=SALES):
    return client.delete(f"{URL}/{memo_id}", headers=headers)


def stored(memo_id):
    with session_scope() as session:
        row = session.get(DayMemo, memo_id)
        assert row is not None
        return {
            "text": row.text,
            "day": row.day,
            "staff_key": row.staff_key,
            "deleted_at": row.deleted_at,
            "deleted_by": row.deleted_by,
            "dataset_kind": row.dataset_kind,
            "is_virtual": row.is_virtual,
            "created_by": row.created_by,
        }


def error_paths(response):
    return [field["path"] for field in response.json()["error"].get("fields", [])]


def test_a_saved_memo_comes_back_with_writer_name_and_time(memo_client):
    """Given 영업 담당이 11-05에 메모 한 건 / When 그 날짜를 읽음
    / Then 글·쓴 사람 키·표시 이름·쓴 시각이 그대로 온다."""
    saved = added(memo_client, DAY, "가상 메모: 오전 회의")
    assert saved["memoId"].startswith("daymemo-")
    assert set(saved) == {"memoId", "day", "text", "staffKey", "staffName", "createdAt"}
    assert (saved["day"], saved["text"]) == (DAY, "가상 메모: 오전 회의")
    assert (saved["staffKey"], saved["staffName"]) == ("park-lee", "영업 담당")
    assert datetime.fromisoformat(saved["createdAt"]) == START
    assert read(memo_client, DAY, DAY) == [saved]
    row = stored(saved["memoId"])
    assert (row["staff_key"], row["created_by"]) == ("park-lee", "park-lee")
    assert (row["dataset_kind"], row["is_virtual"]) == ("VIRTUAL_REVIEWED", True)
    assert (row["deleted_at"], row["deleted_by"]) == (None, None)


def test_range_includes_both_ends_and_orders_by_day(memo_client):
    """Given 11-01·11-05·11-10에 메모(늦은 날짜부터 적음) / When 11-01~11-05를 읽음
    / Then 양 끝 날짜가 들어가고 날짜 오름차순이며 11-10은 빠진다."""
    added(memo_client, "2026-11-10", "가상 메모: 범위 밖")
    added(memo_client, "2026-11-05", "가상 메모: 끝 날")
    added(memo_client, "2026-11-01", "가상 메모: 첫 날")
    rows = read(memo_client, "2026-11-01", "2026-11-05")
    assert [(row["day"], row["text"]) for row in rows] == [
        ("2026-11-01", "가상 메모: 첫 날"),
        ("2026-11-05", "가상 메모: 끝 날"),
    ]
    assert read(memo_client, "2026-11-02", "2026-11-04") == []


def test_same_day_memos_come_in_written_order(memo_client):
    """Given 같은 날 세 건을 두 사람이 번갈아 적음 / When 읽음 / Then 쓴 순서 그대로다."""
    added(memo_client, DAY, "가상 메모: 첫째")
    added(memo_client, DAY, "가상 메모: 둘째", TECH)
    added(memo_client, DAY, "가상 메모: 셋째")
    rows = read(memo_client, DAY, DAY)
    assert [row["text"] for row in rows] == [
        "가상 메모: 첫째",
        "가상 메모: 둘째",
        "가상 메모: 셋째",
    ]
    assert [row["staffName"] for row in rows] == ["영업 담당", "검수 담당(품질·기술)", "영업 담당"]
    stamps = [row["createdAt"] for row in rows]
    assert stamps == sorted(stamps) and len(set(stamps)) == 3


def test_period_of_the_longest_allowed_length_is_read_and_one_more_day_is_refused(memo_client):
    """Given 93일째 날에 메모 / When 93일(양 끝 포함) 기간과 94일 기간으로 읽음
    / Then 93일은 읽히고 94일은 400이다."""
    first = date(2026, 9, 1)
    last = first + timedelta(days=route.DAY_MEMO_MAX_RANGE_DAYS - 1)
    added(memo_client, last.isoformat(), "가상 메모: 93일째")
    rows = read(memo_client, first.isoformat(), last.isoformat())
    assert [row["day"] for row in rows] == [last.isoformat()]
    too_long = memo_client.get(
        URL, params={"from": first.isoformat(), "to": (last + timedelta(days=1)).isoformat()}
    )
    assert too_long.status_code == 400, too_long.text
    assert error_paths(too_long) == ["to"]


@pytest.mark.parametrize(
    ("params", "paths"),
    [
        ({"from": "2026-11-05", "to": "2026-11-04"}, ["from", "to"]),  # 끝이 시작보다 앞
        ({"to": "2026-11-05"}, ["from"]),  # 시작 없음
        ({"from": "2026-11-05"}, ["to"]),  # 끝 없음
        ({"from": "11/05", "to": "2026-11-05"}, ["from"]),  # 날짜 모양 아님
    ],
)
def test_bad_period_is_refused_with_the_field_named(memo_client, params, paths):
    response = memo_client.get(URL, params=params)
    assert response.status_code == 400, response.text
    assert error_paths(response) == paths


@pytest.mark.parametrize("text", ["", "   ", "\n\t "])
def test_blank_text_is_refused_and_nothing_is_saved(memo_client, text):
    response = add(memo_client, DAY, text)
    assert response.status_code == 400, response.text
    assert error_paths(response) == ["text"]
    with session_scope() as session:
        assert session.scalars(select(DayMemo)).all() == []


def test_text_length_limit_is_counted_after_trimming(memo_client):
    """Given 200자 글·201자 글·앞뒤 빈칸이 붙은 200자 글 / When 남김
    / Then 200자는 저장되고 201자는 400, 빈칸은 지운 뒤 세어 저장된다."""
    exact = "가" * DAY_MEMO_TEXT_MAX_LENGTH
    assert added(memo_client, DAY, exact)["text"] == exact
    too_long = add(memo_client, DAY, exact + "나")
    assert too_long.status_code == 400, too_long.text
    assert error_paths(too_long) == ["text"]
    padded = added(memo_client, DAY, f"  \n{exact}\t ")
    assert padded["text"] == exact
    assert stored(padded["memoId"])["text"] == exact
    assert len(read(memo_client, DAY, DAY)) == 2


def test_inner_spaces_are_kept_and_outer_spaces_are_trimmed(memo_client):
    saved = added(memo_client, DAY, "  가상 메모:  두 칸  띄움  ")
    assert saved["text"] == "가상 메모:  두 칸  띄움"


@pytest.mark.parametrize(
    ("body", "paths"),
    [
        ({"day": "2026-13-40", "text": "가상 메모"}, ["day"]),  # 없는 날짜
        ({"text": "가상 메모"}, ["day"]),  # 날짜 없음
        ({"day": DAY}, ["text"]),  # 글 없음
        ({"day": DAY, "text": "가상 메모", "oppId": "opp-1"}, ["oppId"]),  # 약속에 없는 칸
    ],
)
def test_bad_body_is_refused_with_the_field_named(memo_client, body, paths):
    response = memo_client.post(URL, json=body, headers=SALES)
    assert response.status_code == 400, response.text
    assert error_paths(response) == paths


def test_a_past_day_can_be_written(memo_client):
    """Given 지난해 날짜 / When 메모를 남김 / Then 저장되고 그 날짜에서 읽힌다."""
    saved = added(memo_client, "2025-03-02", "가상 메모: 지난 일 적어 둠")
    assert stored(saved["memoId"])["day"] == date(2025, 3, 2)
    assert read(memo_client, "2025-03-01", "2025-03-31") == [saved]


def test_viewer_and_no_key_can_read_but_cannot_write_or_delete(memo_client):
    """Given 영업 담당의 메모 / When 보기 전용·담당자 키 없음이 읽고·남기고·지움
    / Then 읽기는 되고 남기기·지우기는 403이며 메모는 그대로다."""
    saved = added(memo_client, DAY, "가상 메모: 함께 볼 것")
    for headers in (VIEWER, {}, {"X-Staff-Key": "nobody"}):
        assert read(memo_client, DAY, DAY, headers) == [saved]
        assert add(memo_client, DAY, "가상 메모: 거부될 글", headers).status_code == 403
        assert remove(memo_client, saved["memoId"], headers).status_code == 403
    assert read(memo_client, DAY, DAY) == [saved]
    with session_scope() as session:
        assert len(session.scalars(select(DayMemo)).all()) == 1


def test_only_the_writer_can_delete(memo_client):
    """Given 영업 담당의 메모 / When 검수 담당이 지움 / Then 403이고 메모는 그대로 보인다."""
    saved = added(memo_client, DAY, "가상 메모: 내 것")
    refused = remove(memo_client, saved["memoId"], TECH)
    assert refused.status_code == 403, refused.text
    assert stored(saved["memoId"])["deleted_at"] is None
    assert read(memo_client, DAY, DAY) == [saved]


def test_deleting_hides_the_memo_but_keeps_the_row(memo_client):
    """Given 메모 두 건 / When 쓴 사람이 한 건을 지움
    / Then 읽기에서 빠지고, 행은 남아 지운 시각·지운 사람이 채워진다."""
    gone = added(memo_client, DAY, "가상 메모: 지울 것")
    kept = added(memo_client, DAY, "가상 메모: 남길 것")
    response = remove(memo_client, gone["memoId"])
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"memoId": gone["memoId"], "deleted": True}
    assert read(memo_client, DAY, DAY) == [kept]
    row = stored(gone["memoId"])
    assert row["text"] == "가상 메모: 지울 것"
    assert row["deleted_by"] == "park-lee"
    assert row["deleted_at"] == datetime.fromisoformat(response.json()["meta"]["updatedAt"])
    assert stored(kept["memoId"])["deleted_at"] is None


def test_deleting_again_or_an_unknown_memo_is_not_found(memo_client):
    saved = added(memo_client, DAY, "가상 메모: 한 번만 지움")
    assert remove(memo_client, saved["memoId"]).status_code == 200
    first_deleted_at = stored(saved["memoId"])["deleted_at"]
    again = remove(memo_client, saved["memoId"])
    assert again.status_code == 404, again.text
    # 이미 지운 메모는 다른 사람에게도 "없는 메모"다(쓴 사람이 아니라는 403이 아님).
    assert remove(memo_client, saved["memoId"], TECH).status_code == 404
    assert stored(saved["memoId"])["deleted_at"] == first_deleted_at
    assert remove(memo_client, "daymemo-00000000000000000000000000").status_code == 404


def test_memos_of_another_dataset_are_not_shown_or_deletable(memo_client):
    """Given 가상 묶음에서 적은 메모 / When 활성 묶음을 소개서 묶음으로 바꿈
    / Then 그 메모는 안 보이고 지울 수도 없다(404). 새 메모는 새 묶음에 딸린다.
    묶음을 되돌리면 처음 메모만 다시 보인다."""
    virtual = added(memo_client, DAY, "가상 메모: 시연 묶음에서 적음")
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE")
    assert read(memo_client, DAY, DAY) == []
    assert remove(memo_client, virtual["memoId"]).status_code == 404
    assert stored(virtual["memoId"])["deleted_at"] is None
    other = added(memo_client, DAY, "가상 메모: 다른 묶음에서 적음")
    row = stored(other["memoId"])
    assert (row["dataset_kind"], row["is_virtual"]) == ("BROCHURE", False)
    assert read(memo_client, DAY, DAY) == [other]
    with session_scope() as session:
        set_active_dataset_kind(session, "VIRTUAL_REVIEWED")
    assert read(memo_client, DAY, DAY) == [virtual]


def test_writer_missing_from_the_staff_table_has_no_name(memo_client):
    """Given 지금 담당자 표에 없는 사람이 쓴 메모 / When 읽음 / Then 키는 오고 이름은 null이다."""
    with session_scope() as session:
        session.add(
            DayMemo(
                memo_id="daymemo-gone",
                day=date(2026, 11, 5),
                text="가상 메모: 예전 담당자가 적음",
                staff_key="left-staff",
                created_at=START,
                created_by="left-staff",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    rows = read(memo_client, DAY, DAY)
    assert [(row["staffKey"], row["staffName"]) for row in rows] == [("left-staff", None)]


def test_reading_and_writing_memos_leave_dashboard_and_badges_alone(memo_client):
    """Given 오늘 날짜 메모 / When 영업 홈·메뉴 숫자를 읽음 / Then 메모 글이 실리지 않는다."""
    text = "가상 메모: 영업 홈 숫자에 안 들어감"
    added(memo_client, DAY, text)
    badges = memo_client.get("/api/v1/menu-badges", headers=SALES)
    assert badges.status_code == 200, badges.text
    # #987: 메뉴 숫자 응답에 "의견 전" 칸이 더해졌다(약속 요약 /menu-badges).
    assert badges.json()["data"] == {
        "dashboard": 0,
        "list": 0,
        "bookmarks": 0,
        "bookmarksNoOpinion": 0,
    }
    dashboard = memo_client.get("/api/v1/dashboard", headers=SALES)
    assert dashboard.status_code == 200, dashboard.text
    assert text not in dashboard.text


def _tables(db: Path) -> set[str]:
    with sqlite3.connect(db) as con:
        rows = con.execute("SELECT name FROM sqlite_master WHERE type='table'")
        return {name for (name,) in rows}


def _columns(db: Path, table: str) -> set[str]:
    with sqlite3.connect(db) as con:
        return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}


def test_migration_adds_the_table_and_can_be_undone_and_redone(tmp_path: Path) -> None:
    """Given 날짜 메모 표가 없는 옛 DB(rec_019) / When 최신으로 올림 → 되돌림 → 다시 올림
    / Then 표가 생겼다 없어졌다 다시 생기고, 다른 표는 그대로다."""
    db = tmp_path / "old.db"
    command.upgrade(alembic_config(db), BEFORE)
    before = _tables(db)
    assert "rec_day_memo" not in before
    assert upgrade_to_head(db) == [HEAD]
    assert _tables(db) == before | {"rec_day_memo"}
    assert _columns(db, "rec_day_memo") == {
        "memo_id",
        "day",
        "text",
        "staff_key",
        "deleted_at",
        "deleted_by",
        "created_at",
        "created_by",
        "session_ref",
        "dataset_kind",
        "is_virtual",
    }
    assert downgrade(db, BEFORE) == [BEFORE]
    assert _tables(db) == before
    assert upgrade_to_head(db) == [HEAD]
    assert upgrade_to_head(db) == [HEAD]  # 다시 올려도 그대로
    assert current_revisions(db) == [HEAD]
    assert _tables(db) == before | {"rec_day_memo"}
