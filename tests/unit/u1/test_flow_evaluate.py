"""실제 엔진을 연결해 평가 흐름 실패 취소·입력 부족·기준일·질문 중복 방지를 검사한다."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, func, select

from geosan.capability.importer import import_capability
from geosan.evaluation.models import EvaluationBatch, EvaluationRun, ItemJudgmentInput
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import OppProcessLink
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink
from geosan.rules.engine import evaluate
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate as flow
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def imported(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    return import_case(_write(tmp_path, "case.json", factories.apjeong_case())).opp_id


def _assert_failed_without_rows():
    with session_scope() as session:
        batches = list(session.scalars(select(EvaluationBatch)))
        assert len(batches) == 1 and batches[0].status == "FAILED"
        assert session.scalar(select(func.count()).select_from(EvaluationRun)) == 0
        assert session.scalar(select(func.count()).select_from(ConfirmationQuestion)) == 0
        assert all(row.source_eval_id is None for row in session.scalars(select(OppProcessLink)))


def test_question_save_failure_rolls_back_entire_flow(imported, monkeypatch):
    """Given 평가 저장 뒤 질문 저장 실패 / When 실행 / Then 묶음만 FAILED로 남는다."""
    real_upsert = flow.upsert_question

    def fail_after_question(*args, **kwargs):
        real_upsert(*args, **kwargs)
        raise RuntimeError("가상 저장 실패")

    monkeypatch.setattr(flow, "upsert_question", fail_after_question)
    result = flow.run_evaluation([imported])
    assert not result.ok and result.error.status == 500
    _assert_failed_without_rows()


def test_invalid_totals_fail_whole_batch(imported, monkeypatch):
    """Given E보다 작은 R / When 엔진 반환값 검사 / Then 저장하지 않고 전체 실패한다."""

    def invalid(source):
        output = evaluate(source)
        output.totals.R = output.totals.E - 1
        return output

    monkeypatch.setattr(flow, "evaluate", invalid)
    result = flow.run_evaluation([imported])
    assert not result.ok and result.error.kind == "RULE_CONFIG"
    assert imported in result.error.message
    _assert_failed_without_rows()


def test_base_date_priority_uses_seoul_date(monkeypatch):
    """Given 인자·사례일·서울 오늘 / When 기준일 선택 / Then 정해진 우선순위를 지킨다."""
    today = date(2026, 10, 21)
    case_day = date(2026, 10, 20)
    explicit = date(2026, 10, 19)
    monkeypatch.setattr(flow, "today_in_seoul", lambda: today)
    one = [SimpleNamespace(base_date=case_day)]
    assert flow.resolve_base_date(explicit, one) == explicit
    assert flow.resolve_base_date(None, one) == case_day
    assert flow.resolve_base_date(None, one + one) == today
    assert flow.resolve_base_date(None, [SimpleNamespace(base_date=None)]) == today


def test_missing_item_skips_only_that_opportunity(imported, tmp_path):
    """Given 입력이 한 행 부족한 기회와 정상 기회 / When 전체 평가 / Then 정상 건은 저장한다."""
    second = import_case(
        _write(tmp_path, "second.json", factories.apjeong_renamed_customer("second"))
    )
    with session_scope() as session:
        session.execute(
            delete(ItemJudgmentInput).where(
                ItemJudgmentInput.opp_id == imported, ItemJudgmentInput.item_code == "NEW_PRODUCT"
            )
        )
    result = flow.run_evaluation()
    assert result.ok and result.affected_opp_ids == [second.opp_id]
    assert f"{imported}: 항목 입력 없음" in result.summary


def test_question_is_upserted_and_source_evaluation_advances(imported):
    """Given 같은 요구의 질문 / When 재평가 / Then 질문은 한 건이고 최신 평가를 가리킨다."""
    assert flow.run_evaluation([imported]).ok
    latest = flow.run_evaluation([imported])
    assert latest.ok and "가짜 엔진" not in latest.summary
    with session_scope() as session:
        questions = list(session.scalars(select(ConfirmationQuestion)))
        assert len(questions) == 1 and questions[0].source_eval_id == latest.new_eval_ids[0]
        assert session.scalar(select(func.count()).select_from(QuestionOpportunityLink)) == 1


def test_engine_execution_error_is_not_replaced_with_fake_success(imported, monkeypatch):
    """Given 실제 엔진 호출이 실패 / When 실행 / Then 가짜 성공 없이 실패와 묶음을 남긴다."""

    def failing_engine(source):
        raise RuntimeError("가상 엔진 실행 실패")

    monkeypatch.setattr(flow, "evaluate", failing_engine)
    result = flow.run_evaluation([imported])
    assert not result.ok and result.new_eval_ids == []
    _assert_failed_without_rows()
