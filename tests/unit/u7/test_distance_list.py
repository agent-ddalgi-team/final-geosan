"""#658: 목록 전체의 거리 정렬·필터, 페이지 및 기존 평가 보존."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.config.errors import AppError
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.geocode_http import GeocodeClient
from geosan.opportunity.geocoding import GeocodeResolver
from geosan.opportunity.location_csv import GeoPoint
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u7.test_dashboard_breakdown import add_company
from tests.unit.u7.test_dashboard_breakdown import brochure_env as brochure_env

URL = "/api/v1/opportunities"


@pytest.fixture
def distance_env(brochure_env):
    ids = [add_company(brochure_env, f"distance-{i}") for i in range(5)]
    assert run_evaluation().ok
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat, settings.geosan.lng = 38, 127.5
        settings.geocoding.enabled = False
        sync_app_settings(session, settings)
        for opp_id, lat in zip(ids, [38.6, 38.1, 38.1, 38.4, None], strict=True):
            customer = customer_for(session, opp_id)
            customer.lat, customer.lng, customer.geocode_source = lat, 127.5, "CSV"
    with TestClient(create_app()) as client:
        yield client, ids


def customer_for(session, opp_id):
    return session.get(Customer, session.get(Opportunity, opp_id).customer_id)


def listing(client, **params):
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_distance_sort_happens_before_pagination_and_keeps_ties(distance_env):
    client, ids = distance_env
    baseline = listing(client)["data"]
    expected = sorted(baseline, key=lambda c: (c["distanceKm"] is None, c["distanceKm"] or 0))
    full = listing(client, sort="distance")
    assert [c["oppId"] for c in full["data"]] == [c["oppId"] for c in expected]
    assert full["data"][-1]["oppId"] == ids[-1]
    assert [c["rank"] for c in full["data"]] == list(range(1, 6))
    pages = [listing(client, sort="distance", pageSize=2, page=i) for i in [1, 2, 3]]
    assert [c for p in pages for c in p["data"]] == full["data"]
    assert all(p["meta"]["total"] == 5 for p in pages)


def test_distance_filter_changes_total_before_pagination_and_omits_unknown(distance_env):
    client, ids = distance_env
    body = listing(client, maxDistanceKm=50, pageSize=2)
    second = listing(client, maxDistanceKm=50, pageSize=2, page=2)
    assert body["meta"]["total"] == second["meta"]["total"] == 3
    assert {c["oppId"] for p in [body, second] for c in p["data"]} == set(ids[1:4])
    assert sum(body["meta"]["bucketCounts"].values()) == 3
    assert all(c["distanceKm"] <= 50 for p in [body, second] for c in p["data"])


def test_filter_uses_configured_presets_and_includes_boundary(distance_env):
    client, ids = distance_env
    boundary = listing(client)["data"][0]["distanceKm"]
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.distance_filter_presets_km = [boundary]
        sync_app_settings(session, settings)
    body = listing(client, maxDistanceKm=boundary, sort="distance")
    assert ids[0] in {c["oppId"] for c in body["data"]}
    assert client.get(URL, params={"maxDistanceKm": 50}).status_code == 400


@pytest.mark.parametrize("value", ["-1", "0", "nan", "inf", "abc", "31"])
def test_invalid_distance_filter_is_rejected(distance_env, value):
    client, _ = distance_env
    assert client.get(URL, params={"maxDistanceKm": value}).status_code == 400


def test_distance_sort_and_filter_do_not_change_evaluations_or_default_order(distance_env):
    client, _ = distance_env
    before = listing(client)
    with session_scope() as session:
        ledger = [
            (r.eval_id, r.original_rank, r.score_s) for r in session.scalars(select(EvaluationRun))
        ]
    listing(client, sort="distance", maxDistanceKm=50)
    assert listing(client) == before
    with session_scope() as session:
        assert [
            (r.eval_id, r.original_rank, r.score_s) for r in session.scalars(select(EvaluationRun))
        ] == ledger


def test_distance_condition_composes_with_existing_filters(distance_env):
    client, ids = distance_env
    with session_scope() as session:
        customer_for(session, ids[1]).name = "거리검색대상"
    body = listing(client, sort="distance", maxDistanceKm=30, q="거리검색대상")
    assert [c["oppId"] for c in body["data"]] == [ids[1]]
    assert body["meta"]["total"] == 1


def test_empty_distance_page_and_unknown_only_filter(distance_env):
    client, ids = distance_env
    assert listing(client, sort="distance", page=4)["data"] == []
    with session_scope() as session:
        customer_for(session, ids[-1]).name = "미확인거리회사"
    body = listing(client, maxDistanceKm=100, q="미확인거리회사")
    assert body["data"] == [] and body["meta"]["total"] == 0


def test_missing_origin_is_an_error_only_for_distance_conditions(distance_env):
    client, _ = distance_env
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat, settings.geosan.lng = None, None
        sync_app_settings(session, settings)
    assert client.get(URL, params={"sort": "distance"}).status_code == 503
    assert client.get(URL, params={"maxDistanceKm": 50}).status_code == 503
    assert listing(client)["meta"]["total"] == 5


def test_list_uses_only_stored_coordinates_without_external_lookup(distance_env, monkeypatch):
    """#686 PM 결정 2026-11-13: 목록은 저장된 위치만 쓴다(못 찾은 회사를 요청마다 다시 묻지 않음).

    예전에는 목록에서도 네이버 실시간 보완을 한 번 썼다(#658). 이제 위치를 모르는 회사는
    거리 미확인으로 거리 조건에서 빠지고, 실시간 보완은 그 회사의 자세히 보기에서만 한다.
    """
    client, ids = distance_env
    calls = []
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geocoding.enabled = settings.geocoding.naver_fallback_enabled = True
        sync_app_settings(session, settings)
        customer_for(session, ids[-1]).address = "충청남도 천안시 서북구 성거읍 시험로 10"

    def naver(*args):
        calls.append(1)
        return GeoPoint(38, 127.5, "NAVER")

    monkeypatch.setattr(GeocodeResolver, "live_naver", naver)
    monkeypatch.setattr(GeocodeClient, "search", lambda *a: calls.append("juso") or [])
    response = client.get(URL, params={"sort": "distance", "maxDistanceKm": 30, "pageSize": 1})
    assert response.status_code == 200, response.text
    assert ids[-1] not in [row["oppId"] for row in response.json()["data"]]
    assert response.json()["meta"]["total"] == 2
    assert calls == []
    assert response.headers["cache-control"] == "no-store"
    with session_scope() as session:
        customer = customer_for(session, ids[-1])
        assert customer.lat is None and customer.geocoded_at is None


def test_provider_failure_does_not_return_false_distance_order(distance_env, monkeypatch):
    client, _ = distance_env

    def fail(*args, **kwargs):
        raise AppError("주소 제공 서버 오류", "다시 시도해 주세요.", status=503)

    monkeypatch.setattr("geosan.api.routes.opportunities.customer_distances", fail)
    assert client.get(URL, params={"sort": "distance"}).status_code == 503
