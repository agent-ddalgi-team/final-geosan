"""#666: 화면 설정 응답이 목록 거리 범위 선택지를 설정 그대로 준다. 모든 데이터는 가상이다."""

from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.storage.session import session_scope


def presets(client):
    response = client.get("/api/v1/config/ui")
    assert response.status_code == 200, response.text
    return response.json()["data"]["distanceFilterPresetsKm"]


def test_config_ui_gives_distance_presets_from_settings(tmp_db):
    """Given 기본 설정 / When 화면 설정을 읽으면 / Then 30·50·100km, 설정을 바꾸면 그 값."""
    with TestClient(create_app()) as client:
        assert presets(client) == [30, 50, 100]
        with session_scope() as session:
            settings = read_app_settings(session)
            settings.distance_filter_presets_km = [20, 40]
            sync_app_settings(session, settings)
        assert presets(client) == [20, 40]
        listed = client.get("/api/v1/opportunities", params={"tab": "new", "maxDistanceKm": 30})
        assert listed.status_code == 400, listed.text
