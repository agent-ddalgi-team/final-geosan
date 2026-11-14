"""#743 PM 결정(2026-11-14): "같이 들를 곳"은 5km 안 관심 기업이 5곳 미만이면 그 회사만 10km 안까지.

숫자는 설정(`visitGroupRadiusKm` 5, `visitGroupWidenBelowCount` 5, `visitGroupWideRadiusKm` 10)에서
읽는다. 판단은 지도 함수 한 곳에서 하고, 대시보드 지도·[묻기] 조회·오늘 정리가 같은 결과를 쓴다.
모든 자료는 가상이다(거산 실제 사양 아님). 외부 AI는 가짜 응답이다.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    AppSettings,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.evidence import assistant_llm
from geosan.evidence.transfer import KST
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u7.test_bookmark import set_bookmark
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_dashboard_breakdown import add_company
from tests.unit.u7.test_dashboard_breakdown import brochure_env as brochure_env
from tests.unit.u7.test_sales_assistant import FakeAI, ask, use_external_ai

# 위도 0.01도 ≈ 1.1km. 묶음마다 위도가 1도(≈111km) 떨어져 서로 섞이지 않는다.
PLACES = {
    # 묶음 A: 5km 안에 관심 기업 5곳 → 5km 그대로(7.8km 떨어진 a6은 넣지 않는다).
    "A": (38.0, 127.5),
    "a1": (38.005, 127.5),
    "a2": (38.01, 127.5),
    "a3": (38.015, 127.5),
    "a4": (38.02, 127.5),
    "a5": (38.025, 127.5),
    "a6": (37.93, 127.5),
    # 묶음 B: 5km 안에 2곳 → 10km 안까지(8.9km 떨어진 b3도 넣는다, 13.3km b4는 아님).
    "B": (37.0, 127.5),
    "b1": (37.01, 127.5),
    "b2": (37.02, 127.5),
    "b3": (37.08, 127.5),
    "b4": (37.12, 127.5),
    # C: 10km 안에도 없다 → 없음.
    "C": (36.0, 127.5),
}


def today():
    return utcnow().astimezone(KST).date()


@pytest.fixture
def widen_env(brochure_env, monkeypatch):
    # 사례 번호는 소문자만 받는다: 중심 회사(A·B·C)는 "center-a"처럼 쓴다.
    ids = {
        name: add_company(
            brochure_env, f"widen-{'center-' if name.isupper() else ''}{name.lower()}"
        )
        for name in PLACES
    }
    assert run_evaluation().ok
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat, settings.geosan.lng = 37.5, 127.5
        settings.geocoding.enabled = False
        sync_app_settings(session, settings)
        for name, (lat, lng) in PLACES.items():
            customer = session.get(Customer, session.get(Opportunity, ids[name]).customer_id)
            customer.name = f"가상 {name}"
            customer.lat, customer.lng, customer.geocode_source = lat, lng, "CSV"
    use_external_ai()
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    fake = FakeAI()
    monkeypatch.setattr(assistant_llm, "_post", fake)
    with TestClient(create_app()) as client:
        for name in PLACES:
            assert set_bookmark(client, ids[name], True).status_code == 200
        # B는 내일 방문(오늘 정리의 "이번 주 일정" 회사). A·C는 진행 중으로만 둔다.
        tomorrow = (today() + timedelta(days=1)).isoformat()
        record(client, ids["B"], {"status": "IN_PROGRESS", "nextScheduleAt": tomorrow})
        record(client, ids["A"], {"status": "IN_PROGRESS", "nextScheduleAt": tomorrow})
        record(client, ids["C"], {"status": "IN_PROGRESS", "nextScheduleAt": tomorrow})
        yield client, ids, fake


def visit_map(client):
    response = client.get("/api/v1/dashboard/map")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def group_of(body, opp_id):
    return next(group for group in body["visitGroups"] if group["oppId"] == opp_id)


def nearby_names(group):
    return [row["customerName"] for row in group["nearby"]]


def set_settings(**values):
    with session_scope() as session:
        settings = read_app_settings(session)
        for key, value in values.items():
            setattr(settings, key, value)
        sync_app_settings(session, settings)


def test_five_or_more_within_five_km_keeps_five_km(widen_env):
    client, ids, _fake = widen_env
    body = visit_map(client)
    assert (body["visitRadiusKm"], body["visitWidenBelowCount"]) == (5, 5)
    group = group_of(body, ids["A"])
    assert group["radiusKm"] == 5
    assert nearby_names(group) == ["가상 a1", "가상 a2", "가상 a3", "가상 a4", "가상 a5"]


def test_fewer_than_five_within_five_km_widens_that_company_to_ten_km(widen_env):
    client, ids, _fake = widen_env
    group = group_of(visit_map(client), ids["B"])
    assert group["radiusKm"] == 10
    assert nearby_names(group) == ["가상 b1", "가상 b2", "가상 b3"]
    assert [row["distanceKm"] for row in group["nearby"]] == [1.1, 2.2, 8.9]


def test_nothing_within_ten_km_is_empty(widen_env):
    client, ids, _fake = widen_env
    group = group_of(visit_map(client), ids["C"])
    assert group["radiusKm"] == 10 and group["nearby"] == []


def test_numbers_come_from_settings(widen_env):
    """Given 넓히는 기준 6곳·넓힌 반경 15km / When 지도 / Then A도 넓혀 a6이 들고 B는 b4까지."""
    client, ids, _fake = widen_env
    set_settings(visit_group_widen_below_count=6, visit_group_wide_radius_km=15)
    body = visit_map(client)
    assert body["visitWidenBelowCount"] == 6
    a_group = group_of(body, ids["A"])
    assert a_group["radiusKm"] == 15 and "가상 a6" in nearby_names(a_group)
    assert "가상 b4" in nearby_names(group_of(body, ids["B"]))


def test_wide_radius_not_larger_than_base_does_not_widen(widen_env):
    client, ids, _fake = widen_env
    set_settings(visit_group_radius_km=20)
    group = group_of(visit_map(client), ids["B"])
    assert group["radiusKm"] == 20


def test_map_ask_and_daily_brief_share_the_same_groups(widen_env):
    """Given 같은 자료 / When 지도·[묻기]·오늘 정리 / Then 근처 회사와 반경이 세 곳에서 같다."""
    client, ids, fake = widen_env
    body = visit_map(client)
    b_line = "가상 B(진행 중) → 가상 b1 1.1km(관심), 가상 b2 2.2km(관심), 가상 b3 8.9km(관심)"
    a_line = "가상 A(진행 중) → " + ", ".join(
        f"{row['customerName']} {row['distanceKm']}km(관심)"
        for row in group_of(body, ids["A"])["nearby"]
    )
    assert ask(client, "이번 주 방문 어디야?").status_code == 200
    assert (
        client.get("/api/v1/assistant/daily", headers={"X-Staff-Key": "park-lee"}).status_code
        == 200
    )
    asked, daily = (payload["input"] for payload in fake.payloads)
    for sent in (asked, daily):
        assert f"{b_line} (10km 안 · 5km 안이 5곳 미만)" in sent
        assert f"{a_line} (5km 안)" in sent
        assert "가상 C(" not in sent  # 근처가 없는 회사는 싣지 않는다.
        # 위 두 줄은 끝까지 같다: B 줄에 b4(13.3km), A 줄에 a6(7.8km)이 붙지 않는다.


@pytest.mark.parametrize(
    "key,value",
    [
        ("visitGroupWidenBelowCount", 0),
        ("visitGroupWidenBelowCount", 51),
        ("visitGroupWidenBelowCount", 2.5),
        ("visitGroupWideRadiusKm", 0),
        ("visitGroupWideRadiusKm", 51),
    ],
)
def test_new_settings_are_bounded(key, value):
    example = load_app_settings(DEFAULT_APP_SETTINGS_PATH).model_dump(by_alias=True)
    AppSettings.model_validate(example)  # 예시 값 그대로는 통과한다(아래 거부가 다른 이유가 아님).
    with pytest.raises(ValueError):
        AppSettings.model_validate({**example, key: value})


def test_example_settings_carry_the_new_keys():
    settings = load_app_settings(DEFAULT_APP_SETTINGS_PATH)
    assert (settings.visit_group_widen_below_count, settings.visit_group_wide_radius_km) == (5, 10)
