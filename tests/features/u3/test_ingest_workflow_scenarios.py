"""S02: 외부 AI 응답만 대체하고 실제 파일·판단·등록·SQLite·명령을 잇는다."""

from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.api.app import create_app
from geosan.commands.app import app
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.storage.session import session_scope
from geosan.workflows.ingest_sources import store_dated_factory_csv
from tests.unit.u3 import conftest as factory_support
from tests.unit.u3 import test_flow_ingest as support

factory_file = factory_support.factory_file
ingest_env = support.ingest_env
scenarios("u3/ingest_workflow.feature")


@given("공장 세 행과 공정 역량 및 승인된 소스가 준비되어 있다", target_fixture="flow_context")
def prepared(ingest_env):
    return ingest_env


@when("운영자가 아연도금으로 찾은 뒤 아노다이징으로 다시 찾는다", target_fixture="results")
def requested(flow_context):
    runner = CliRunner()
    first = runner.invoke(
        app, ["ingest", "kicox-factory-csv", "--process", "ZINC_PLATING", "--region", "충남"]
    )
    second = runner.invoke(
        app, ["ingest", "kicox-factory-csv", "--process", "ANODIZING", "--region", "충남"]
    )
    return first, second


@then("두 회차가 완료되고 두 번째에는 가상 AI 호출이 늘지 않는다")
def completed(flow_context, results):
    assert all(result.exit_code == 0 for result in results)
    assert all("DONE" in result.output and "등록 1곳" in result.output for result in results)
    assert flow_context.picker.calls == 1
    with session_scope() as session:
        rows = session.scalars(select(IngestBatch)).all()
        assert len(rows) == 2 and all(row.status == "DONE" for row in rows)


@when("운영자가 기준일 없는 파일로 후보 찾기를 실행한다", target_fixture="date_result")
def requested_without_date(flow_context, monkeypatch):
    monkeypatch.setattr(
        support.flow,
        "load_source_rows",
        lambda batch_id: store_dated_factory_csv(
            batch_id, flow_context.path.with_name("factories.csv")
        ),
    )
    return CliRunner().invoke(
        app, ["ingest", "kicox-factory-csv", "--process", "ZINC_PLATING", "--region", "충남"]
    )


@then("기준일 안내와 실패 상태가 보이고 공장 저장과 AI 판단은 실행되지 않는다")
def failed_without_writing_or_judging(flow_context, date_result):
    assert date_result.exit_code == 2 and "FAILED" in date_result.output
    assert "파일명이나 폴더명에 기준일(YYYYMMDD)이 있어야 합니다" in date_result.output
    assert flow_context.picker.calls == 0
    with session_scope() as session:
        rows = session.scalars(select(IngestBatch)).all()
        assert len(rows) == 1 and rows[0].status == "FAILED"
        assert session.scalar(select(SourceFactoryRow)) is None


@when("운영자가 아연도금 후보를 한 번 찾는다", target_fixture="pending_result")
def find_once(flow_context):
    return CliRunner().invoke(
        app, ["ingest", "kicox-factory-csv", "--process", "ZINC_PLATING", "--region", "충남"]
    )


@then("새 후보의 평가 전 카드와 상세가 실제 평가 번호로 열린다")
def pending_card_and_detail(pending_result):
    assert pending_result.exit_code == 0, pending_result.output
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities")
        assert response.status_code == 200
        cards = response.json()["data"]
        assert len(cards) == 1
        card = cards[0]
        assert card["evalId"] and card["scoreState"] == "NONE"
        assert card["classificationCode"] == "NOT_EVALUATED" and card["scoreDisplay"] == "--"
        detail = client.get(f"/api/v1/opportunities/{card['oppId']}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["data"]["evalId"] == card["evalId"]


@when(
    "운영자가 아연도금 후보를 찾은 뒤 문장과 적합도가 달라진 판단으로 다시 찾는다",
    target_fixture="refresh_results",
)
def find_then_rejudge(flow_context, monkeypatch):
    command = ["ingest", "kicox-factory-csv", "--process", "ZINC_PLATING", "--region", "충남"]
    first = CliRunner().invoke(app, command)
    support.with_changed_judgment(monkeypatch)
    return first, CliRunner().invoke(app, [*command, "--rejudge"])


@then("기존 회사 카드의 추천 이유와 적합도가 최신 판단으로 보이고 새 회사는 늘지 않는다")
def refreshed_card(refresh_results):
    assert all(result.exit_code == 0 for result in refresh_results), refresh_results[1].output
    with TestClient(create_app()) as client:
        (card,) = client.get("/api/v1/opportunities").json()["data"]
        assert card["pickReason"] == support.NEW_REASON and card["fitLevel"] == "MEDIUM"
        detail = client.get(f"/api/v1/opportunities/{card['oppId']}").json()["data"]
        assert detail["reasons"]["reason"] == support.NEW_REASON
        assert detail["header"]["pickReason"] == support.NEW_REASON
