"""#427 운영 명령: 실제 임시 DB의 회차 예약과 실행 결과 줄을 확인한다."""

import pytest
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.opportunity.models import IngestBatch
from geosan.storage.session import session_scope
from tests.unit.u3 import test_flow_ingest as support

ingest_env = support.ingest_env
runner = CliRunner()


def invoke(*extra):
    return runner.invoke(app, ["ingest", "kicox-factory-csv", "--process", "ZINC_PLATING", *extra])


def test_command_reserves_system_batch_and_prints_terminal_counts(ingest_env):
    result = invoke("--region", "충남", "--max", "1")
    assert result.exit_code == 0, result.output
    assert "DONE" in result.output
    assert all(
        text in result.output for text in ["읽은 행 3건", "판단 3건", "선정 1건", "등록 1곳"]
    )
    with session_scope() as session:
        batch = session.scalar(select(IngestBatch))
        assert batch.status == "DONE" and batch.requested_by == "SYSTEM"
        assert batch.criteria == {
            "processCodes": ["ZINC_PLATING"],
            "regions": ["충남"],
            "industries": [],
        }
        assert batch.max_candidates == 1 and not batch.rejudge


@pytest.mark.parametrize(
    "extra", [("--max", "0"), ("--region", "미등록지역"), ("--industry", "미등록산업")]
)
def test_invalid_condition_creates_no_batch(ingest_env, extra):
    result = invoke(*extra)
    assert result.exit_code == 1
    with session_scope() as session:
        assert session.scalar(select(IngestBatch)) is None
    assert ingest_env.picker.calls == 0


def test_running_batch_blocks_command_without_a_second_run(ingest_env):
    support.new_batch()
    result = invoke()
    assert result.exit_code == 1 and "지금 가져오는 중" in result.output
    assert ingest_env.picker.calls == 0
    with session_scope() as session:
        assert len(session.scalars(select(IngestBatch)).all()) == 1


def test_failure_prints_safe_reason_and_returns_two(ingest_env, monkeypatch):
    def failed(batch_id, row_ids):
        raise RuntimeError("저장하지 않을 비밀 원문")

    monkeypatch.setattr(support.flow, "pick_candidates", failed)
    result = invoke()
    assert result.exit_code == 2
    assert "FAILED" in result.output and "실패 사유" in result.output
    assert "비밀 원문" not in result.output


def test_rejudge_flag_is_recorded_and_reuses_same_registration(ingest_env):
    assert invoke().exit_code == 0
    result = invoke("--rejudge")
    assert result.exit_code == 0, result.output
    assert "등록 0곳" in result.output and "건너뜀 1건" in result.output
    assert ingest_env.picker.calls == 2


def test_unknown_source_is_rejected_before_running(ingest_env):
    result = runner.invoke(app, ["ingest", "unknown", "--process", "ZINC_PLATING"])
    assert result.exit_code == 1 and ingest_env.picker.calls == 0
    with session_scope() as session:
        assert session.scalar(select(IngestBatch)) is None
