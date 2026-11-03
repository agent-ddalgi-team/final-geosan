"""#209: 원본 주소 보존과 지역·공정·산업·단계 선택을 실제 SQLite·API로 확인한다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.models import AppSetting
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def region_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    addresses = [
        "충청남도 천안시 서북구 가상로 1",
        "충남 아산시 가상로 2",
        "대전광역시 유성구 가상로 3",
        "세종특별자치시 가상로 4",
        None,
    ]
    ids = []
    for index, address in enumerate(addresses):
        case = factories.apjeong_renamed_customer(str(index), name=f"가상기업{index}")
        case["customer"].update(
            bizNumber=None,
            address=address,
            industries=["반도체"] if index == 0 else ["자동차 부품"],
        )
        ids.append(import_case(_write(tmp_path, f"case-{index}.json", case)).opp_id)
    assert run_evaluation().ok
    with session_scope() as session:
        for link in session.scalars(select(OppProcessLink).where(OppProcessLink.opp_id == ids[1])):
            link.process_code = "ZINC_PLATING"
    with TestClient(create_app()) as client:
        yield client, ids, addresses


def test_regions_preserve_raw_address_and_combine_all_filters(region_env):
    """Given 원본 주소 / When 묶음·공정·산업·단계 선택 / Then 조건 모두를 만족한 곳만 보인다."""
    client, ids, addresses = region_env
    url = "/api/v1/opportunities"
    whole = client.get(url).json()
    expected_regions = ["천안시", "아산시", "대전광역시", "세종특별자치시", None]
    by_id = {row["oppId"]: row for row in whole["data"]}
    for opp_id, address, region in zip(ids, addresses, expected_regions, strict=True):
        assert by_id[opp_id]["region"] == region
        assert client.get(f"{url}/{opp_id}").json()["data"]["header"]["address"] == (address or "")
    selected = client.get(url, params={"region": "천안 인근"}).json()
    assert {row["oppId"] for row in selected["data"]} == set(ids[:2])
    assert [row["rank"] for row in selected["data"]] == [1, 2]
    assert selected["meta"]["regionCounts"] == whole["meta"]["regionCounts"]
    for row in selected["data"]:
        assert row["scoreDisplay"] == by_id[row["oppId"]]["scoreDisplay"]
    assert (
        client.post(
            f"{url}/{ids[0]}/outcomes",
            json={"status": "INTERESTED"},
            headers={"X-Staff-Key": "park-lee"},
        ).status_code
        == 200
    )
    params = dict(region="천안 인근", process="ANODIZING", industry="반도체", stage="INTERESTED")
    result = client.get(url, params=params).json()
    assert [row["oppId"] for row in result["data"]] == ids[:1]
    assert client.get(url, params={**params, "region": "아산시"}).json()["data"] == []
    assert client.get(url, params={"region": "미등록 지역"}).json()["data"] == []
    page = client.get(url, params={"region": "천안 인근", "pageSize": 1, "page": 2}).json()
    assert page["meta"]["total"] == 2 and page["data"][0]["rank"] == 2


def test_region_counts_follow_process_and_runtime_presets(region_env):
    """Given 설정 묶음·여러 공정 / When 탭 변경 / Then 탭 안 건수를 묶음 먼저 보낸다."""
    client, ids, _ = region_env
    with session_scope() as session:
        session.get(AppSetting, "listFilters").value = {
            "regionPresets": [
                {"label": "가상 중부", "cities": ["대전광역시", "세종특별자치시"]},
                {"label": "천안 인근", "cities": ["천안시", "아산시"]},
                {"label": "빈 묶음", "cities": ["없는시"]},
            ]
        }
    counts = client.get("/api/v1/opportunities").json()["meta"]["regionCounts"]
    assert counts[:2] == [
        {"region": "가상 중부", "count": 2},
        {"region": "천안 인근", "count": 2},
    ]
    assert {row["region"] for row in counts[2:]} == {
        "천안시",
        "아산시",
        "대전광역시",
        "세종특별자치시",
    }
    selected = client.get("/api/v1/opportunities?process=ZINC_PLATING").json()
    assert [row["oppId"] for row in selected["data"]] == ids[1:2]
    assert selected["meta"]["regionCounts"] == [
        {"region": "천안 인근", "count": 1},
        {"region": "아산시", "count": 1},
    ]


def test_reimport_updates_raw_address_and_legacy_rows_stay_unknown(region_env, tmp_path):
    """Given 원본 없는 이전 행 / When 조회·재투입 / Then 추측하지 않고 원문으로 갱신한다."""
    client, ids, _ = region_env
    with session_scope() as session:
        customer_id = session.get(Opportunity, ids[0]).customer_id
        customer = session.get(Customer, customer_id)
        customer.address = None
        normalized = customer.normalized_address
    url = "/api/v1/opportunities"
    card = next(row for row in client.get(url).json()["data"] if row["oppId"] == ids[0])
    assert card["region"] is None
    assert client.get(f"{url}/{ids[0]}").json()["data"]["header"]["address"] == ""
    case = factories.apjeong_renamed_customer("0", name="가상기업0")
    case["customer"].update(bizNumber=None, address="충청남도 천안시 서북구 가상로 1")
    assert import_case(_write(tmp_path, "again.json", case)).opp_id == ids[0]
    with session_scope() as session:
        customer = session.get(Customer, customer_id)
        assert customer.address == case["customer"]["address"]
        assert customer.normalized_address == normalized
    card = next(row for row in client.get(url).json()["data"] if row["oppId"] == ids[0])
    assert card["region"] == "천안시"
