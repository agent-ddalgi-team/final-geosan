"""지도 실제 SQLite·HTTP 경계: 대상 기준, 올해 성공, 민감정보 제외, 네이버 비저장."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.access_session import COOKIE_NAME, token_fingerprint
from geosan.api.app import create_app
from geosan.api.models import AccessSession
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.dashboard.map_points import map_group
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import EvaluationBatch
from geosan.evidence.transfer import KST, TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Outcome
from geosan.rules.codes import DatasetKind
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u7.test_bookmark import set_bookmark
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_dashboard_breakdown import add_company
from tests.unit.u7.test_dashboard_breakdown import brochure_env as brochure_env

NOW = datetime(2026, 11, 13, 12, tzinfo=KST)
ADDRESS = "충청남도 천안시 서북구 성거읍 시험로 10"


@pytest.fixture
def map_env(brochure_env, monkeypatch):
    opp_id = add_company(brochure_env, "map-company")
    assert run_evaluation().ok
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat, settings.geosan.lng = 38, 127.5
        settings.distance_filter_presets_km = [25, 60, 120]
        settings.geocoding.enabled = False
        sync_app_settings(session, settings)
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.address = ADDRESS
        customer.lat, customer.lng, customer.geocode_source = 38, 127.5, "CSV"
        customer.main_phone = "041-000-0000"
    monkeypatch.setattr("geosan.api.routes.dashboard.utcnow", lambda: NOW)
    with TestClient(create_app()) as client:
        assert set_bookmark(client, opp_id, True).status_code == 200
        yield client, opp_id


def data(client):
    response = client.get("/api/v1/dashboard/map")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def customer_for(session, opp_id):
    return session.get(Customer, session.get(Opportunity, opp_id).customer_id)


@pytest.mark.parametrize(
    "status,won_at,expected",
    [
        (None, None, "INTERESTED"),
        ("NOT_EXECUTED", None, "INTERESTED"),
        ("IN_PROGRESS", None, "IN_PROGRESS"),
        ("SAMPLE_OR_REGISTRATION_APPROVED", None, "IN_PROGRESS"),
        ("ON_HOLD", None, None),
        ("LOST", None, None),
        ("WON", datetime(2025, 12, 31, 14, 59, tzinfo=UTC), None),
        ("WON", datetime(2025, 12, 31, 15, tzinfo=UTC), "WON_THIS_YEAR"),
        ("WON", NOW, "WON_THIS_YEAR"),
        ("WON", NOW + timedelta(seconds=1), None),
    ],
)
def test_groups_use_calendar_year_in_korea(status, won_at, expected):
    assert map_group(status, won_at, NOW, tz=KST) == expected


def test_this_year_uses_supplied_korean_timezone_with_utc_clock():
    now = datetime(2026, 12, 31, 15, 0, 1, tzinfo=UTC)
    new_year_won = datetime(2026, 12, 31, 15, 0, tzinfo=UTC)
    previous_year_won = datetime(2026, 12, 31, 14, 59, 59, tzinfo=UTC)
    assert map_group("WON", new_year_won, now, tz=KST) == "WON_THIS_YEAR"
    assert map_group("WON", previous_year_won, now, tz=KST) is None


def test_map_contract_reads_config_and_excludes_sensitive_fields(map_env):
    client, opp_id = map_env
    response = client.get("/api/v1/dashboard/map")
    assert response.status_code == 200
    body = response.json()["data"]
    assert set(body) == {"center", "ringsKm", "points", "missingCoordinates", "asOf"}
    assert body["center"] == {"lat": 38.0, "lng": 127.5}
    assert body["ringsKm"] == [25, 60, 120]
    assert body["missingCoordinates"] == 0
    point = body["points"][0]
    assert point["oppId"] == opp_id and point["group"] == "INTERESTED"
    assert point["distanceKm"] == 0.0
    assert set(point) == {"oppId", "customerName", "lat", "lng", "group", "distanceKm"}
    assert "041-000-0000" not in response.text and ADDRESS not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_missing_coordinate_is_counted_without_zero_point(map_env):
    client, opp_id = map_env
    with session_scope() as session:
        customer_for(session, opp_id).lat = None
    body = data(client)
    assert body["points"] == [] and body["missingCoordinates"] == 1


@pytest.mark.parametrize("excluded", ["not_bookmarked", "virtual", "private", "other_dataset"])
def test_only_current_bookmarked_public_real_population_is_returned(map_env, excluded):
    client, opp_id = map_env
    if excluded == "not_bookmarked":
        assert set_bookmark(client, opp_id, False).status_code == 200
    else:
        with session_scope() as session:
            customer = customer_for(session, opp_id)
            if excluded == "virtual":
                customer.is_virtual = True
            elif excluded == "private":
                customer.security_grade = "FORBIDDEN"
            else:
                latest_confirmed_evaluation(session, opp_id).dataset_kind = "COMPANY_CONFIRMED"
    assert data(client)["points"] == []


def test_verified_dataset_can_keep_original_brochure_customer(map_env):
    client, opp_id = map_env
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.active_dataset_kind = DatasetKind.COMPANY_CONFIRMED
        sync_app_settings(session, settings)
        evaluation = latest_confirmed_evaluation(session, opp_id)
        evaluation.dataset_kind = "COMPANY_CONFIRMED"
        session.get(EvaluationBatch, evaluation.batch_id).dataset_kind = "COMPANY_CONFIRMED"
        assert customer_for(session, opp_id).dataset_kind == "BROCHURE"
    assert len(data(client)["points"]) == 1


def test_old_success_is_not_renewed_by_later_records_and_cancellation_is_respected(map_env):
    client, opp_id = map_env
    record(client, opp_id, {"status": "WON"})
    record(client, opp_id, {"status": "WON"})
    with session_scope() as session:
        rows = session.scalars(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version)
        ).all()
        rows[0].created_at = datetime(2025, 12, 1, tzinfo=UTC)
        rows[1].created_at = NOW - timedelta(days=1)
    assert data(client)["points"] == []
    # 옛 성사 기록이 잘못 입력된 것으로 표시되면 남은 올해 성사 시점으로 판단한다.
    with session_scope() as session:
        first = session.scalar(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version)
        )
        first.cancelled_at = NOW
    assert data(client)["points"][0]["group"] == "WON_THIS_YEAR"


def test_missing_center_is_an_explicit_error(map_env):
    client, _ = map_env
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat = settings.geosan.lng = None
        sync_app_settings(session, settings)
    response = client.get("/api/v1/dashboard/map")
    assert response.status_code == 503 and "기준 좌표" in response.json()["error"]["message"]


def test_virtual_dataset_has_no_map_points(map_env):
    client, _ = map_env
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.active_dataset_kind = DatasetKind.VIRTUAL_REVIEWED
        sync_app_settings(session, settings)
    assert data(client)["points"] == []


def test_map_uses_only_stored_coordinates_and_counts_unknown(map_env, monkeypatch):
    """#686 PM 결정 2026-11-13: 지도는 저장된 위치만 쓰고 외부 조회를 하지 않는다.

    예전에는 지도에서도 네이버 실시간 보완·조회 실패를 다뤘다(#642). 이제 위치를 모르는 회사는
    좌표 없는 회사 수로만 센다. 실시간 보완은 회사 한 곳의 자세히 보기에서만 한다.
    """
    client, opp_id = map_env
    with session_scope() as session:
        customer_for(session, opp_id).lat = None
        settings = read_app_settings(session)
        settings.geocoding.enabled = settings.geocoding.naver_fallback_enabled = True
        sync_app_settings(session, settings)

    def forbidden(*args, **kwargs):
        raise AssertionError("지도에서 외부 좌표 조회를 부르면 안 됩니다")

    monkeypatch.setattr("geosan.opportunity.geocoding.GeocodeResolver.resolve", forbidden)
    monkeypatch.setattr("geosan.opportunity.geocode_http.request_json", forbidden)
    body = data(client)
    assert body["points"] == [] and body["missingCoordinates"] == 1


def test_authenticated_map_does_not_call_or_log_external_lookup(map_env, monkeypatch):
    client, opp_id = map_env
    token = "a" * 43

    def forbidden(*args, **kwargs):
        raise AssertionError("지도에서 외부 좌표 조회를 부르면 안 됩니다")

    monkeypatch.setattr("geosan.opportunity.geocode_http.request_json", forbidden)
    with session_scope() as session:
        customer = customer_for(session, opp_id)
        customer.lat = customer.lng = None
        settings = read_app_settings(session)
        settings.geocoding.enabled = settings.geocoding.naver_fallback_enabled = True
        settings.access_protection.enabled = True
        sync_app_settings(session, settings)
        session.add(
            AccessSession(
                session_id=token_fingerprint(token),
                expires_at=utcnow() + timedelta(hours=1),
                last_seen_at=utcnow(),
            )
        )
    assert client.get("/api/v1/dashboard/map").status_code == 401
    client.cookies.set(COOKIE_NAME, token)
    assert data(client)["missingCoordinates"] == 1
    with session_scope() as session:
        assert customer_for(session, opp_id).lat is None
        logs = session.scalars(
            select(TransferLog).where(TransferLog.purpose == "EXTERNAL_GEOCODE")
        ).all()
        assert logs == []
