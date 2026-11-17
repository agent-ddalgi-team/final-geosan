"""조사 질문 목록(researchReadiness.questionSet)의 문장이 엔진 입력까지 그대로 전달되는지 검사한다.

#139 카드 '다음 할 일'이 이 문장(첫 항목)을 쓴다. 파일 경로(demo-report)와 DB 경로(build_snapshot)
둘 다 검사한다. 모든 데이터는 가상이다.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from geosan.capability.importer import import_capability
from geosan.config.registry import load_runtime_config
from geosan.evaluation.file_input import load_file_inputs
from geosan.evaluation.snapshot import build_snapshot
from geosan.opportunity.importer import import_case
from geosan.rules.models import ResearchReadinessInput
from geosan.storage.session import session_scope
from tests import factories

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
CAPABILITY = EXAMPLES / "capability-geosan.json"
QUESTIONS = ["Nadcap 인증 범위가 어디까지인지 확인", "샘플 승인 일정이 있는지 확인"]


def _write(directory: Path, name: str, data) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _case_with_questions():
    data = factories.apjeong_case()
    data["researchReadiness"] = {"questionSet": list(QUESTIONS)}
    return data


def test_file_path_passes_question_sentences(tmp_path: Path) -> None:
    """Given 질문 목록이 있는 사례 파일 / When 파일 경로로 변환 / Then 문장이 순서대로 전달된다."""
    cases = tmp_path / "cases"
    _write(cases, "case.json", _case_with_questions())
    inputs = load_file_inputs(CAPABILITY, cases, base_date=date(2026, 10, 27))
    research = inputs.cases[0].evaluation_input.research_readiness
    assert research is not None
    assert research.question_set == QUESTIONS
    assert research.has_question_set is True


def test_db_path_passes_question_sentences(tmp_db, tmp_path: Path) -> None:
    """Given 질문 목록이 있는 사례 투입 / When DB 스냅샷 생성 / Then 문장이 그대로 들어 있다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_id = import_case(_write(tmp_path, "case.json", _case_with_questions())).opp_id
    with session_scope() as session:
        runtime = load_runtime_config(session)
        snapshot = build_snapshot(
            session,
            opp_id,
            base_date=date(2026, 10, 27),
            dataset_kind=runtime.app_settings.active_dataset_kind.value,
            rule_config=runtime.rule_config,
        )
    research = snapshot.evaluation_input.research_readiness
    assert research is not None
    assert research.question_set == QUESTIONS


def test_question_set_defaults_to_empty_list() -> None:
    """Given 질문 목록 없이 만든 입력 / Then 빈 목록이라 기존 호출이 그대로 동작한다."""
    research = ResearchReadinessInput(
        has_graded_evidence=True,
        has_question_set=False,
        has_channel_and_owner=False,
        question_can_change_class=False,
    )
    assert research.question_set == []
