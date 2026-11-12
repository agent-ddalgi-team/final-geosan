"""#370: 걸러 본 목록의 지역·산업 곳 수는 지금 보이는 목록 안에서 센다.

관심(`bookmarked`)은 #516에서 이미 맞췄다. 여기서는 의견(`opinion`)·영업 단계(`stage`)·
대시보드 칸(`filter`)으로 거른 목록을 본다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import pytest
from sqlalchemy import select

from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from tests.unit.u7.test_bookmark import URL, give_opinion, set_bookmark
from tests.unit.u7.test_bookmark_board import board_env  # noqa: F401
from tests.unit.u7.test_dashboard import record

CHEONAN = "충남 천안시 (가상)"
DAEJEON = "대전광역시 유성구 (가상)"


def place(opp_id, address, industries):
    """가상 회사의 주소와 산업군을 정한다(사례 파일에 사람이 적는 값을 흉내 낸다)."""
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.address = address
        customer.industries = industries


@pytest.fixture
def facet_env(board_env):  # noqa: F811
    """가상 10곳: 앞 3곳 천안·반도체, 다음 3곳 대전·자동차 부품, 나머지 4곳 천안·산업 없음."""
    client, ids = board_env
    for opp_id in ids[:3]:
        place(opp_id, CHEONAN, ["반도체"])
    for opp_id in ids[3:6]:
        place(opp_id, DAEJEON, ["자동차 부품"])
    with session_scope() as session:
        assert len(session.scalars(select(Customer)).all()) == 10
    return client, ids


def facets(client, **params):
    """목록을 불러 (목록 곳 수, 지역 곳 수, 산업 곳 수)를 돌려준다."""
    response = client.get(URL, params={"pageSize": 50, **params})
    assert response.status_code == 200, response.text
    meta = response.json()["meta"]
    return (
        meta["total"],
        {row["region"]: row["count"] for row in meta["regionCounts"]},
        {row["industry"]: row["count"] for row in meta["industryCounts"]},
    )


def test_unfiltered_list_counts_every_company(facet_env):
    """Given 10곳 / When 조건 없는 목록 / Then 곳 수는 전체 기준(바뀌지 않는 동작)."""
    client, _ = facet_env
    assert facets(client) == (
        10,
        {"충남": 7, "천안시": 7, "대전광역시": 3},
        {"반도체": 3, "자동차 부품": 3},
    )


def test_bookmarked_three_never_counts_more_than_three(facet_env):
    """Given 관심 3곳 / When 관심 기업 보기 / Then 지역·산업 곳 수가 3을 넘지 않는다."""
    client, ids = facet_env
    for opp_id in (ids[0], ids[1], ids[3]):
        assert set_bookmark(client, opp_id, True).status_code == 200
    total, regions, industries = facets(client, bookmarked="true")
    assert total == 3
    assert regions == {"충남": 2, "천안시": 2, "대전광역시": 1}
    assert industries == {"반도체": 2, "자동차 부품": 1}
    # 의견으로 더 걸러 목록이 0곳이 되면 선택지도 비어야 한다(전에는 관심 3곳 숫자가 그대로).
    assert facets(client, bookmarked="true", opinion="NOT_TARGET") == (0, {}, {})


def test_opinion_filter_counts_inside_the_filtered_list(facet_env):
    """Given 추가 확인 필요 2곳(천안 1·대전 1) / When opinion 목록 / Then 곳 수는 그 2곳 안에서."""
    client, ids = facet_env
    give_opinion(client, ids[0], "NEED_CHECK")
    give_opinion(client, ids[3], "NEED_CHECK")
    give_opinion(client, ids[6], "WORTH_REVIEW")
    assert facets(client, opinion="NEED_CHECK") == (
        2,
        {"충남": 1, "천안시": 1, "대전광역시": 1},
        {"반도체": 1, "자동차 부품": 1},
    )
    # 의견을 아직 고르지 않은 7곳: 천안 5(반도체 2), 대전 2.
    assert facets(client, opinion="NONE") == (
        7,
        {"충남": 5, "천안시": 5, "대전광역시": 2},
        {"반도체": 2, "자동차 부품": 2},
    )


def test_stage_filter_counts_inside_the_filtered_list(facet_env):
    """Given 진행 중 1곳(대전) / When stage 목록 / Then 지역은 대전 1곳뿐, 0곳인 선택지는 없다."""
    client, ids = facet_env
    record(client, ids[4], {"status": "IN_PROGRESS"})
    assert facets(client, stage="IN_PROGRESS") == (1, {"대전광역시": 1}, {"자동차 부품": 1})


def test_dashboard_column_filter_counts_inside_the_filtered_list(facet_env):
    """Given 관심 3곳, 그중 추가 확인 필요 1곳 / When 대시보드 칸 목록 / Then 그 칸 안의 곳 수."""
    client, ids = facet_env
    give_opinion(client, ids[0], "NEED_CHECK")
    assert set_bookmark(client, ids[3], True).status_code == 200
    assert set_bookmark(client, ids[4], True).status_code == 200
    assert facets(client, filter="NEED_CHECK") == (1, {"충남": 1, "천안시": 1}, {"반도체": 1})
    assert facets(client, filter="NO_OPINION") == (2, {"대전광역시": 2}, {"자동차 부품": 2})
    assert facets(client, filter="BOOKMARKED") == (
        3,
        {"충남": 1, "천안시": 1, "대전광역시": 2},
        {"반도체": 1, "자동차 부품": 2},
    )
    # 아무도 없는 칸은 목록도 선택지도 비어 있다.
    assert facets(client, filter="NOT_CONTACTED") == (0, {}, {})


def test_region_and_industry_choice_keep_the_other_choices_visible(facet_env):
    """Given 의견으로 거른 2곳 / When 지역·산업을 고름 / Then 곳 수는 고르기 전과 같다."""
    client, ids = facet_env
    give_opinion(client, ids[0], "NEED_CHECK")
    give_opinion(client, ids[3], "NEED_CHECK")
    _, regions, industries = facets(client, opinion="NEED_CHECK")
    for params in ({"region": "대전광역시"}, {"industry": "반도체"}, {"q": "가상회사"}):
        total, picked_regions, picked_industries = facets(client, opinion="NEED_CHECK", **params)
        assert total <= 2
        assert (picked_regions, picked_industries) == (regions, industries), params


def test_process_counts_do_not_follow_opinion_filter(facet_env):
    """Given 의견으로 거른 목록 / When 목록 / Then 공정 곳 수는 약속대로 그대로(#370 범위 밖)."""
    client, ids = facet_env
    give_opinion(client, ids[0], "NEED_CHECK")
    everyone = client.get(URL).json()["meta"]["processCounts"]
    filtered = client.get(URL, params={"opinion": "NEED_CHECK"}).json()["meta"]["processCounts"]
    assert filtered == everyone
