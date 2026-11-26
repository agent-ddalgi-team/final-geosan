"""#798(PM 지시 2026-11-16): 새 후보 찾기 권역 묶음과 "자료 기준" 줄.

예시 설정·실제 SQLite·API로 본다. 공장 행은 가상 자료만 쓴다(거산 실제 사양 아님).
"""

import hashlib
import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import AppSettings, load_app_settings
from geosan.config.models import AppSetting
from geosan.opportunity.source_models import (
    CandidateJudgment,
    FactoryProfile,
    SourceFactoryRow,
    WaterSite,
)
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

EXAMPLES = ["app-settings.yaml", "app-settings-virtual.yaml", "app-settings-demo.yaml"]
GROUPS = {
    "천안·아산": ["천안시", "아산시"],
    "세종·대전·공주": ["세종", "대전", "공주시"],
    "충남 서북부": ["당진시", "서산시", "예산군", "홍성군", "태안군"],
    "충남 남부": ["논산시", "계룡시", "부여군", "청양군", "보령시", "서천군", "금산군"],
    # #961(PM 결정 2026-11-26): 경기도까지 확대. 경기 권역 4개는 팀 제안.
    "경기 남부": ["평택시", "안성시", "오산시", "화성시", "용인시", "이천시", "여주시"],
    "경기 서부": [
        "수원시",
        "안산시",
        "시흥시",
        "안양시",
        "군포시",
        "의왕시",
        "과천시",
        "광명시",
        "부천시",
        "김포시",
    ],
    "경기 동부": ["성남시", "하남시", "광주시", "구리시", "남양주시", "양평군", "가평군"],
    "경기 북부": ["고양시", "파주시", "의정부시", "양주시", "동두천시", "포천시", "연천군"],
}


@pytest.mark.parametrize("filename", EXAMPLES)
def test_examples_have_region_groups_inside_configured_regions(filename):
    """Given 예시 설정 / When 읽기 / Then 충남권 4개 + 경기 4개가 이 순서로, 모두 regions 안이다."""
    settings = load_app_settings(Path("examples") / filename)
    groups = {group.label: group.regions for group in settings.ingestion.region_groups}
    assert groups == GROUPS
    assert list(groups) == list(GROUPS)
    assert {r for regions in groups.values() for r in regions} <= set(settings.ingestion.regions)
    presets = [preset.label for preset in settings.list_filters.region_presets]
    assert presets[:4] == list(GROUPS)[:4]
    assert "충남" in presets and "경기" in presets
    assert set(GROUPS) <= set(presets)
    # #961: 경기 권역은 경기 시·군 31개를 빠짐없이 한 번씩 나눈다.
    from geosan.opportunity.factory_csv import CITY_PARENTS, parent_regions

    gyeonggi = [
        city for label, cities in groups.items() if label.startswith("경기") for city in cities
    ]
    assert sorted(gyeonggi) == sorted(c for c, p in CITY_PARENTS.items() if p == "경기")
    assert parent_regions(gyeonggi) == ["경기"]


def test_old_settings_without_groups_still_load_and_schema_lists_the_field():
    settings = load_app_settings(Path("examples/app-settings.yaml"))
    data = settings.model_dump(by_alias=True)
    del data["ingestion"]["regionGroups"]
    assert AppSettings.model_validate(data).ingestion.region_groups == []
    schema = json.loads(Path("contracts/app-settings.schema.json").read_text(encoding="utf-8"))
    field = schema["properties"]["ingestion"]["properties"]["regionGroups"]
    assert field["items"]["required"] == ["label", "regions"]
    assert "regionGroups" not in schema["properties"]["ingestion"]["required"]


@pytest.mark.parametrize(
    "groups",
    [
        [{"label": "없는 곳", "regions": ["제주시"]}],
        [
            {"label": "같은 이름", "regions": ["천안시"]},
            {"label": "같은 이름", "regions": ["아산시"]},
        ],
        [{"label": "빈 묶음", "regions": []}],
    ],
)
def test_bad_region_groups_are_refused(groups):
    """Given regions 밖의 값·겹친 이름·빈 묶음 / When 설정 검사 / Then 거부한다."""
    data = load_app_settings(Path("examples/app-settings.yaml")).model_dump(by_alias=True)
    data["ingestion"]["regionGroups"] = groups
    with pytest.raises(ValidationError):
        AppSettings.model_validate(data)


@pytest.fixture
def config_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "capability.json", factories.capability_file()))
    with TestClient(create_app()) as client:
        yield client


def ingest_options(client):
    response = client.get("/api/v1/config/ui")
    assert response.status_code == 200, response.text
    return response.json()["data"]["ingestOptions"]


def test_config_ui_gives_region_groups_from_settings(config_env):
    with session_scope() as session:
        row = session.get(AppSetting, "ingestion")
        row.value = row.value | {
            "regions": ["천안시", "아산시", "세종"],
            "regionGroups": [{"label": "천안·아산", "regions": ["천안시", "아산시"]}],
        }
    assert ingest_options(config_env)["regionGroups"] == [
        {"label": "천안·아산", "regions": ["천안시", "아산시"]}
    ]


def _common(virtual: bool) -> dict:
    return {"dataset_kind": "VIRTUAL_REVIEWED" if virtual else None, "is_virtual": virtual}


def _source_rows(virtual: bool, day: date, judged: datetime, suffix: str) -> list:
    common = _common(virtual)
    product_hash = hashlib.sha256("볼트".encode()).hexdigest()
    return [
        SourceFactoryRow(
            row_id=f"row-{suffix}",
            source_id="kicox-factory-csv",
            company_name=f"가상볼트{suffix}",
            address="충남 아산시 가상길 1",
            region="충남",
            product="볼트",
            product_hash=product_hash,
            file_date=day,
            loaded_at=utcnow(),
            **common,
        ),
        FactoryProfile(
            profile_id=f"profile-{suffix}",
            source_id="factoryon-lookup",
            file_date=day,
            company_name=f"가상볼트{suffix}",
            normalized_name=f"가상볼트{suffix}",
            address="충남 아산시 가상길 1",
            normalized_address="충남아산시가상길1",
            region="충남",
            industry_codes=[],
            loaded_at=utcnow(),
            **common,
        ),
        WaterSite(
            site_id=f"site-{suffix}",
            source_id="water-list",
            file_date=day,
            site_name=f"가상도금{suffix}",
            normalized_name=f"가상도금{suffix}",
            address="충남 아산시 가상길 2",
            normalized_address="충남아산시가상길2",
            region="충남",
            treatment_types=[],
            loaded_at=utcnow(),
            **common,
        ),
        CandidateJudgment(
            judgment_id=f"judgment-{suffix}",
            row_id=f"row-{suffix}",
            criteria_version="가상",
            product_hash=product_hash,
            is_manufacturer=True,
            process_codes=[],
            industries=[],
            reason="가상 판단",
            fit_level="HIGH",
            own_plating_line_suspected=False,
            judged_at=judged,
            model="가상",
            **common,
        ),
    ]


def test_data_basis_shows_latest_dates_of_the_active_kind_only(config_env):
    """Given 활성 묶음과 같은 쪽의 공공자료·판단, 다른 쪽(가상/실제)의 더 늦은 날짜 행
    / When 화면 설정을 읽기 / Then 같은 쪽 날짜만 종류별로 보이고, 판단은 한국 날짜다."""
    with session_scope() as session:
        active = session.get(AppSetting, "activeDatasetKind").value
    virtual = active == "VIRTUAL_REVIEWED"
    rows = _source_rows(
        virtual, date(2025, 12, 31), datetime(2026, 11, 13, 16, 0, tzinfo=UTC), "a"
    ) + _source_rows(not virtual, date(2026, 6, 30), datetime(2026, 11, 20, 1, 0, tzinfo=UTC), "b")
    with session_scope() as session:
        # 판단 행은 공장 행을 가리키므로 공장 행을 먼저 저장한다.
        session.add_all([row for row in rows if not isinstance(row, CandidateJudgment)])
        session.flush()
        session.add_all([row for row in rows if isinstance(row, CandidateJudgment)])
    assert ingest_options(config_env)["dataBasis"] == [
        {"kind": "FACTORY_FILE", "asOf": "2025-12-31"},
        {"kind": "FACTORY_LOOKUP", "asOf": "2025-12-31"},
        {"kind": "WATER_LIST", "asOf": "2025-12-31"},
        # UTC 11/13 16:00 = 한국 11/14 01:00
        {"kind": "AI_JUDGMENT", "asOf": "2026-11-14"},
    ]
