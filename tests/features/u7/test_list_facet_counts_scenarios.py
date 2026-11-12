"""#370: 실제 임시 DB·API로 걸러 본 목록의 지역·산업 곳 수 시나리오. 외부 AI 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u7 import test_list_facet_counts as support
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark

board_env = support.board_env
facet_env = support.facet_env
scenarios("u7/list_facet_counts.feature")


@given("천안 2곳과 대전 1곳을 관심으로 켠 가상 후보 10곳이 있다", target_fixture="world")
def bookmarked_three(facet_env):
    client, ids = facet_env
    for opp_id in (ids[0], ids[1], ids[3]):
        assert set_bookmark(client, opp_id, True).status_code == 200
    return {"client": client, "ids": ids}


@when("관심 기업 보기를 연다")
def open_bookmarked(world):
    world["seen"] = support.facets(world["client"], bookmarked="true")


@then("목록은 3곳이고 지역 곳 수는 충남 2, 천안시 2, 대전광역시 1이다")
def three_companies(world):
    total, regions, _ = world["seen"]
    assert total == 3
    assert regions == {"충남": 2, "천안시": 2, "대전광역시": 1}


@when("천안 1곳의 의견을 추가 확인 필요로 저장하고 그 의견으로 거른다")
def filter_by_opinion(world):
    give_opinion(world["client"], world["ids"][0], "NEED_CHECK")
    world["seen"] = support.facets(world["client"], bookmarked="true", opinion="NEED_CHECK")


@then("목록은 1곳이고 지역 곳 수는 충남 1, 천안시 1이다")
def one_company(world):
    total, regions, industries = world["seen"]
    assert total == 1
    assert regions == {"충남": 1, "천안시": 1}
    assert industries == {"반도체": 1}


@when("대시보드의 접촉 전 칸 목록을 연다")
def open_empty_column(world):
    world["seen"] = support.facets(world["client"], filter="NOT_CONTACTED")


@then("목록은 0곳이고 지역·산업 선택지가 없다")
def nothing(world):
    assert world["seen"] == (0, {}, {})
