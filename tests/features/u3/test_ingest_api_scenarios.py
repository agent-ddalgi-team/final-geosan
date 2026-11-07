"""#317 가짜 찾기 + 실제 API·임시 DB. 실제 후보 수집·외부 AI 검사는 아니다."""

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when

from geosan.api.app import create_app
from geosan.config.errors import AppError
from geosan.storage.session import session_scope
from tests.unit.u3 import test_ingest_api as support

batch_db = support.batch_db

scenarios("u3/ingest_api.feature")


@pytest.fixture
def api_context(batch_db):
    clients = []
    calls = []
    yield clients, calls
    for client in clients:
        client.__exit__(None, None, None)


@given("현재 공정과 실제 임시 DB와 가짜 찾기를 연결한 API가 있다", target_fixture="client")
def ready(api_context):
    clients, calls = api_context
    finder = support.FakeFinder()

    def run(batch_id):
        calls.append(batch_id)
        finder(batch_id)

    client = TestClient(create_app(ingest_runner=run))
    client.__enter__()
    clients.append(client)
    return client


@given("현재 공정과 실제 임시 DB와 실패하는 가짜 찾기를 연결한 API가 있다", target_fixture="client")
def failing(api_context):
    clients, calls = api_context

    def fail(batch_id):
        calls.append(batch_id)
        raise AppError("가상 찾기 실패", "다시 시도해 주세요.", 503, "LLM_FAILED")

    client = TestClient(create_app(ingest_runner=fail))
    client.__enter__()
    clients.append(client)
    return client


@given("현재 공정과 실제 임시 DB가 있지만 찾기는 연결하지 않은 API가 있다", target_fixture="client")
def unconnected(api_context):
    clients, _ = api_context
    client = TestClient(create_app())
    client.__enter__()
    clients.append(client)
    return client


@then("연결 준비 안내를 돌려주고 회차와 가짜 실행을 남기지 않는다")
def unconnected_refused(api_context, response):
    _, calls = api_context
    assert response.status_code == 503
    assert "연결" in response.json()["error"]["message"]
    assert calls == [] and support.support.batches() == []


@given("이미 실행 중인 찾기 회차가 있다")
def running():
    with session_scope() as session:
        support.support.reserve(session)


@when("담당자가 아노다이징 후보 찾기를 요청한다", target_fixture="response")
def requested(client):
    return support.post(client)


@then("접수된 회차 번호와 최초 건수가 응답에 있다")
def accepted(response):
    assert response.status_code == 200
    assert response.json()["data"]["batchId"]
    assert response.json()["data"]["newCount"] == 0


@then("확정된 같은 회차 번호로 가짜 찾기가 한 번 실행된다")
def executed(api_context, response):
    _, calls = api_context
    (saved,) = support.support.batches()
    assert calls == [saved.batch_id] == [response.json()["data"]["batchId"]]
    assert saved.status == "DONE"


@then("지금 가져오는 중이라는 오류만 돌려주고 찾기를 추가로 부르지 않는다")
def refused(api_context, response):
    _, calls = api_context
    assert response.status_code == 409
    assert response.json()["error"]["kind"] == "INGEST_RUNNING"
    assert calls == [] and len(support.support.batches()) == 1


@then("접수된 회차는 실패로 남고 실패 시각과 안내가 저장된다")
def failed(api_context, response):
    _, calls = api_context
    assert response.status_code == 200
    (saved,) = support.support.batches()
    assert calls == [saved.batch_id]
    assert saved.status == "FAILED" and saved.finished_at is not None
    assert saved.failure_reason
