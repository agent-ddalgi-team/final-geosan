"""#549 2단계 시나리오: 실제 API·임시 DB + 가상 AI 답·가짜 찾기. 외부 호출은 없다."""

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.api.ingest_views import latest_ingest
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import IngestBatch
from geosan.storage.session import session_scope
from tests.unit.u3 import test_ingest_estimate as support
from tests.unit.u3.conftest import factory_file as factory_file
from tests.unit.u3.conftest import ingest_batch as ingest_batch

pick_context = support.pick_context
public_rows = support.public_rows
judged = support.judged

scenarios("u3/ingest_budget.feature")


@pytest.fixture
def api():
    finder = support.FakeFinder()
    with TestClient(create_app(ingest_runner=finder)) as client:
        yield {"client": client, "finder": finder}


def _logs():
    with session_scope() as session:
        return len(session.scalars(select(TransferLog)).all())


def _batches():
    with session_scope() as session:
        return [row.batch_id for row in session.scalars(select(IngestBatch))]


@given("판단 전 가상 공장 2곳과 넉넉한 이번 달 한도가 있다")
def unjudged_with_room(pick_context):
    support.configure()
    support.finish_fixture_batch()


@given("판단 전 가상 공장 2곳과 예상보다 작은 이번 달 한도가 있다")
def unjudged_over_budget(pick_context):
    support.configure(cost_limit=1.0)
    support.finish_fixture_batch()


@given("판단이 끝난 가상 공장 2곳과 넉넉한 이번 달 한도가 있다")
def judged_with_room(judged):
    support.configure()
    support.finish_fixture_batch()


@when("담당자가 아연도금·충남 조건의 예상 금액을 본다", target_fixture="preview")
def see_preview(api):
    before = (_logs(), _batches())
    response = api["client"].get(support.PREVIEW, params=support.CONDITIONS)
    assert response.status_code == 200, response.text
    return {"data": response.json()["data"], "before": before}


@then("판단 전 2곳의 판단 금액과 조사 금액을 더한 예상 금액이 보인다")
def estimate_shown(preview):
    data = preview["data"]
    assert data["unjudgedCount"] == 2
    estimate = data["estimate"]
    assert (estimate["judgeRows"], estimate["judgeUsd"]) == (2, 0.004)
    assert (estimate["researchCount"], estimate["researchUsd"]) == (50, 2.0)
    assert estimate["totalUsd"] == 2.004


@then("이번 달 사용액과 한도가 함께 오고 잠기지 않는다")
def month_shown(preview):
    assert preview["data"]["month"] == {
        "usedUsd": 0.0,
        "limitUsd": 20.0,
        "usedCalls": 0,
        "limitCalls": 1000,
    }
    assert preview["data"]["blocked"] is None


@then("외부 호출 기록과 회차는 새로 생기지 않는다")
def nothing_saved(preview):
    assert (_logs(), _batches()) == preview["before"]


@then("금액 초과로 잠기고 판단할 수 있는 공장 수가 0 이상으로 온다")
def locked(preview):
    assert preview["data"]["blocked"] == {"kind": "OVER_COST", "judgeableRows": 0}


@when("담당자가 화면 잠금을 거치지 않고 같은 조건으로 더하기를 요청한다", target_fixture="posted")
@when("담당자가 같은 조건으로 더하기를 요청한다", target_fixture="posted")
def request_ingest(api):
    return api["client"].post(support.INGEST, json=support.BODY, headers=support.STAFF)


@then("이번 달 남은 AI 금액을 넘는다는 오류로 거부한다")
def rejected(posted):
    assert posted.status_code == 422
    error = posted.json()["error"]
    assert (error["kind"], error["message"]) == (
        "INGEST_OVER_BUDGET",
        "이번 달 남은 AI 금액을 넘습니다",
    )
    assert error["nextAction"] == "시·군을 골라 나눠 진행해 주세요"


@then("회차가 만들어지지 않고 찾기가 실행되지 않는다")
def no_batch(api):
    assert _batches() == ["batch-test"]
    assert api["finder"].calls == []


@then("새 회차에 접수 때 예상 금액이 남는다")
def estimate_saved(posted, api):
    assert posted.status_code == 200, posted.text
    batch_id = posted.json()["data"]["batchId"]
    assert api["finder"].calls == [batch_id]
    with session_scope() as session:
        assert session.get(IngestBatch, batch_id).estimated_usd == 0.04


@then("마지막 회차 요약에 예상 금액과 실제 금액이 함께 있다")
def summary_has_costs(posted):
    with session_scope() as session:
        summary = latest_ingest(session, "VIRTUAL_REVIEWED").model_dump(by_alias=True)
    assert summary["batchId"] == posted.json()["data"]["batchId"]
    # 가짜 찾기는 외부 호출을 하지 않으므로 실제 금액은 0이다.
    assert (summary["estimatedUsd"], summary["actualUsd"]) == (0.04, 0.0)


@then("예상 금액 칸이 생기기 전의 옛 회차는 예상 금액이 비어 있다")
def old_batch_empty():
    with session_scope() as session:
        assert session.get(IngestBatch, "batch-test").estimated_usd is None
