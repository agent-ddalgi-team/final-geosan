"""#490: 실제 임시 DB·실행 흐름·API에서 안전한 실패 사유가 보존되는지 확인한다."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenarios, then, when

from geosan.api.app import create_app
from geosan.config.errors import InputError, RunFailedError
from geosan.config.models import AppSetting
from geosan.opportunity.source_models import SourceContract
from geosan.storage.session import session_scope
from geosan.workflows.ingest_sources import FactoryFileDateError
from tests.unit.u3 import test_flow_ingest as support
from tests.unit.u3.test_ingest_api import post

ingest_env = support.ingest_env
scenarios(str(Path(__file__).with_name("ingest_failure_reason.feature")))

SOURCE_MESSAGE = "공장현황 소스의 이용·저장 확인을 먼저 기록해 주세요."
DATE_MESSAGE = "파일명이나 폴더명에 기준일(YYYYMMDD)이 있어야 합니다."


def remove_source_confirmation():
    with session_scope() as session:
        session.delete(session.get(SourceContract, "kicox-factory-csv"))


def api_failure(run):
    with TestClient(create_app(ingest_runner=run)) as client:
        response = post(client)
        assert response.status_code == 200, response.text
        identifier = response.json()["data"]["batchId"]
        listing = client.get("/api/v1/opportunities")
        assert listing.status_code == 200, listing.text
        progress = listing.json()["meta"]["latestIngest"]
        assert progress["batchId"] == identifier and progress["status"] == "FAILED"
    saved = support.saved(identifier)
    assert saved.status == "FAILED" and saved.finished_at and saved.new_count == 0
    assert saved.failure_reason == progress["failureReason"]
    return progress["failureReason"]


@given("공장 파일과 후보 찾기용 임시 DB가 준비되어 있다", target_fixture="failure_context")
def prepared(ingest_env):
    return ingest_env


@when(parsers.parse('"{problem}" 상태에서 후보 찾기를 실행한다'), target_fixture="failed_run")
def start_invalid_run(failure_context, problem):
    if problem == "소스 확인 없음":
        remove_source_confirmation()
    batch_id = support.new_batch(
        dataset="BROCHURE" if problem == "묶음 불일치" else "VIRTUAL_REVIEWED"
    )
    with pytest.raises(RunFailedError) as raised:
        support.flow.run_ingest(batch_id)
    assert failure_context.picker.calls == 0
    return support.saved(batch_id), raised.value


@then(parsers.parse('실패 회차에 "{message}" 안내가 그대로 남는다'))
def reason_is_preserved(failed_run, message):
    saved, error = failed_run
    assert saved.status == "FAILED" and saved.finished_at and saved.new_count == 0
    assert saved.failure_reason == error.message == message


@pytest.mark.parametrize("error_type", [InputError, FactoryFileDateError, RunFailedError])
def test_api_preserves_known_internal_error_messages(ingest_env, error_type):
    calls = []
    message = "후보 찾기 조건과 자료를 확인해 주세요."

    def run(batch_id):
        calls.append(batch_id)
        raise error_type(message)

    assert api_failure(run) == message
    assert len(calls) == 1 and ingest_env.picker.calls == 0


def test_real_workflow_source_failure_reaches_progress_api(ingest_env):
    remove_source_confirmation()
    assert api_failure(support.flow.run_ingest) == SOURCE_MESSAGE
    assert ingest_env.picker.calls == 0


def test_real_workflow_file_date_failure_reaches_progress_api(ingest_env):
    with session_scope() as session:
        row = session.get(AppSetting, "ingestion")
        row.value = row.value | {"factoryCsvPath": str(ingest_env.path.with_name("undated.csv"))}
    assert api_failure(support.flow.run_ingest) == DATE_MESSAGE
    assert ingest_env.picker.calls == 0


def test_api_does_not_overwrite_a_recorded_safe_failure_reason(ingest_env):
    message = "새 후보의 재평가를 완료하지 못했습니다."

    def run(batch_id):
        support.flow._failed(batch_id, message)
        raise RuntimeError("PRIVATE_EXCEPTION_MARKER")

    assert api_failure(run) == message
    assert ingest_env.picker.calls == 0


def test_external_exception_keeps_only_safe_stage_message(ingest_env, monkeypatch, caplog):
    def fail_reading(batch_id):
        raise RuntimeError("PRIVATE_EXCEPTION_MARKER")

    monkeypatch.setattr(support.flow, "load_source_rows", fail_reading)
    assert api_failure(support.flow.run_ingest) == (
        "공공자료 읽기을 마치지 못했습니다. 자료와 설정을 확인해 주세요."
    )
    assert "PRIVATE_EXCEPTION_MARKER" not in caplog.text
    assert ingest_env.picker.calls == 0
