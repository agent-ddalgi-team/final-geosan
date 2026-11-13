"""Given/When/Then: CSV 우선 처리 및 네이버 실시간 보완의 경계."""

import csv

import pytest
from pytest_bdd import given, scenarios, then, when

from geosan.config.app_settings import GeocodingSettings
from geosan.config.errors import InputError
from geosan.opportunity.geo_store import store_public_coordinate
from geosan.opportunity.geocoding import GeocodeResolver
from geosan.opportunity.location_csv import LocationIndex

scenarios("u7/geocoding.feature")
ADDRESS = "충청남도 천안시 서북구 성거읍 시험로 10"


@pytest.fixture
def state():
    return {"calls": [], "paths": [], "naver": []}


@given("공개 주소에 대응하는 위치 CSV가 있다")
def source(state, tmp_path):
    path = tmp_path / "source.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            [
                "시도명",
                "시군구명",
                "읍면동명",
                "도로명코드",
                "도로명",
                "지하여부",
                "건물본번",
                "건물부번",
                "X좌표",
                "Y좌표",
            ]
        )
        writer.writerow(
            ["충청남도", "천안시 서북구", "성거읍", "1", "시험로", "0", "10", "0", 1000000, 2000000]
        )
    state["paths"] = [str(path)]


@given("공공자료에서는 좌표가 없고 네이버에서 같은 주소 한 곳이 나온다")
def naver_source(state):
    state["naver"] = [dict(roadAddress=ADDRESS, x="127.5", y="38")]


@given("공공자료에는 없고 네이버가 다른 건물 주소를 반환한다")
def wrong_naver_source(state):
    state["naver"] = [dict(roadAddress=ADDRESS.replace("10", "11"), x="127.5", y="38")]


@when("그 회사의 좌표를 연결한다")
def resolve(state):
    class Client:
        def search(self, query):
            state["calls"].append("search")
            return []

        def naver(self, query):
            state["calls"].append("naver")
            return state["naver"]

    service = GeocodeResolver(
        LocationIndex(state["paths"]), GeocodingSettings(enabled=True, naver_fallback_enabled=True)
    )
    state["point"] = service.resolve(ADDRESS, Client())


@then("공공좌표가 반환되고 외부 조회는 없다")
def no_external(state):
    assert state["point"].source == "CSV"
    assert state["calls"] == []


@then("네이버 결과는 실시간 전용이며 저장할 수 없다")
def not_storable(state):
    assert state["point"].source == "NAVER"
    assert state["calls"] == ["search", "naver"]
    with pytest.raises(InputError):
        store_public_coordinate("any", ADDRESS, state["point"])


@then("위치 미확인으로 남긴다")
def unresolved(state):
    assert state["point"] is None
