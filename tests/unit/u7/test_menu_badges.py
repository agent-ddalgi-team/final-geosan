"""#770 왼쪽 메뉴 "새로 생긴 것" 숫자(GET /menu-badges). 실제 임시 DB·실제 API.

#987: 관심 기업 옆 "의견 전" 숫자(bookmarksNoOpinion)도 같이 온다. 관심으로 켜 둔 회사 가운데
검토 의견이 없고 영업 단계도 아직 없는 곳 수이고, 영업 홈 "의견 전" 칸(counts.NO_OPINION)과
같은 계산이다.

가상 사례만 쓴다(거산 실제 사양 아님). 담당자 키는 예시 설정의 역할 이름이다.
"""

from datetime import datetime, timedelta

import pytest

from geosan.config.sales_questions import KST
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark
from tests.unit.u7.test_handoff import SALES, TECH, handoff, today_rows

dashboard_env = dashboard.dashboard_env
record = dashboard.record
URL = "/api/v1/menu-badges"
VIEWER = {"X-Staff-Key": "viewer"}
# 아무 기록도 관심도 없을 때의 응답 전체(곳 수 네 칸).
NOTHING = {"dashboard": 0, "list": 0, "bookmarks": 0, "bookmarksNoOpinion": 0}


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


def dashboard_no_opinion(client, headers=SALES):
    """영업 홈 "의견 전" 칸의 곳 수(GET /dashboard counts.NO_OPINION)."""
    response = client.get("/api/v1/dashboard", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]["counts"]["NO_OPINION"]


def test_only_counts_come_back_and_nothing_new_without_since(dashboard_env):
    """Given 아무 기록 없음 / When 숫자를 읽음 /
    Then 네 칸(영업 홈·후보·관심 기업 새 소식·의견 전) 모두 0이고 곳 수 말고는 아무것도 없다."""
    client, _opp_ids = dashboard_env
    assert badges(client) == NOTHING
    assert badges(client, headers=VIEWER) == NOTHING


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


def test_no_opinion_counts_bookmarked_company_without_opinion_or_stage(dashboard_env):
    """Given 관심으로 켠 회사 1곳(의견도 영업 단계도 없음) / When 숫자를 읽음 /
    Then 의견 전 1곳. 누가 읽어도 같고, 마지막으로 연 시각(bookmarksSince)과도 무관하다."""
    client, opp_ids = dashboard_env
    assert badges(client)["bookmarksNoOpinion"] == 0
    assert set_bookmark(client, opp_ids[0], True).status_code == 200
    assert badges(client) == {**NOTHING, "bookmarksNoOpinion": 1}
    assert badges(client, headers=TECH)["bookmarksNoOpinion"] == 1
    assert badges(client, headers=VIEWER)["bookmarksNoOpinion"] == 1
    later = utcnow() + timedelta(minutes=1)
    earlier = utcnow() - timedelta(days=7)
    assert badges(client, bookmarksSince=stamp(later))["bookmarksNoOpinion"] == 1
    assert badges(client, bookmarksSince=stamp(earlier))["bookmarksNoOpinion"] == 1
    # 한 곳 더 켜면 2곳.
    assert set_bookmark(client, opp_ids[1], True).status_code == 200
    assert badges(client)["bookmarksNoOpinion"] == 2


@pytest.mark.parametrize("opinion", ["WORTH_REVIEW", "NEED_CHECK"])
def test_no_opinion_drops_to_zero_when_an_opinion_is_chosen(dashboard_env, opinion):
    """Given 의견 전 1곳 / When 그 회사의 검토 의견을 고름 / Then 0곳."""
    client, opp_ids = dashboard_env
    assert set_bookmark(client, opp_ids[0], True).status_code == 200
    assert badges(client)["bookmarksNoOpinion"] == 1
    give_opinion(client, opp_ids[0], opinion)
    assert badges(client)["bookmarksNoOpinion"] == 0


def test_no_opinion_skips_companies_already_in_contact(dashboard_env):
    """Given 관심 기업 2곳, 둘 다 의견 없음 / When 한 곳에 접촉 기록을 남겨 영업 단계가 진행됨 /
    Then 그 회사는 의견이 없어도 세지 않아 1곳(영업 홈에서는 "접촉 중" 칸에 든다)."""
    client, opp_ids = dashboard_env
    a, b, *_ = opp_ids
    assert set_bookmark(client, a, True).status_code == 200
    assert set_bookmark(client, b, True).status_code == 200
    assert badges(client)["bookmarksNoOpinion"] == 2
    record(client, a, {"status": "IN_PROGRESS"})
    assert badges(client)["bookmarksNoOpinion"] == 1
    counts = client.get("/api/v1/dashboard", headers=SALES).json()["data"]["counts"]
    assert (counts["IN_CONTACT"], counts["NO_OPINION"]) == (1, 1)


def test_no_opinion_ignores_companies_that_are_not_bookmarked(dashboard_env):
    """Given 관심을 켠 적 없는 회사와 켰다가 끈 회사 / When 숫자를 읽음 / Then 0곳."""
    client, opp_ids = dashboard_env
    assert badges(client)["bookmarksNoOpinion"] == 0
    assert set_bookmark(client, opp_ids[0], True).status_code == 200
    assert badges(client)["bookmarksNoOpinion"] == 1
    assert set_bookmark(client, opp_ids[0], False).status_code == 200
    assert badges(client)["bookmarksNoOpinion"] == 0


def test_no_opinion_equals_the_dashboard_no_opinion_count(dashboard_env):
    """Given 같은 DB에 관심만 / 관심+의견 / 관심+접촉 중 / 관심 없음이 섞여 있음 /
    When 영업 홈과 왼쪽 메뉴 숫자를 읽음 / Then 영업 홈 "의견 전" 칸과 메뉴의 의견 전 숫자가 같다.
    기록이 바뀔 때마다 둘이 같이 움직인다."""
    client, opp_ids = dashboard_env
    a, b, c, d = opp_ids

    def both():
        menu = badges(client)["bookmarksNoOpinion"]
        assert menu == dashboard_no_opinion(client)
        assert menu == dashboard_no_opinion(client, headers=VIEWER)
        return menu

    assert both() == 0
    for opp_id in (a, b, c):
        assert set_bookmark(client, opp_id, True).status_code == 200
    assert both() == 3
    give_opinion(client, b, "NEED_CHECK")
    assert both() == 2
    record(client, c, {"status": "IN_PROGRESS"})
    assert both() == 1
    assert set_bookmark(client, d, True).status_code == 200
    assert both() == 2
    give_opinion(client, a, "WORTH_REVIEW")
    give_opinion(client, d, "NEED_CHECK")
    assert both() == 0
