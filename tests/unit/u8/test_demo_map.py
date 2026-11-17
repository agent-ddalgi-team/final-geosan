"""#811 시연 DB 지도: 가상 회사의 가상 위치(DEMO)는 시연 표시 DB에서만.

실제 회사 규칙은 그대로다.

가상 자료만 쓴다(거산 실제 사양 아님). 외부 호출 없음.
사용자 흐름은 tests/features/u8/demo_db.feature.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from geosan.commands.seed_demo_records import DEFAULT_DEMO_RECORDS_PATH, check_demo_records_file
from geosan.config.app_settings import load_app_settings
from geosan.config.errors import InputError
from geosan.dashboard.map_points import build_map_points, map_name
from geosan.opportunity.geo_store import DEMO_SOURCE, store_demo_coordinate, stored_point
from geosan.opportunity.models import Customer
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope
from tests.features.u8.test_demo_db_scenarios import DEMO_SETTINGS, build_db, run
from tests.unit.u8.test_demo_db import _records

KST = ZoneInfo("Asia/Seoul")


def _customer(**values) -> SimpleNamespace:
    base = dict(
        name="G정공(가상)",
        is_virtual=True,
        security_grade="PUBLIC",
        lat=None,
        lng=None,
        geocode_source=None,
        geocoded_at=None,
    )
    base.update(values)
    return SimpleNamespace(**base)


# ---------------------------------------------------------------------------
# 좌표를 인정하는 규칙
# ---------------------------------------------------------------------------


def test_virtual_company_counts_only_demo_location():
    """Given 가상 회사 / When 저장 좌표 읽기 / Then 출처가 DEMO일 때만 점, 나머지 출처는 없음."""
    demo = _customer(lat=36.86, lng=127.16, geocode_source=DEMO_SOURCE)
    point = stored_point(demo)
    assert (point.lat, point.lng, point.source) == (36.86, 127.16, DEMO_SOURCE)
    for source in ["JUSO", "CSV", "MANUAL", None]:
        assert stored_point(_customer(lat=36.86, lng=127.16, geocode_source=source)) is None


def test_real_company_ignores_demo_location_and_keeps_public_rule():
    """Given 실제 회사에 DEMO 좌표 / When 읽기 / Then 무시. 공공좌표는 지금처럼 인정."""
    real = dict(name="실제", is_virtual=False, lat=36.8, lng=127.1)
    assert stored_point(_customer(**real, geocode_source=DEMO_SOURCE)) is None
    assert stored_point(_customer(**real, geocode_source="JUSO")).source == "JUSO"


def test_non_public_virtual_company_has_no_point():
    hidden = _customer(security_grade="INTERNAL", lat=36.8, lng=127.1, geocode_source=DEMO_SOURCE)
    assert stored_point(hidden) is None


def test_store_demo_coordinate_writes_once_and_refuses_other_cases():
    """Given 가상 회사 / When 가상 위치 저장 / Then 처음엔 바뀜, 같은 값이면 그대로."""
    customer = _customer()
    assert store_demo_coordinate(customer, 36.86, 127.16) is True
    assert (customer.lat, customer.lng, customer.geocode_source) == (36.86, 127.16, "DEMO")
    assert customer.geocoded_at is not None
    assert store_demo_coordinate(customer, 36.86, 127.16) is False
    assert store_demo_coordinate(customer, 36.85, 127.16) is True and customer.lat == 36.85


@pytest.mark.parametrize(
    ("customer", "lat", "lng", "message"),
    [
        (_customer(is_virtual=False), 36.8, 127.1, "가상 회사에만"),
        (_customer(lat=36.1, lng=127.1, geocode_source="JUSO"), 36.8, 127.1, "다른 출처"),
        (_customer(), 95, 127.1, "위도·경도"),
        (_customer(), float("nan"), 127.1, "위도·경도"),
    ],
)
def test_store_demo_coordinate_refusals(customer, lat, lng, message):
    """Given 실제 회사·다른 출처 좌표·틀린 값 / When 가상 위치 저장 / Then 거부, 값은 그대로."""
    before = (customer.lat, customer.lng, customer.geocode_source)
    with pytest.raises(InputError, match=message):
        store_demo_coordinate(customer, lat, lng)
    assert (customer.lat, customer.lng, customer.geocode_source) == before


def test_map_name_marks_virtual_once():
    assert map_name(_customer(name="A정밀")) == "A정밀(가상)"
    assert map_name(_customer(name="G정공(가상)")) == "G정공(가상)"
    assert map_name(_customer(name="실제 회사", is_virtual=False)) == "실제 회사"


# ---------------------------------------------------------------------------
# 예시 파일
# ---------------------------------------------------------------------------


def test_example_records_give_every_company_a_blunt_virtual_location():
    """Given 예시 가상 기록 파일 / When 읽기 / Then 36곳 모두 천안·아산 일대 가상 위치(#826).

    값은 소수 둘째 자리로 뭉툭하게 적는다.
    """
    records = check_demo_records_file(DEFAULT_DEMO_RECORDS_PATH).records
    locations = [company.location for company in records.companies]
    assert len(locations) == 36 and all(locations)
    for location in locations:
        assert 36.6 <= location.lat <= 37.0 and 126.9 <= location.lng <= 127.3
        assert round(location.lat, 2) == location.lat and round(location.lng, 2) == location.lng
    assert len({(loc.lat, loc.lng) for loc in locations}) == 36


def test_records_file_without_location_is_still_fine(tmp_path):
    """Given location 없는 옛 파일 / When 검사 / Then 통과(선택 칸)."""

    def drop(data):
        for company in data["companies"]:
            company.pop("location", None)

    check = check_demo_records_file(_records(tmp_path, drop))
    assert check.errors == [] and all(c.location is None for c in check.records.companies)


# ---------------------------------------------------------------------------
# 시연 DB에서 저장·지도
# ---------------------------------------------------------------------------


@pytest.fixture
def seeded_demo_db(tmp_path, monkeypatch):
    try:
        db_path = build_db(tmp_path / "demo-map.db", monkeypatch, DEMO_SETTINGS)
        code, out = run("seed-demo-records")
        assert code == 0, out
        yield db_path
    finally:
        dispose_engines()


def test_seed_twice_keeps_locations_and_fills_skipped_companies(seeded_demo_db):
    """Given 넣은 시연 DB에서 위치만 지움 / When 다시 넣기 / Then 기록은 건너뛰고 위치는 채움."""
    with session_scope(seeded_demo_db) as session:
        for customer in session.scalars(select(Customer)):
            customer.lat = customer.lng = customer.geocode_source = None
    code, out = run("seed-demo-records")
    assert code == 0, out
    assert "건너뛴 회사 36곳" in out and "가상 위치 36곳" in out
    with session_scope(seeded_demo_db) as session:
        sources = {c.geocode_source for c in session.scalars(select(Customer))}
    assert sources == {DEMO_SOURCE}


def test_map_stays_empty_for_virtual_data_without_demo_mark(seeded_demo_db):
    """Given DEMO 위치가 든 DB / When 시연 표시 없는 가상 설정으로 지도 / Then 빈 목록.

    시연 표시가 없으면 지금 규칙 그대로다.
    """
    settings = load_app_settings(DEMO_SETTINGS)
    with session_scope(seeded_demo_db) as session:
        now = datetime.now(UTC)
        points, missing = build_map_points(session, settings, now, tz=KST)
        assert len(points) == 21 and missing == 0  # (#826) 성사 9 + 진행 중 12
        plain = settings.model_copy(
            update={"brand": settings.brand.model_copy(update={"demo": False})}
        )
        assert build_map_points(session, plain, now, tz=KST) == ([], 0)
