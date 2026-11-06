"""#209 공정 탭: 실제 SQLite·평가·API로 목록과 순위를 확인한다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import OppProcessLink
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def process_env(tmp_db, tmp_path):
    capability = factories.capability_file()
    import_capability(_write(tmp_path, "cap.json", capability))
    ids = [
        import_case(
            _write(tmp_path, f"case-{i}.json", factories.apjeong_renamed_customer(str(i)))
        ).opp_id
        for i in range(3)
    ]
    assert run_evaluation().ok
    with session_scope() as session:
        links = session.scalars(select(OppProcessLink)).all()
        for link in links:
            link.process_code = "ANODIZING" if link.opp_id == ids[0] else "ZINC_PLATING"
        for code, superseded in [
            ("ANODIZING", None),
            ("ANODIZING", None),
            ("BLACK_OXIDE", utcnow()),
        ]:
            session.add(
                OppProcessLink(
                    link_id=new_id("link"),
                    opp_id=ids[1],
                    process_code=code,
                    superseded_at=superseded,
                    dataset_kind="VIRTUAL_REVIEWED",
                    is_virtual=True,
                    created_by="system",
                )
            )
    with TestClient(create_app()) as client:
        yield client, ids, capability


def test_process_tabs_count_distinct_current_links_and_keep_file_order(process_env):
    """Given 복수·중복·교체 연결 / When 공정 선택 / Then 현재 기회만 한 번씩 센다."""
    client, ids, capability = process_env
    whole = client.get("/api/v1/opportunities").json()
    selected = client.get("/api/v1/opportunities?process=ANODIZING").json()
    assert selected["meta"]["total"] == 2
    assert {row["oppId"] for row in selected["data"]} == set(ids[:2])
    assert [row["rank"] for row in selected["data"]] == [1, 2]
    assert whole["meta"]["processCounts"] == selected["meta"]["processCounts"]
    counts = selected["meta"]["processCounts"]
    expected_codes = [
        p["code"] for p in capability["processes"] if p["code"] in {"ANODIZING", "ZINC_PLATING"}
    ]
    assert [p["processCode"] for p in counts] == expected_codes
    assert {p["processCode"]: p["count"] for p in counts} == {"ANODIZING": 2, "ZINC_PLATING": 2}
    assert all("— 가상" not in p["processName"] for p in counts)
    both = next(row for row in whole["data"] if row["oppId"] == ids[1])
    assert both["processCodes"] == expected_codes
    for selected_row in selected["data"]:
        original = next(row for row in whole["data"] if row["oppId"] == selected_row["oppId"])
        assert {k: v for k, v in selected_row.items() if k != "rank"} == {
            k: v for k, v in original.items() if k != "rank"
        }


def test_process_filter_precedes_paging_and_combines_with_stage(process_env):
    """Given 공정 내 두 건 / When 두 번째 페이지·단계 조건 / Then 순위가 이어지고 AND다."""
    client, ids, _ = process_env
    base = "/api/v1/opportunities?process=ZINC_PLATING"
    full = client.get(base).json()
    second = client.get(base + "&pageSize=1&page=2").json()
    assert second["data"] == full["data"][1:]
    assert second["data"][0]["rank"] == 2
    assert second["meta"]["total"] == 2
    response = client.post(
        f"/api/v1/opportunities/{ids[1]}/outcomes",
        json={"status": "IN_PROGRESS"},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200
    in_contact = client.get(base + "&stage=IN_PROGRESS").json()
    assert [row["oppId"] for row in in_contact["data"]] == [ids[1]]
    assert in_contact["data"][0]["rank"] == 1
    assert client.get(base + "&page=3&pageSize=1").json()["data"] == []
    assert client.get("/api/v1/opportunities?process=BLACK_OXIDE").json()["data"] == []
    assert client.get("/api/v1/opportunities?process=WRONG").status_code == 400


def test_empty_process_list(tmp_db):
    """Given 평가 전 / When 공정 조회 / Then 빈 탭·빈 목록을 반환한다."""
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities?process=ANODIZING")
        assert response.status_code == 200
        assert response.json()["meta"]["processCounts"] == []
        assert response.json()["data"] == []


def test_tabs_follow_reimported_capability_order(process_env, tmp_path):
    """Given 역량 파일 순서 변경 / When 재투입 / Then 이전 등록 순서 대신 파일 순서다."""
    client, _, capability = process_env
    capability["processes"].reverse()
    import_capability(_write(tmp_path, "reordered.json", capability))
    counts = client.get("/api/v1/opportunities").json()["meta"]["processCounts"]
    assert [row["processCode"] for row in counts] == [
        row["code"]
        for row in capability["processes"]
        if row["code"] in {"ANODIZING", "ZINC_PLATING"}
    ]
