"""#627: 실제 임시 DB·API로 공정·산업군 막대 시나리오를 확인한다. 외부 AI 호출 없음."""

from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import read_app_settings
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u7 import test_dashboard_breakdown as support
from tests.unit.u7.test_bookmark import MINE, set_bookmark

brochure_env = support.brochure_env
breakdown_env = support.breakdown_env
scenarios("u7/dashboard_breakdown.feature")


@given(
    "관심·접촉·견적/샘플·최근 성사 회사 4곳과 대상이 아닌 회사 5곳이 있다",
    target_fixture="client",
)
def companies(breakdown_env):
    client, _ = breakdown_env
    return client


@given("가상 묶음에 관심으로 켠 가상 회사가 있다", target_fixture="client")
def virtual_company(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_id = import_case(_write(tmp_path, "a.json", factories.apjeong_case())).opp_id
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        assert set_bookmark(client, opp_id, True).status_code == 200
        yield client


@when("대시보드를 연다", target_fixture="dashboard")
def open_dashboard(client):
    response = client.get("/api/v1/dashboard", headers=MINE)
    assert response.status_code == 200, response.text
    return response.json()["data"]


@when("AI 제안을 세지 않도록 설정을 끄고 대시보드를 연다", target_fixture="dashboard")
def open_without_proposed(client):
    support.set_count_proposed(False)
    return open_dashboard(client)


@then("대시보드 대상은 4곳이다")
def four_targets(dashboard):
    assert dashboard["breakdown"]["basis"]["total"] == 4


@then("공정 9종이 역량 파일 순서로 모두 보이고 0곳인 공정도 있다")
def all_processes(dashboard):
    rows = dashboard["breakdown"]["byProcess"]
    assert [row["processCode"] for row in rows] == support.PROCESS_CODES
    assert len(rows) == 9
    assert sum(row["count"] == 0 for row in rows) == 6


@then("공정이 둘인 회사는 두 공정에 각각 세어 아노다이징 4곳 100%, 아연도금 1곳 25%다")
def counted_each(dashboard):
    rows = {row["processCode"]: row for row in dashboard["breakdown"]["byProcess"]}
    assert (rows["ANODIZING"]["count"], rows["ANODIZING"]["ratio"]) == (4, 1)
    assert (rows["ZINC_PLATING"]["count"], rows["ZINC_PLATING"]["ratio"]) == (1, 0.25)


@then("산업군 막대는 설정 순서이고 맨 끝이 미확정 2곳 50%다")
def industry_order(dashboard):
    rows = dashboard["breakdown"]["byIndustry"]
    with session_scope() as session:
        configured = read_app_settings(session).industries
    assert [row["industry"] for row in rows] == [*configured, "미확정"]
    assert (rows[-1]["count"], rows[-1]["ratio"]) == (2, 0.5)


@then("방위산업은 2곳 50%이고 AI 제안 포함으로 표시된다")
def proposed_included(dashboard):
    row = support.industry_rows(dashboard["breakdown"])["방위산업"]
    assert (row["count"], row["ratio"], row["includesProposed"]) == (2, 0.5, True)


@then("방위산업은 1곳이고 미확정은 3곳이며 AI 제안 포함 표시가 없다")
def confirmed_only(dashboard):
    rows = support.industry_rows(dashboard["breakdown"])
    assert rows["방위산업"]["count"] == 1 and rows["미확정"]["count"] == 3
    assert not any(row["includesProposed"] for row in rows.values())


@then("관심 기업은 1곳으로 세지만 공정·산업군 막대는 없다")
def no_breakdown(dashboard):
    assert dashboard["counts"]["BOOKMARKED"] == 1
    assert dashboard["breakdown"] is None
