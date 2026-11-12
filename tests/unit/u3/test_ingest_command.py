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


def _llm(**values):
    from geosan.config.models import AppSetting

    with session_scope() as session:
        row = session.get(AppSetting, "llm")
        row.value = row.value | values


def _used():
    from geosan.config.registry import load_runtime_config
    from geosan.evidence.transfer import month_usage

    with session_scope() as session:
        return float(month_usage(session, load_runtime_config(session).app_settings.llm)[1])


def _batches():
    with session_scope() as session:
        return session.scalars(select(IngestBatch).order_by(IngestBatch.started_at)).all()


def test_over_budget_command_is_rejected_without_batch_or_ai_call(ingest_env):
    """Given 공장 3행을 읽어 둔 DB와 이번 달 사용액보다 작은 한도 / When 명령으로 찾는다(#549)
    / Then 화면·API와 같은 검사로 거부하고 회차를 만들지 않으며 AI도 부르지 않는다."""
    assert invoke("--region", "충남", "--max", "1").exit_code == 0
    _llm(monthlyCostLimitUsd=_used() / 2)
    result = invoke("--region", "충남", "--max", "1", "--rejudge")
    assert result.exit_code == 1, result.output
    assert "이번 달 남은 AI 금액을 넘습니다" in result.output
    assert "시·군을 골라 나눠 진행해 주세요" in result.output
    assert ingest_env.picker.calls == 1
    assert len(_batches()) == 1


def test_command_batch_keeps_estimate_and_rejudge_is_checked_with_all_rows(ingest_env):
    """Given 공장 3행을 읽어 둔 DB / When 다시 판단(--rejudge)으로 찾는다
    / Then 회차에 3행 전체 판단 몫의 예상 금액이 남는다. 남은 금액이 1행 몫뿐이면
    다시 판단은 거부되고, 판단이 끝난 지역의 보통 찾기(예상 0)는 그대로 된다."""
    from geosan.config.models import AppSetting

    with session_scope() as session:
        row = session.get(AppSetting, "homepageDiscovery")
        row.value = row.value | {"autoResearch": False}
        prices = session.get(AppSetting, "ingestion").value["costEstimate"]
    assert invoke("--region", "충남", "--max", "1").exit_code == 0
    again = invoke("--region", "충남", "--max", "1", "--rejudge")
    assert again.exit_code == 0, again.output
    assert _batches()[-1].estimated_usd == pytest.approx(3 * prices["judgeUsdPerRow"])
    assert ingest_env.picker.calls == 2
    _llm(monthlyCostLimitUsd=_used() + prices["judgeUsdPerRow"])
    blocked = invoke("--region", "충남", "--max", "1", "--rejudge")
    assert blocked.exit_code == 1 and "이번 달 남은 AI 금액을 넘습니다" in blocked.output
    assert ingest_env.picker.calls == 2 and len(_batches()) == 2
    plain = invoke("--region", "충남", "--max", "1")
    assert plain.exit_code == 0, plain.output
