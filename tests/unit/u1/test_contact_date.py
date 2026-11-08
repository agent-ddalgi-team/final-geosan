"""#434: 접촉한 날짜만 한국 오늘까지 허용하고, 잘못된 요청은 저장하지 않는다."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select

from geosan.api.routes import records
from geosan.records.models import Bookmark, Outcome
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate
from tests.unit.u1 import test_sales_records as support

records_env = support.records_env
MESSAGE = "앞으로 할 일은 다음 일정에 적어 주세요. 접촉 날짜는 오늘까지입니다."


def contact(day):
    return {"status": "IN_PROGRESS", "method": "CALL", "result": "ABSENT", "attemptedAt": day}


def test_future_contact_is_rejected_before_history_or_bookmark_is_saved(records_env, monkeypatch):
    """Given 오늘 11월 8일 / When 내일 접촉을 저장 / Then 칸 오류이며 이력·관심은 생기지 않는다."""
    client, opp_id = records_env
    monkeypatch.setattr(records, "today_in_seoul", lambda: date(2026, 11, 8))
    response = support.post(client, opp_id, "outcomes", contact("2026-11-09"))
    assert response.status_code == 400, response.text
    assert response.json()["error"]["fields"] == [{"path": "attemptedAt", "message": MESSAGE}]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0
        assert session.scalar(select(func.count()).select_from(Bookmark)) == 0


@pytest.mark.parametrize("day", ["2026-11-07", "2026-11-08"])
def test_today_and_previous_contact_dates_are_allowed(records_env, monkeypatch, day):
    client, opp_id = records_env
    monkeypatch.setattr(records, "today_in_seoul", lambda: date(2026, 11, 8))
    response = support.post(client, opp_id, "outcomes", contact(day))
    assert response.status_code == 200, response.text
    with session_scope() as session:
        assert session.scalar(select(Outcome)).attempted_at.isoformat() == day


@pytest.mark.parametrize("hour,minute,second,expected", [(14, 59, 59, 400), (15, 0, 0, 200)])
def test_korean_midnight_changes_the_allowed_day(
    records_env, monkeypatch, hour, minute, second, expected
):
    """Given UTC 15시 전후 / When 한국의 다음 날짜 접촉 저장 / Then 자정부터 허용한다."""
    client, opp_id = records_env
    instant = datetime(2026, 11, 8, hour, minute, second, tzinfo=UTC)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz)

    monkeypatch.setattr(flow_evaluate, "datetime", FrozenDateTime)
    response = support.post(client, opp_id, "outcomes", contact("2026-11-09"))
    assert response.status_code == expected, response.text
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == int(expected == 200)


@pytest.mark.parametrize("extra", [{}, {"attemptedAt": None}, {"nextScheduleAt": "2026-11-15"}])
def test_stage_or_future_schedule_without_contact_date_is_unchanged(
    records_env, monkeypatch, extra
):
    client, opp_id = records_env

    def unexpected_today():
        pytest.fail("접촉 날짜가 없으면 날짜 제한을 검사하지 않는다")

    monkeypatch.setattr(records, "today_in_seoul", unexpected_today)
    response = support.post(client, opp_id, "outcomes", {"status": "IN_PROGRESS", **extra})
    assert response.status_code == 200, response.text


def test_future_date_is_reported_alongside_existing_lost_reason_error(records_env, monkeypatch):
    client, opp_id = records_env
    monkeypatch.setattr(records, "today_in_seoul", lambda: date(2026, 11, 8))
    body = contact("2026-11-09") | {"status": "LOST"}
    response = support.post(client, opp_id, "outcomes", body)
    assert response.status_code == 400, response.text
    fields = {row["path"] for row in response.json()["error"]["fields"]}
    assert fields == {"lostReasonCode", "attemptedAt"}
