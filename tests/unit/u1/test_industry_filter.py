"""#209 산업군의 투입·검색·필터를 실제 SQLite로 확인한다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.errors import InputError
from geosan.config.file_checks import check_case_file
from geosan.config.models import AppSetting
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def industry_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    ids = []
    for index, industries in enumerate([["반도체", "자동차 부품"], ["자동차 부품"], []]):
        case = factories.apjeong_renamed_customer(str(index), name=f"가상기업{index}")
        case["customer"]["bizNumber"] = None
        case["customer"]["industries"] = industries
        ids.append(import_case(_write(tmp_path, f"case-{index}.json", case)).opp_id)
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, ids


def test_industry_search_counts_and_combined_process_filter(industry_env):
    """Given 복수 산업군과 미확정 / When 산업군·검색·공정 선택 / Then AND이며 전체 건수다."""
    client, ids = industry_env
    url = "/api/v1/opportunities"
    whole = client.get(url).json()
    assert whole["meta"]["industryCounts"] == [
        {"industry": "반도체", "count": 1},
        {"industry": "자동차 부품", "count": 2},
    ]
    selected = client.get(url, params={"industry": "자동차 부품", "pageSize": 1, "page": 2}).json()
    assert selected["meta"]["total"] == 2
    assert selected["data"][0]["rank"] == 2
    assert selected["meta"]["industryCounts"] == whole["meta"]["industryCounts"]
    for params in [{"q": "반도체"}, {"industry": "반도체", "process": "ANODIZING"}]:
        response = client.get(url, params=params).json()
        assert [row["oppId"] for row in response["data"]] == ids[:1]
    assert (
        client.get(url, params={"industry": "반도체", "process": "ZINC_PLATING"}).json()["data"]
        == []
    )
    assert (
        client.get(url, params={"process": "ZINC_PLATING"}).json()["meta"]["industryCounts"] == []
    )
    assert (
        client.get(url, params={"industry": "반도체", "stage": "INTERESTED"}).json()["data"] == []
    )
    assert client.get(url, params={"industry": "미등록"}).status_code == 400
    for card in whole["data"]:
        detail = client.get(f"{url}/{card['oppId']}").json()["data"]["header"]
        assert detail["industries"] == card["industries"]
        assert detail["industriesSource"] == ("CASE_FILE" if card["industries"] else None)
        assert card["scoreDisplay"] == "77점 · 7/8"
    target = whole["data"][0]
    assert target["oppId"] in [
        row["oppId"]
        for row in client.get(url, params={"q": target["title"].split(" · ")[0]}).json()["data"]
    ]
    assert client.get(url, params={"q": "존재하지않음"}).json()["data"] == []


def test_industries_use_runtime_settings_and_reimport_replaces_values(industry_env, tmp_path):
    """Given 설정 변경 / When 재투입 / Then 현재 설정으로 검사하고 CASE_FILE로 교체한다."""
    client, ids = industry_env
    with session_scope() as session:
        session.get(AppSetting, "industries").value = ["가상 산업"]
    case = factories.apjeong_renamed_customer("0", name="가상기업0")
    case["customer"]["bizNumber"] = None
    case["customer"]["industries"] = ["가상 산업", "가상 산업"]
    imported = import_case(_write(tmp_path, "replace.json", case))
    assert imported.opp_id == ids[0]
    detail = client.get(f"/api/v1/opportunities/{ids[0]}").json()["data"]["header"]
    assert detail["industries"] == ["가상 산업"]
    assert detail["industriesSource"] == "CASE_FILE"
    case["customer"]["industries"] = ["반도체"]
    with pytest.raises(InputError):
        import_case(_write(tmp_path, "invalid.json", case))
    assert client.get(f"/api/v1/opportunities/{ids[0]}").json()["data"]["header"]["industries"] == [
        "가상 산업"
    ]


@pytest.mark.parametrize("industries", [["미등록"], ["반도체"] * 4])
def test_invalid_industries_reject_without_partial_storage(tmp_db, tmp_path, industries):
    """Given 목록 밖 또는 네 개 산업군 / When 검사·투입 / Then 오류이고 고객도 저장 안 한다."""
    case = factories.apjeong_case()
    case["customer"]["industries"] = industries
    path = _write(tmp_path, "invalid.json", case)
    report = check_case_file(path)
    assert not report.ok
    assert any("industries" in error.path for error in report.errors)
    with pytest.raises(InputError):
        import_case(path)
    with session_scope() as session:
        assert session.scalar(select(Customer)) is None
        assert session.scalar(select(Opportunity)) is None
