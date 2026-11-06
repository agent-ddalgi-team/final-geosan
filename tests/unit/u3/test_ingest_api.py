"""#317 실제 API·임시 DB와 테스트에서만 주입한 가짜 찾기로 요청 경계를 검사한다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from geosan.api.app import create_app
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.errors import AppError
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3 import test_ingest_batches as support

batch_db = support.batch_db
PATH = "/api/v1/ingest"
BODY = {"processCodes": ["ANODIZING"]}


def post(client, body=None, staff="park-lee"):
    return client.post(
        PATH,
        json=BODY if body is None else body,
        headers={"X-Staff-Key": staff} if staff is not None else {},
    )


class FakeFinder:
    """실제 찾기가 아니라 회차 번호 전달·별도 세션에서의 완료 저장만 확인한다."""

    def __init__(self):
        self.calls = []

    def __call__(self, batch_id):
        self.calls.append(batch_id)
        with session_scope() as session:
            batch = session.get(IngestBatch, batch_id)
            assert batch is not None and batch.status == "RUNNING"
            batch.status = "DONE"
            batch.finished_at = utcnow()


@pytest.fixture
def api_env(batch_db):
    finder = FakeFinder()
    with TestClient(create_app(ingest_runner=finder)) as client:
        yield client, finder


def test_request_commits_before_execution_and_returns_initial_counts(api_env):
    client, finder = api_env
    response = post(client)
    assert response.status_code == 200
    data = response.json()["data"]
    (saved,) = support.batches()
    assert data == {
        "batchId": saved.batch_id,
        "newCount": 0,
        "mergeCandidateCount": 0,
        "skippedCount": 0,
    }
    assert response.json()["meta"]["updatedAt"]
    assert finder.calls == [saved.batch_id]
    assert saved.status == "DONE" and saved.finished_at is not None


def test_response_body_is_sent_before_finder_starts(batch_db):
    sent = []

    class ObserveResponse:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            async def observe(message):
                await send(message)
                if message["type"] == "http.response.body" and not message.get("more_body", False):
                    sent.append("body")

            await self.app(scope, receive, observe)

    finder = FakeFinder()

    def run(batch_id):
        assert sent == ["body"]
        finder(batch_id)

    app = create_app(ingest_runner=run)
    app.add_middleware(ObserveResponse)
    with TestClient(app) as client:
        assert post(client).status_code == 200
    assert len(finder.calls) == 1


@pytest.mark.parametrize("staff", [None, "viewer", "unknown"])
def test_invalid_staff_neither_saves_nor_schedules_a_search(api_env, staff):
    client, finder = api_env
    assert post(client, staff=staff).status_code == 403
    assert finder.calls == [] and support.batches() == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"processCodes": []},
        {"processCodes": ["UNKNOWN"]},
        {**BODY, "regions": ["설정 밖"]},
        {**BODY, "industries": ["설정 밖"]},
        {**BODY, "max": True},
        {**BODY, "max": 999999},
        {**BODY, "extra": True},
    ],
)
def test_invalid_conditions_neither_save_nor_schedule_a_search(api_env, body):
    client, finder = api_env
    assert post(client, body).status_code == 400
    assert finder.calls == [] and support.batches() == []


def test_running_batch_returns_409_without_scheduling_a_second_search(api_env):
    client, finder = api_env
    with session_scope() as session:
        identifier = support.reserve(session).batch_id
    response = post(client)
    assert response.status_code == 409
    assert response.json()["error"]["kind"] == "INGEST_RUNNING"
    (saved,) = support.batches()
    assert saved.batch_id == identifier and saved.status == "RUNNING"
    assert finder.calls == []


def test_commit_failure_schedules_nothing_and_preserves_no_batch(api_env):
    client, finder = api_env

    def fail_commit(session):
        if any(isinstance(row, IngestBatch) for row in session.identity_map.values()):
            raise OperationalError("COMMIT", {}, RuntimeError("가상 확정 실패"))

    event.listen(Session, "before_commit", fail_commit)
    try:
        assert post(client).status_code == 500
    finally:
        event.remove(Session, "before_commit", fail_commit)
    assert finder.calls == [] and support.batches() == []


@pytest.mark.parametrize(
    "failure",
    [
        AppError("가상 외부 오류", "나중에 다시 해 주세요.", 503, "LLM_FAILED"),
        RuntimeError("PRIVATE_EXCEPTION_MARKER"),
    ],
)
def test_background_failure_leaves_failed_batch_without_exposing_raw_exception(batch_db, failure):
    calls = []

    def fail(batch_id):
        calls.append(batch_id)
        raise failure

    with TestClient(create_app(ingest_runner=fail)) as client:
        response = post(client)
    assert response.status_code == 200  # 회차 접수 응답이며 찾기 완료 응답이 아니다.
    (saved,) = support.batches()
    assert calls == [saved.batch_id]
    assert saved.status == "FAILED" and saved.finished_at is not None
    assert saved.failure_reason
    assert "PRIVATE_EXCEPTION_MARKER" not in saved.failure_reason
    assert "PRIVATE_EXCEPTION_MARKER" not in response.text


def test_runner_returning_without_a_result_is_not_counted_as_success(batch_db):
    with TestClient(create_app(ingest_runner=lambda batch_id: None)) as client:
        assert post(client).status_code == 200
    (saved,) = support.batches()
    assert saved.status == "FAILED" and saved.finished_at is not None


def test_failure_to_save_failed_status_is_not_swallowed(batch_db):
    def fail(batch_id):
        raise RuntimeError("가상 찾기 실패")

    def fail_recording(session, context, instances):
        if any(isinstance(row, IngestBatch) and row.status == "FAILED" for row in session.dirty):
            raise OperationalError("UPDATE", {}, RuntimeError("가상 실패 기록 저장 오류"))

    event.listen(Session, "before_flush", fail_recording)
    try:
        with TestClient(create_app(ingest_runner=fail)) as client:
            with pytest.raises(OperationalError):
                post(client)
    finally:
        event.remove(Session, "before_flush", fail_recording)
    (saved,) = support.batches()
    assert saved.status == "RUNNING" and saved.failure_reason is None


def test_protected_access_requires_login_even_with_a_valid_staff_key(batch_db, examples_dir):
    settings = load_app_settings(examples_dir / "app-settings-virtual.yaml")
    settings.access_protection.enabled = True
    with session_scope() as session:
        sync_app_settings(session, settings)
    finder = FakeFinder()
    with TestClient(create_app(ingest_runner=finder)) as client:
        assert post(client).status_code == 401
    assert finder.calls == [] and support.batches() == []


def test_normal_app_never_registers_a_fake_search_endpoint(batch_db):
    assert not any(getattr(route, "path", None) == PATH for route in create_app().routes)
