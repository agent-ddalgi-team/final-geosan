"""#803 기업 상세 "한눈에" 작은 지도(PM 결정 2026-11-16): 상세 응답의 map 칸.

center는 설정 geosan 좌표, company는 저장된 공공좌표(CSV·JUSO·MANUAL)뿐이다.
좌표가 없거나 설정 좌표가 없거나 가상 사례면 null이다. 네이버 실시간 보완 좌표는 싣지 않는다(#222).
임시 DB·실제 API로 본다(외부 호출 없음).
"""

from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.opportunity.geo_store import store_public_coordinate
from geosan.opportunity.geocode_http import GeocodeClient
from geosan.opportunity.geocoding import GeocodeResolver
from geosan.opportunity.location_csv import GeoPoint
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from tests.unit.u7.test_geocoding import ADDRESS, public_company  # noqa: F401 (픽스처)


def detail_data():
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities/opp-geocode")
    assert response.status_code == 200
    return response.json()["data"]


def test_stored_public_coordinate_gives_center_and_company(public_company):  # noqa: F811
    """Given 설정 거산 좌표와 저장된 공공좌표 / When 상세 / Then map에 두 점이 실린다."""
    store_public_coordinate("cust-geocode", ADDRESS, GeoPoint(37.9, 127.4, "CSV"))
    data = detail_data()
    assert data["map"] == {
        "center": {"lat": 38.0, "lng": 127.5},
        "company": {"lat": 37.9, "lng": 127.4},
    }
    # 지도 칸에는 좌표 말고 아무것도 없다(이름·주소·대표번호·메모 없음).
    assert set(data["map"]) == {"center", "company"}


def test_no_stored_coordinate_gives_null(public_company):  # noqa: F811
    """Given 저장된 좌표가 없는 회사 / When 상세 / Then map은 null(칸은 있다)."""
    data = detail_data()
    assert "map" in data and data["map"] is None


def test_no_geosan_coordinate_in_settings_gives_null(public_company):  # noqa: F811
    """Given 설정에 거산 좌표가 없다 / When 상세 / Then 회사 좌표가 있어도 map은 null."""
    store_public_coordinate("cust-geocode", ADDRESS, GeoPoint(37.9, 127.4, "CSV"))
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat, settings.geosan.lng = None, None
        sync_app_settings(session, settings)
    assert detail_data()["map"] is None


def test_virtual_company_gives_null(public_company):  # noqa: F811
    """Given 좌표가 저장됐지만 가상 사례로 바뀐 회사 / When 상세 / Then map은 null."""
    store_public_coordinate("cust-geocode", ADDRESS, GeoPoint(37.9, 127.4, "CSV"))
    with session_scope() as session:
        session.get(Customer, "cust-geocode").is_virtual = True
    assert detail_data()["map"] is None


def test_live_naver_point_is_not_sent_as_map(public_company, monkeypatch):  # noqa: F811
    """Given 저장 좌표 없이 네이버 실시간 보완만 / When 상세 / Then 거리는 있어도 map은 null."""
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geocoding.naver_fallback_enabled = True
        sync_app_settings(session, settings)
    monkeypatch.setattr(GeocodeClient, "search", lambda *args: [])
    monkeypatch.setattr(GeocodeResolver, "live_naver", lambda *a: GeoPoint(37.9, 127.4, "NAVER"))
    data = detail_data()
    assert data["header"]["distanceKm"] is not None
    assert data["map"] is None
