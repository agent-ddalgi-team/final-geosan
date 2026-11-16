"""#770 왼쪽 메뉴 "새로 생긴 것" 숫자(GET /menu-badges). 실제 임시 DB·실제 API.

가상 사례만 쓴다(거산 실제 사양 아님). 담당자 키는 예시 설정의 역할 이름이다.
"""

from datetime import datetime, timedelta

from geosan.config.sales_questions import KST
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7.test_bookmark import set_bookmark
from tests.unit.u7.test_handoff import SALES, TECH, handoff, today_rows

dashboard_env = dashboard.dashboard_env
record = dashboard.record
URL = "/api/v1/menu-badges"
VIEWER = {"X-Staff-Key": "viewer"}


def badges(client, headers=SALES, **params):
    response = client.get(URL, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def stamp(value: datetime) -> str:
    return value.isoformat()


def set_customer(opp_id, **values):
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        for key, value in values.items():
            setattr(customer, key, value)


def test_only_counts_come_back_and_nothing_new_without_since(dashboard_env):
    """Given 아무 기록 없음 / When 숫자를 읽음 /
    Then 세 칸 모두 0이고 곳 수 말고는 아무것도 없다."""
    client, _opp_ids = dashboard_env
    assert badges(client) == {"dashboard": 0, "list": 0, "bookmarks": 0}
    assert badges(client, headers=VIEWER) == {"dashboard": 0, "list": 0, "bookmarks": 0}


def test_dashboard_number_matches_today_checks_without_check_left(dashboard_env):
    """Given 오늘 일정 1곳·나에게 온 전달 2곳 / When 숫자를 읽음 / Then 대시보드 줄 곳 수 합과 같다
    ("확인할 것이 남은 관심 기업"은 넣지 않는다). 다른 사람에게는 전달 사항이 세지 않는다."""
    client, opp_ids = dashboard_env
    today = utcnow().astimezone(KST).date().isoformat()
    record(client, opp_ids[0], {"status": "IN_PROGRESS", "nextScheduleAt": today})
    handoff(client, opp_ids[1])
    handoff(client, opp_ids[2], text="가상 전달 둘")
    rows = today_rows(client, SALES)
    expected = sum(
        rows[kind]["count"]
        for kind in ("SCHEDULE_OVERDUE", "SCHEDULE_TODAY", "HANDOFF_FOR_ME")
        if kind in rows
    )
    assert expected == 3
    assert badges(client)["dashboard"] == 3
    assert badges(client, headers=TECH)["dashboard"] == 1  # 일정만(전달 사항은 영업 담당에게)
    assert badges(client, headers=VIEWER)["dashboard"] == 1


def test_list_number_counts_candidates_that_came_in_after_last_visit(dashboard_env):
    """Given 두 곳이 방금 후보로 들어옴 / When 그 전에 마지막으로 열었다 /
    Then 2, 그 뒤에 열었으면 0."""
    client, opp_ids = dashboard_env
    now = utcnow()
    set_customer(opp_ids[0], ingested_at=now)
    set_customer(opp_ids[1], ingested_at=now)
    set_customer(opp_ids[2], ingested_at=now - timedelta(days=3))
    assert badges(client, listSince=stamp(now - timedelta(hours=1)))["list"] == 2
    assert badges(client, listSince=stamp(now + timedelta(minutes=1)))["list"] == 0
    assert badges(client, listSince=stamp(now - timedelta(days=7)))["list"] == 3


def test_bookmarks_number_counts_others_records_and_new_research(dashboard_env):
    """Given 관심 기업 3곳: 다른 사람이 기록 / 내가 기록 / 조사 결과가 새로 붙음 /
    When 그 전에 마지막으로 열었다 / Then 나에게는 2곳, 보기 전용에게는 3곳.
    관심 아닌 회사는 안 센다."""
    client, opp_ids = dashboard_env
    a, b, c, d = opp_ids
    for opp_id in (a, b, c):
        assert set_bookmark(client, opp_id, True).status_code == 200
    since = utcnow()
    record(client, a, {"status": "IN_PROGRESS"}, staff="kim-gwajang")
    record(client, b, {"status": "IN_PROGRESS"}, staff="park-lee")
    set_customer(c, researched_at=utcnow() + timedelta(seconds=1))
    set_customer(d, researched_at=utcnow() + timedelta(seconds=1))  # 관심 아님
    assert badges(client, bookmarksSince=stamp(since))["bookmarks"] == 2
    assert badges(client, headers=VIEWER, bookmarksSince=stamp(since))["bookmarks"] == 3
    later = utcnow() + timedelta(minutes=1)
    assert badges(client, bookmarksSince=stamp(later))["bookmarks"] == 0


def test_time_without_zone_is_refused(dashboard_env):
    """Given 시간대 없는 시각 / When 숫자를 읽음 / Then 받지 않는다."""
    client, _opp_ids = dashboard_env
    response = client.get(URL, params={"listSince": "2026-11-16T05:00:00"}, headers=SALES)
    assert response.status_code in (400, 422)
