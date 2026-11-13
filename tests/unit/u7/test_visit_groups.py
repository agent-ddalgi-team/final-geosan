"""#673: 대시보드 지도 "같이 들를 곳". 방문할 회사(진행 중·관심) 근처 반경 안의 관심 기업을 묶는다.

근처 회사도 관심 기업만이다(PM 정정 2026-11-13: 목록 후보는 아직 보지 않은 회사일 수 있음).
모든 데이터는 가상이다.
"""

import pytest
import yaml
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    AppSettings,
    read_app_settings,
    sync_app_settings,
)
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u7.test_bookmark import set_bookmark
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_dashboard_breakdown import add_company
from tests.unit.u7.test_dashboard_breakdown import brochure_env as brochure_env
from tests.unit.u7.test_dashboard_map import NOW

# 위도 0.01도 ≈ 1.1km. 중심 회사는 (38, 127.5).
PLACES = {
    "anchor": (38.0, 127.5),
    "near": (38.01, 127.5),
    "mid": (38.03, 127.5),
    "far": (38.1, 127.5),
    "unseen": (38.005, 127.5),
    "nocoord": None,
    "busy": (38.2, 127.5),
}


@pytest.fixture
def visit_env(brochure_env, monkeypatch):
    ids = {name: add_company(brochure_env, f"visit-{name}") for name in PLACES}
    assert run_evaluation().ok
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat, settings.geosan.lng = 37.9, 127.5
        settings.geocoding.enabled = False
        sync_app_settings(session, settings)
        for name, place in PLACES.items():
            customer = session.get(Customer, session.get(Opportunity, ids[name]).customer_id)
            customer.name = f"가상 {name}"
            if place:
                customer.lat, customer.lng, customer.geocode_source = *place, "CSV"
    monkeypatch.setattr("geosan.api.routes.dashboard.utcnow", lambda: NOW)
    with TestClient(create_app()) as client:
        # 관심 기업: anchor·near·far·busy·nocoord. mid·unseen은 목록에만 있는 회사(관심 아님).
        for name in ("anchor", "near", "far", "busy", "nocoord"):
            assert set_bookmark(client, ids[name], True).status_code == 200
        record(client, ids["busy"], {"status": "IN_PROGRESS"})
        yield client, ids


def visit(client):
    response = client.get("/api/v1/dashboard/map")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_groups_list_in_progress_first_then_interested_with_nearby_by_distance(visit_env):
    """Given 진행 중 1곳·관심 3곳 / When 지도 / Then 진행 중이 먼저, 근처는 5km 안 관심 기업만."""
    client, ids = visit_env
    body = visit(client)
    assert body["visitRadiusKm"] == 5
    order = [group["oppId"] for group in body["visitGroups"]]
    assert order == [ids["busy"], ids["anchor"], ids["near"], ids["far"]]
    anchor = body["visitGroups"][1]
    names = [(row["customerName"], row["distanceKm"], row["group"]) for row in anchor["nearby"]]
    assert names == [("가상 near", 1.1, "INTERESTED")]


def test_unbookmarked_list_companies_missing_coordinate_and_far_are_not_nearby(visit_env):
    """Given 목록에만 있는 가까운 회사 2곳 / When 지도 / Then 근처에 넣지 않는다(PM 정정)."""
    client, ids = visit_env
    body = visit(client)
    anchor = next(group for group in body["visitGroups"] if group["oppId"] == ids["anchor"])
    nearby = {row["oppId"] for row in anchor["nearby"]}
    assert not nearby & {ids["mid"], ids["unseen"], ids["nocoord"], ids["far"], ids["anchor"]}


def test_radius_comes_from_settings_and_targets_show_their_group(visit_env):
    """Given 반경 설정 25km / When 지도 / Then 더 먼 곳도 들고, 진행 중 회사는 그 단계가 붙는다."""
    client, ids = visit_env
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.visit_group_radius_km = 25
        sync_app_settings(session, settings)
    body = visit(client)
    assert body["visitRadiusKm"] == 25
    anchor = next(group for group in body["visitGroups"] if group["oppId"] == ids["anchor"])
    rows = {row["oppId"]: row for row in anchor["nearby"]}
    assert ids["far"] in rows and rows[ids["busy"]]["group"] == "IN_PROGRESS"
    assert [row["distanceKm"] for row in anchor["nearby"]] == sorted(
        row["distanceKm"] for row in anchor["nearby"]
    )


def test_this_year_success_is_not_a_visit_center(visit_env):
    client, ids = visit_env
    record(client, ids["busy"], {"status": "WON"})
    centers = [group["oppId"] for group in visit(client)["visitGroups"]]
    assert ids["busy"] not in centers and centers == [ids["anchor"], ids["near"], ids["far"]]


def test_no_external_lookup_for_nearby_companies(visit_env, monkeypatch):
    """근처 후보마다 외부 조회를 하면 하루 한도를 금방 쓰므로 저장된 공공좌표만 쓴다."""
    client, _ = visit_env

    def forbidden(*args, **kwargs):
        raise AssertionError("외부 좌표 조회를 부르면 안 됩니다")

    monkeypatch.setattr("geosan.opportunity.geocode_http.request_json", forbidden)
    assert visit(client)["visitGroups"]


@pytest.mark.parametrize("value", [0, -1, 51])
def test_radius_setting_is_bounded(value):
    with pytest.raises(ValueError):
        AppSettings.model_validate({**read_example(), "visitGroupRadiusKm": value})


def read_example():
    with open(DEFAULT_APP_SETTINGS_PATH, encoding="utf-8") as stream:
        return {key: value for key, value in yaml.safe_load(stream).items() if key != "_설명"}
