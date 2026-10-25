"""설계의 흐름 등록표를 통해 실제 평가·저장과 실패 취소가 이어지는지 검사한다."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from geosan.capability.importer import import_capability
from geosan.evaluation.models import EvaluationBatch, EvaluationRun, ItemJudgment
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate
from geosan.workflows.registry import FLOWS
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def registered_opportunities(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    first = import_case(_write(tmp_path, "first.json", factories.apjeong_case()))
    second = import_case(
        _write(tmp_path, "second.json", factories.apjeong_renamed_customer("second"))
    )
    return first.opp_id, second.opp_id


@pytest.mark.parametrize("scope", ["FULL", "PARTIAL"])
def test_registered_evaluation_saves_requested_scope(registered_opportunities, base_date, scope):
    """Given 등록된 평가와 가상 기회 둘 / When 이름으로 실행 / Then 대상·기준일대로 저장한다."""
    first, second = registered_opportunities
    opp_ids = None if scope == "FULL" else [first]
    expected_ids = {first, second} if scope == "FULL" else {first}

    result = FLOWS["evaluate"](opp_ids=opp_ids, base_date=base_date, requested_by="registry-test")

    assert result.ok, result.summary
    assert set(result.affected_opp_ids) == expected_ids
    with session_scope() as session:
        runs = list(session.scalars(select(EvaluationRun)))
        assert {run.opp_id for run in runs} == expected_ids
        assert {run.eval_id for run in runs} == set(result.new_eval_ids)
        assert all(run.run_status == "CONFIRMED" for run in runs)
        batch = session.scalars(select(EvaluationBatch)).one()
        assert batch.status == "CONFIRMED" and batch.scope == scope
        assert batch.base_date == base_date and batch.created_by == "registry-test"
        assert all(run.batch_id == batch.batch_id for run in runs)
        expected_items = len(factories.apjeong_case()["itemInputs"]) * len(expected_ids)
        assert session.scalar(select(func.count()).select_from(ItemJudgment)) == expected_items


def test_registered_evaluation_failure_preserves_previous_result(
    registered_opportunities, base_date, monkeypatch
):
    """Given 확정 평가 / When 등록표 경유 재평가 저장 실패 / Then 기존 값과 실패 사유를 보존한다."""
    first, _second = registered_opportunities
    baseline = FLOWS["evaluate"](opp_ids=[first], base_date=base_date)
    assert baseline.ok, baseline.summary
    with session_scope() as session:
        item_ids = set(session.scalars(select(ItemJudgment.judgment_id)))
        original_batch_id = session.get(EvaluationRun, baseline.new_eval_ids[0]).batch_id
    real_save = flow_evaluate.save_evaluation
    saved_calls = []

    def fail_after_save(*args, **kwargs):
        real_save(*args, **kwargs)
        saved_calls.append(True)
        raise RuntimeError("등록표 경유 저장 실패 검사")

    monkeypatch.setattr(flow_evaluate, "save_evaluation", fail_after_save)
    result = FLOWS["evaluate"](opp_ids=[first], base_date=base_date)

    assert saved_calls == [True]
    assert not result.ok and result.error is not None and result.error.status == 500
    assert result.new_eval_ids == [] and result.affected_opp_ids == []
    with session_scope() as session:
        runs = list(session.scalars(select(EvaluationRun)))
        assert len(runs) == 1 and runs[0].eval_id == baseline.new_eval_ids[0]
        assert runs[0].run_status == "CONFIRMED"
        assert set(session.scalars(select(ItemJudgment.judgment_id))) == item_ids
        batches = list(session.scalars(select(EvaluationBatch)))
        assert len(batches) == 2
        assert session.get(EvaluationBatch, original_batch_id).status == "CONFIRMED"
        failed = next(batch for batch in batches if batch.batch_id != original_batch_id)
        assert failed.status == "FAILED" and failed.scope == "PARTIAL"
