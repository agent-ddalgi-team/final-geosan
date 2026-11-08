"""#428: 서버 시작이 전달한 실행 함수로 실제 API·임시 DB를 잇는다.

#427이 합쳐지기 전에는 실행 부품만 대역으로 주입한다. 실제 후보 찾기 검사는 #427 소유다.
"""

import sys
from types import ModuleType

import pytest
import uvicorn
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.commands import serve
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.test_ingest_api import BODY, post
from tests.unit.u3.test_ingest_batches import batch_db as batch_db


def server_app(monkeypatch, run):
    module = ModuleType("geosan.workflows.flow_ingest")
    module.run_ingest = run
    monkeypatch.setitem(sys.modules, module.__name__, module)
    started = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: started.append((app, kwargs)))
    serve._run_server(18767, "127.0.0.1")
    assert len(started) == 1
    assert started[0][1] == {
        "host": "127.0.0.1",
        "port": 18767,
        "log_config": None,
        "access_log": False,
    }
    return started[0][0]


@pytest.fixture
def wired_app(batch_db, monkeypatch):
    calls = []

    def run(batch_id):
        calls.append(batch_id)
        with session_scope() as session:
            row = session.get(IngestBatch, batch_id)
            assert row.status == "RUNNING"
            row.status = "DONE"
            row.finished_at = utcnow()

    # 실제 uvicorn 루프만 잡아 앱을 읽는다. 요청·회차 예약·상태 저장은 실제 코드다.
    with TestClient(server_app(monkeypatch, run)) as client:
        yield client, calls


def test_server_start_connects_ingest_and_persists_finished_batch(wired_app):
    client, calls = wired_app
    response = post(client)
    assert response.status_code == 200, response.text
    batch_id = response.json()["data"]["batchId"]
    assert calls == [batch_id]
    progress = client.get("/api/v1/opportunities").json()["meta"]["latestIngest"]
    assert progress["batchId"] == batch_id and progress["status"] == "DONE"


@pytest.mark.parametrize("staff", [None, "viewer", "unknown"])
def test_server_connection_keeps_staff_requirement(wired_app, staff):
    client, calls = wired_app
    assert post(client, staff=staff).status_code == 403
    assert calls == []


def test_server_execution_failure_is_reported_without_secret_details(batch_db, monkeypatch):
    calls = []

    def failed(batch_id):
        calls.append(batch_id)
        with session_scope() as session:
            assert session.get(IngestBatch, batch_id).status == "RUNNING"
        raise RuntimeError("외부 오류 원문은 기록에 복사하지 않음")

    with TestClient(server_app(monkeypatch, failed)) as client:
        response = post(client)
        assert response.status_code == 200
        batch_id = response.json()["data"]["batchId"]
        progress = client.get("/api/v1/opportunities").json()["meta"]["latestIngest"]
    assert calls == [batch_id]
    assert progress["batchId"] == batch_id and progress["status"] == "FAILED"
    assert progress["failureReason"] and "외부 오류 원문" not in progress["failureReason"]


def test_export_app_stays_without_execution_connection(batch_db):
    with TestClient(create_app()) as client:
        response = client.post("/api/v1/ingest", json=BODY, headers={"X-Staff-Key": "park-lee"})
    assert response.status_code == 503
