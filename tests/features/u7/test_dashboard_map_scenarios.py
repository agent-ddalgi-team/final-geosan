"""#642: 실제 SQLite·HTTP를 쓰는 Given/When/Then 지도 시나리오."""

from datetime import UTC, datetime

import pytest
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_dashboard_breakdown import brochure_env as brochure_env
from tests.unit.u7.test_dashboard_map import customer_for
from tests.unit.u7.test_dashboard_map import map_env as map_env

scenarios("u7/dashboard_map.feature")


@pytest.fixture
def map_state(map_env):
    return {"client": map_env[0], "opp_id": map_env[1]}


@given("관심으로 켠 실제 공개 회사에 공공좌표가 있다")
def public_point(map_state):
    pass


@given("관심으로 켠 실제 공개 회사의 좌표가 없다")
def no_point(map_state):
    with session_scope() as session:
        customer_for(session, map_state["opp_id"]).lat = None


@given("관심 회사가 지난해 성공한 기록이 있다")
def old_success(map_state):
    record(map_state["client"], map_state["opp_id"], {"status": "WON"})
    with session_scope() as session:
        row = session.scalar(select(Outcome).where(Outcome.opp_id == map_state["opp_id"]))
        row.created_at = datetime(2025, 12, 1, tzinfo=UTC)


@when("지도 데이터를 요청하면")
def request_map(map_state):
    response = map_state["client"].get("/api/v1/dashboard/map")
    assert response.status_code == 200
    map_state["data"] = response.json()["data"]


@then("관심 묶음의 회사 점과 직선거리를 받는다")
def receives_point(map_state):
    point = map_state["data"]["points"][0]
    assert point["oppId"] == map_state["opp_id"]
    assert point["group"] == "INTERESTED" and point["distanceKm"] == 0.0


@then("가짜 점 없이 좌표 없는 회사 한 곳으로 센다")
def missing_only(map_state):
    assert map_state["data"]["points"] == []
    assert map_state["data"]["missingCoordinates"] == 1


@then("지도 점과 좌표 없는 회사 수에 포함하지 않는다")
def excludes_old_success(map_state):
    assert map_state["data"]["points"] == []
    assert map_state["data"]["missingCoordinates"] == 0
