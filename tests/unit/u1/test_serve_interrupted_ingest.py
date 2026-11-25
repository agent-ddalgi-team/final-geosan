"""#866: 서버가 다시 켜질 때 남은 '진행 중' 후보 찾기를 '중단됨(실패)'으로 정리한다.

실제 uvicorn은 띄우지 않는다. 가상 회차만 쓴다.
"""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from geosan.api.ingest_batches import INTERRUPTED_REASON
from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope


def _batch(batch_id: str, status: str, reason: str | None = None) -> None:
    with session_scope() as session:
        session.add(
            IngestBatch(
                batch_id=batch_id,
                source_id="kicox-factory-csv",
                requested_by="park-lee",
                started_at=utcnow(),
                finished_at=None if status == "RUNNING" else utcnow(),
                status=status,
                failure_reason=reason,
                criteria={"regions": ["충남"], "processCodes": ["ZINC_PLATING"], "industries": []},
                new_count=2,
                is_virtual=True,
                dataset_kind="VIRTUAL_REVIEWED",
            )
        )


def _saved(batch_id: str) -> IngestBatch:
    with session_scope() as session:
        batch = session.get(IngestBatch, batch_id)
        session.expunge(batch)
        return batch


def test_serve_closes_running_batch_left_by_previous_server(tmp_db: Path, monkeypatch) -> None:
    """Given 지난 서버가 꺼질 때 돌던 회차 / When serve / Then 그 회차는 실패(이유 한 줄)이고
    이미 들어온 회사 수는 그대로, 끝난 회차는 건드리지 않는다."""
    _batch("batch-stuck", "RUNNING")
    _batch("batch-done", "DONE")
    _batch("batch-failed", "FAILED", "AI 후보 판단을 마치지 못했습니다.")
    started: list[str] = []

    def run_server(port, host):
        started.append(_saved("batch-stuck").status)

    monkeypatch.setattr(serve_module, "_run_server", run_server)
    result = CliRunner().invoke(app, ["serve", "--port", "18766"], catch_exceptions=False)
    assert result.exit_code == 0, result.output
    assert "후보 찾기 1건을 '중단됨'으로 정리했습니다" in result.output
    # 서버가 요청을 받기 전에 이미 정리돼 있어 [새 후보 찾기]가 잠기지 않는다.
    assert started == ["FAILED"]
    stuck = _saved("batch-stuck")
    assert (stuck.failure_reason, stuck.new_count) == (INTERRUPTED_REASON, 2)
    assert stuck.finished_at is not None
    assert _saved("batch-done").status == "DONE"
    assert _saved("batch-failed").failure_reason == "AI 후보 판단을 마치지 못했습니다."


def test_serve_says_nothing_when_no_batch_was_running(tmp_db: Path, monkeypatch) -> None:
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: None)
    result = CliRunner().invoke(app, ["serve", "--port", "18767"], catch_exceptions=False)
    assert result.exit_code == 0 and "중단됨" not in result.output


def test_new_search_can_start_after_cleanup(tmp_db: Path) -> None:
    """정리한 뒤에는 '지금 가져오는 중' 검사(진행 중 회차 있음)에 걸리지 않는다."""
    from sqlalchemy import select

    from geosan.api.ingest_batches import fail_interrupted_batches

    _batch("batch-stuck", "RUNNING")
    with session_scope() as session:
        assert fail_interrupted_batches(session) == 1
    with session_scope() as session:
        running = session.scalar(select(IngestBatch).where(IngestBatch.status == "RUNNING"))
        assert running is None
        assert fail_interrupted_batches(session) == 0
