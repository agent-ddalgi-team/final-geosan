"""#987: 왼쪽 메뉴 "의견 전" 숫자를 실제 임시 DB·실제 API로 확인한다. 외부 AI 호출 없음.

가상 사례만 쓴다(거산 실제 사양 아님).
"""

from pytest_bdd import given, parsers, scenarios, then, when

from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7 import test_menu_badges as menu
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark

dashboard_env = dashboard.dashboard_env
scenarios("u7/menu_no_opinion.feature")


@given("평가를 마친 가상 회사 네 곳이 있고 관심도 기록도 없다", target_fixture="env")
def four_companies(dashboard_env):
    client, opp_ids = dashboard_env
    assert len(opp_ids) == 4
    assert menu.badges(client) == menu.NOTHING
    return client, opp_ids[0]


@when("한 곳을 관심으로 켜고 의견은 고르지 않는다")
def bookmark_only(env):
    client, opp_id = env
    assert set_bookmark(client, opp_id, True).status_code == 200


@when("그 회사의 검토 의견을 추가 확인 필요로 저장한다")
def choose_opinion(env):
    client, opp_id = env
    give_opinion(client, opp_id, "NEED_CHECK")


@when("그 회사에 접촉 기록을 남겨 영업 단계가 진행된다")
def contact(env):
    client, opp_id = env
    dashboard.record(client, opp_id, {"status": "IN_PROGRESS"})


@then(parsers.parse("왼쪽 메뉴 숫자의 의견 전은 {count:d}곳이고 영업 홈의 의견 전 칸과 같다"))
def menu_number(env, count):
    client, _ = env
    assert menu.badges(client)["bookmarksNoOpinion"] == count
    assert menu.dashboard_no_opinion(client) == count
