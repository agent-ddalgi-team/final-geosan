"""#428: 실제 설정·역량 파일로 선택지와 재투입 순서 및 공개 범위를 검사한다."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.models import AppSetting
from geosan.opportunity.models import Opportunity
from geosan.storage.session import session_scope
from tests import factories
from tests.unit.u1.test_process_order import reimport_with_shared_times
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def options_env(tmp_db, tmp_path):
    capability = factories.capability_file()
    import_capability(_write(tmp_path, "capability.json", capability))
    with TestClient(create_app()) as client:
        yield client, capability


def options(client):
    response = client.get("/api/v1/config/ui")
    assert response.status_code == 200, response.text
    return response.json()["data"]["ingestOptions"]


def test_zero_candidates_still_give_all_processes_and_configured_choices(options_env):
    client, capability = options_env
    with session_scope() as session:
        assert session.scalar(select(Opportunity)) is None
        row = session.get(AppSetting, "ingestion")
        row.value = row.value | {"regions": ["세종", "충남"]}
        session.get(AppSetting, "industries").value = ["반도체", "자동차 부품"]
    actual = options(client)
    assert actual == {
        "processes": [{"code": p["code"], "name": p["name"]} for p in capability["processes"]],
        "regions": ["세종", "충남"],
        "industries": ["반도체", "자동차 부품"],
    }
    assert len(actual["processes"]) == 9
    assert set(actual) == {"processes", "regions", "industries"}
    assert all(set(p) == {"code", "name"} for p in actual["processes"])


@pytest.mark.parametrize("group_size", [2, 9])
def test_reimported_file_order_is_used_even_when_save_times_match(
    options_env, tmp_path, group_size
):
    client, capability = options_env
    capability["processes"].reverse()
    reimport_with_shared_times(capability, tmp_path, group_size)
    assert [p["code"] for p in options(client)["processes"]] == [
        p["code"] for p in capability["processes"]
    ]


def test_active_dataset_changes_choices_without_mixing_old_dataset(options_env):
    client, _ = options_env
    import_capability(Path("examples/capability-geosan-brochure.json"))
    settings = load_app_settings(Path("examples/app-settings.yaml"))
    with session_scope() as session:
        sync_app_settings(session, settings)
    response = client.get("/api/v1/config/ui")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["activeDatasetKind"] == "BROCHURE"
    assert all("가상" not in row["name"] for row in data["ingestOptions"]["processes"])
    assert data["ingestOptions"]["regions"] == settings.ingestion.regions
    assert data["ingestOptions"]["industries"] == settings.industries


def test_empty_configured_choices_are_not_replaced_with_invented_values(options_env):
    client, _ = options_env
    with session_scope() as session:
        row = session.get(AppSetting, "ingestion")
        row.value = row.value | {"regions": []}
        session.get(AppSetting, "industries").value = []
    actual = options(client)
    assert actual["regions"] == actual["industries"] == []
