"""S02: 가짜 후보 부품과 실제 SQLite·명령으로 회차 두 번을 이어 실행한다."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.opportunity.models import IngestBatch
from geosan.storage.session import session_scope
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
