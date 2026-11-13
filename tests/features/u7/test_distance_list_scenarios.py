"""#658: 실제 SQLite·HTTP 거리 정렬 시나리오."""

import pytest
from pytest_bdd import given, scenarios, then, when

from tests.unit.u7.test_dashboard_breakdown import brochure_env as brochure_env
from tests.unit.u7.test_distance_list import distance_env as distance_env
from tests.unit.u7.test_distance_list import listing

scenarios("u7/distance_list.feature")


@pytest.fixture
def distance_state(distance_env):
    return {"client": distance_env[0], "ids": distance_env[1]}


@given("거리가 서로 다르고 위치 미확인 회사가 있는 후보 목록")
def prepared(distance_state):
    distance_state["baseline"] = listing(distance_state["client"])["data"]


@when("가까운 순으로 한 쪽에 두 곳씩 요청하면")
def sorted_page(distance_state):
    distance_state["result"] = listing(distance_state["client"], sort="distance", pageSize=2)


@then("첫 쪽에 가장 가까운 두 회사가 나오고 전체 건수는 유지된다")
def nearest(distance_state):
    expected = sorted(
        distance_state["baseline"], key=lambda c: (c["distanceKm"] is None, c["distanceKm"] or 0)
    )[:2]
    assert distance_state["result"]["data"] == [{**c, "rank": i} for i, c in enumerate(expected, 1)]
    assert distance_state["result"]["meta"]["total"] == 5


@when("50km 이내 후보를 한 쪽에 두 곳씩 요청하면")
def filtered_page(distance_state):
    distance_state["result"] = listing(distance_state["client"], maxDistanceKm=50, pageSize=2)


@then("거리 미확인과 먼 회사를 뺀 세 곳만 센다")
def inside(distance_state):
    body = distance_state["result"]
    assert len(body["data"]) == 2 and body["meta"]["total"] == 3
    assert all(c["distanceKm"] is not None and c["distanceKm"] <= 50 for c in body["data"])
