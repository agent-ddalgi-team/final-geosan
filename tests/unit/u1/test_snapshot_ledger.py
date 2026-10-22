"""S04·평가 기록 보존: 실제 저장소와 규칙 엔진의 연결을 검사한다."""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from geosan.capability.importer import import_capability
from geosan.config.registry import load_runtime_config, set_active_dataset_kind
from geosan.evaluation.inputs import current_readiness_check
from geosan.evaluation.ledger import latest_confirmed_evaluation, latest_full_batch
from geosan.evaluation.models import EvaluationRun, ItemJudgment, JudgmentEvidence
from geosan.evaluation.snapshot import build_snapshot, canonical_hash, freeze_snapshot
from geosan.evidence.models import Evidence
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import OppProcessLink, Signal
from geosan.rules.codes import CheckResult
from geosan.rules.engine import evaluate
from geosan.rules.models import EvaluationInput
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories


def _write(directory, name, data):
    path = directory / name
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def _clean(value):
    if isinstance(value, dict):
        return {key: _clean(item) for key, item in value.items() if not key.startswith("_")}
    if isinstance(value, list):
        return [_clean(item) for item in value]
    return value


def source_input():
    return EvaluationInput.model_validate(_clean(factories.load_data_json("apjeong-input.json")))


@pytest.fixture
def imported(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    result = import_case(_write(tmp_path, "case.json", factories.apjeong_case()))
    return result.opp_id


def _snapshot(session, opp_id):
    runtime = load_runtime_config(session)
    return build_snapshot(
        session,
        opp_id,
        base_date=date(2026, 10, 20),
        dataset_kind=runtime.app_settings.active_dataset_kind.value,
        rule_config=runtime.rule_config,
    )


def test_snapshot_hash_is_stable_and_keeps_a_separate_document():
    """Given 같은 입력 / When 키 순서를 바꾸고 모델을 수정 / Then 해시는 같고 기록은 보존된다."""
    source = source_input()
    first = freeze_snapshot(source, "version")
    assert canonical_hash(dict(reversed(list(first.document.items())))) == first.snapshot_hash
    source.opportunity.customer_id = "changed"
    assert first.document["opportunity"]["customerId"] != "changed"
    assert first.snapshot_hash == canonical_hash(first.document)


def test_snapshot_uses_only_active_dataset(imported, tmp_path):
    """Given 가상 검수·소개서 묶음 / When 소개서로 전환 / Then 소개서 값만 대조한다."""
    import_capability(_write(tmp_path, "brochure.json", factories.brochure_capability_file()))
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE")
        snapshot = _snapshot(session, imported)
        source = snapshot.evaluation_input
        assert source.dataset_kind == "BROCHURE"
        assert all(row.dataset_kind == "BROCHURE" for row in source.capability.processes)
        assert not source.operational_ready
        assert source.process_links[0].process_id in {
            row.process_id for row in source.capability.processes
        }
        assert snapshot.snapshot_hash == _snapshot(session, imported).snapshot_hash


def test_database_snapshot_matches_apjeong_scores_with_real_engine(imported):
    """Given 실제 DB의 A정밀 / When 스냅샷을 엔진에 전달 / Then 약속한 점수가 계산된다."""
    with session_scope() as session:
        output = evaluate(_snapshot(session, imported).evaluation_input)
    assert (
        output.totals.E,
        output.totals.P,
        output.totals.S,
        output.totals.R,
        output.totals.C,
    ) == (
        77,
        95,
        81.1,
        82,
        87.5,
    )
    assert output.classification_code == "CONTACT_URGENT"


@pytest.mark.parametrize(
    ("required_now", "expected_class"),
    [(True, "FILTER_PENDING"), (False, "OPS_PENDING")],
)
def test_brochure_evaluation_keeps_approval_blocked(tmp_db, tmp_path, required_now, expected_class):
    """Given 소개서 묶음 / When 실제 평가·저장 / Then 필수 요구에 맞는 보류와 승인 차단이다."""
    import_capability(_write(tmp_path, "brochure.json", factories.brochure_capability_file()))
    with session_scope() as session:
        load_runtime_config(session)
        set_active_dataset_kind(session, "BROCHURE")
    imported = import_case(
        _write(
            tmp_path,
            "brochure-case.json",
            factories.brochure_case("brochure-review", with_required_now=required_now),
        )
    )
    result = run_evaluation([imported.opp_id])
    assert result.ok
    with session_scope() as session:
        run = session.get(EvaluationRun, result.new_eval_ids[0])
        assert run.classification_code == expected_class
        assert run.blocks_approval
        assert not run.operational_ready
        assert run.score_display.startswith("참고 ")


def test_forbidden_source_is_redacted_before_engine_and_record(imported):
    """Given 사용이 금지된 자료 / When 스냅샷 생성 / Then 엔진에서 빼고 ID·사유만 보관한다."""
    with session_scope() as session:
        row = session.scalar(select(Evidence).where(Evidence.opp_id == imported))
        row.security_grade = "FORBIDDEN"
        row.quote = "차단 원문 시험 표식(가상)"
        session.flush()
        snapshot = _snapshot(session, imported)
        assert row.evidence_id not in {
            item.evidence_id for item in snapshot.evaluation_input.evidence
        }
        assert all(
            row.evidence_id not in item.evidence_ids
            for item in snapshot.evaluation_input.item_inputs
        )
        assert not snapshot.evaluation_input.operational_ready
        assert "차단 원문 시험 표식" not in json.dumps(snapshot.document, ensure_ascii=False)
        blocked = next(
            item for item in snapshot.document["evidence"] if item["evidenceId"] == row.evidence_id
        )
        assert set(blocked) == {"evidenceId", "blocked", "blockedReason"}


def test_reevaluation_preserves_previous_results(imported):
    """Given 확정 평가 / When 재평가 / Then 새 행을 만들고 이전 점수와 판정을 보존한다."""
    first = run_evaluation([imported])
    second = run_evaluation([imported])
    assert first.ok and second.ok
    with session_scope() as session:
        old = session.get(EvaluationRun, first.new_eval_ids[0])
        current = session.get(EvaluationRun, second.new_eval_ids[0])
        assert old.run_status == "SUPERSEDED" and old.score_e == 77
        assert current.run_status == "CONFIRMED" and current.previous_eval_id == old.eval_id
        assert session.scalar(select(func.count()).select_from(ItemJudgment)) == 16


def test_partial_evaluation_does_not_replace_full_batch(imported):
    """Given 전체 평가 / When 한 건만 재평가 / Then 목록 묶음과 최신 개별 평가를 구분한다."""
    full = run_evaluation()
    partial = run_evaluation([imported])
    assert full.ok and partial.ok
    with session_scope() as session:
        batch = latest_full_batch(session, dataset_kind="VIRTUAL_REVIEWED")
        assert session.get(EvaluationRun, full.new_eval_ids[0]).batch_id == batch.batch_id
        assert latest_confirmed_evaluation(session, imported).eval_id == partial.new_eval_ids[0]


def test_first_evaluation_fills_readiness_reference(imported, monkeypatch):
    """Given 파일 체크 / When 평가·필수 요구 판정 변경 / Then 첫 ID 보관 후 변경 시 초기화한다."""
    result = run_evaluation([imported])
    assert result.ok
    with session_scope() as session:
        check = current_readiness_check(session, imported)
        assert check.eval_id_at_check == result.new_eval_ids[0]
        old = check.eval_id_at_check
    assert run_evaluation([imported]).ok
    with session_scope() as session:
        assert current_readiness_check(session, imported).eval_id_at_check == old

    from geosan.workflows import flow_evaluate

    def changed_required_result(source):
        output = evaluate(source)
        iso_id = next(row.req_id for row in source.requirements if row.name == "ISO 9001")
        for result in output.requirement_checks:
            if result.req_id == iso_id:
                result.result = CheckResult.UNKNOWN
        return output

    monkeypatch.setattr(
        flow_evaluate,
        "evaluate",
        changed_required_result,
    )
    changed = run_evaluation([imported])
    assert changed.ok
    with session_scope() as session:
        assert current_readiness_check(session, imported) is None
        assert not session.get(EvaluationRun, changed.new_eval_ids[0]).timing_requirements[
            "readiness"
        ]


def test_deadline_change_resets_check_before_final_calculation(imported):
    """Given 체크를 쓴 평가 / When 직접 행동 신호 마감 변경 / Then 체크 없이 다시 계산한다."""
    first = run_evaluation([imported])
    assert first.ok
    with session_scope() as session:
        signal = session.scalar(
            select(Signal).where(Signal.opp_id == imported, Signal.signal_kind == "BID")
        )
        signal.deadline_at += timedelta(days=1)
    result = run_evaluation([imported])
    assert result.ok
    with session_scope() as session:
        assert current_readiness_check(session, imported) is None
        run = session.get(EvaluationRun, result.new_eval_ids[0])
        assert not run.timing_requirements["readiness"]
        assert run.input_snapshot["readinessCheck"] is None
        assert session.get(EvaluationRun, first.new_eval_ids[0]).timing_requirements["readiness"]


def test_evaluation_saves_evidence_and_derived_process_result(imported):
    """Given 투입된 기회 / When 평가 저장 / Then 판정 근거와 공정 현재 결과가 함께 연결된다."""
    result = run_evaluation([imported])
    assert result.ok
    with session_scope() as session:
        link = session.scalar(select(OppProcessLink).where(OppProcessLink.opp_id == imported))
        assert link.current_result == "PASS" and link.source_eval_id == result.new_eval_ids[0]
        assert session.scalar(select(func.count()).select_from(JudgmentEvidence)) > 0
