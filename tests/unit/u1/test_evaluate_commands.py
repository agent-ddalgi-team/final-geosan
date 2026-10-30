"""`evaluate`·`verify-case` 명령 단위 테스트 (Step 19 나머지, 이슈 #46).

실제 마이그레이션 임시 SQLite(tmp_db)와 진짜 규칙 엔진으로 돈다. 모든 데이터는 가상(A정밀)이다.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select
from typer.testing import CliRunner

from geosan.commands import verify_case
from geosan.commands.app import app
from geosan.evaluation.models import EvaluationBatch, EvaluationRun, ItemJudgmentInput
from geosan.storage.session import session_scope
from geosan.workflows.models import FlowResult
from tests import factories

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"


def _run(*args: str) -> tuple[int, str]:
    result = CliRunner().invoke(app, list(args), catch_exceptions=False)
    return result.exit_code, result.output


def _write(tmp_path: Path, name: str, data: Any) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _import_apjeong(tmp_path: Path) -> Path:
    cap = _write(tmp_path, "cap.json", factories.capability_file())
    case = _write(tmp_path, "case.json", factories.apjeong_case())
    assert _run("import-capability", str(cap))[0] == 0
    assert _run("import-case", str(case))[0] == 0
    return case


# ---------------------------------------------------------------------------
# evaluate
# ---------------------------------------------------------------------------


def test_evaluate_prints_batch_summary_and_exit_zero(tmp_db: Path, tmp_path: Path) -> None:
    """A정밀을 투입하고 evaluate를 돌리면 묶음 ID·기회 수·분류별 건수 요약을 내고 0으로 끝난다."""
    _import_apjeong(tmp_path)
    code, output = _run("evaluate")
    assert code == 0, output
    assert "묶음 " in output and "기회 1건" in output and "지금 바로 연락 검토 1" in output
    assert "문의 시 이 번호" in output


def test_evaluate_rejects_bad_base_date_and_unknown_opportunity(
    tmp_db: Path, tmp_path: Path
) -> None:
    """기준일 형식 오류와 목록에 없는 기회 ID는 입력 오류 1로 끝나고 저장하지 않는다."""
    _import_apjeong(tmp_path)
    code, output = _run("evaluate", "--base-date", "2026/10/20")
    assert code == 1 and "YYYY-MM-DD" in output
    code, output = _run("evaluate", "--opp", "opp-없음")
    assert code == 1, output
    assert "목록에 없는 기회" in output


def test_evaluate_on_empty_db_reports_zero_opportunities(tmp_db: Path, tmp_path: Path) -> None:
    """기회가 하나도 없어도 실패가 아니라 '기회 0건'으로 끝난다."""
    cap = _write(tmp_path, "cap.json", factories.capability_file())
    assert _run("import-capability", str(cap))[0] == 0
    code, output = _run("evaluate")
    assert code == 0, output
    assert "기회 0건" in output


# ---------------------------------------------------------------------------
# verify-case
# ---------------------------------------------------------------------------


def test_verify_case_passes_for_apjeong_expected_values(tmp_db: Path, tmp_path: Path) -> None:
    """A정밀 기대값(E 77 / P 95 / S 81.1 / R 82 / C 87.5, PASS, MET, CONTACT_URGENT)과 모두 일치."""
    case = _import_apjeong(tmp_path)
    code, output = _run("verify-case", str(case))
    assert code == 0, output
    assert "검증 통과" in output
    for line in (
        "| E | 77 | 77 | 일치 |",
        "| P | 95 | 95 | 일치 |",
        "| S | 81.1 | 81.1 | 일치 |",
        "| R | 82 | 82 | 일치 |",
        "| C | 87.5 | 87.5 | 일치 |",
        "| classificationCode | CONTACT_URGENT | CONTACT_URGENT | 일치 |",
        "| 요구 'ISO 9001' | PASS | PASS | 일치 |",
        "| 요구 '품질팀 샘플 승인' | LATER_STAGE | LATER_STAGE | 일치 |",
        "| 요구 'Nadcap' | QUESTION_NEEDED | QUESTION_NEEDED | 일치 |",
    ):
        assert line in output, output
    assert "불일치" not in output


def test_verify_case_reports_mismatch_with_exit_two(tmp_db: Path, tmp_path: Path) -> None:
    """기대값을 일부러 틀리게 적으면 그 항목만 불일치로 표시하고 종료 코드 2."""
    _import_apjeong(tmp_path)
    data = factories.apjeong_case()
    data["expected"]["E"] = 70
    data["expected"]["requirementResults"]["Nadcap"] = "PASS"
    wrong = _write(tmp_path, "wrong.json", data)
    code, output = _run("verify-case", str(wrong))
    assert code == 2, output
    assert "| E | 70 | 77 | 불일치 |" in output
    assert "| 요구 'Nadcap' | PASS | QUESTION_NEEDED | 불일치 |" in output
    assert "| P | 95 | 95 | 일치 |" in output
    assert "검증 실패" in output and "2개 불일치" in output


def test_verify_case_requires_import_and_expected_block(tmp_db: Path, tmp_path: Path) -> None:
    """투입 전이면 '먼저 import-case', expected가 없으면 기대값 없음 — 둘 다 입력 오류 1."""
    case = _write(tmp_path, "case.json", factories.apjeong_case())
    code, output = _run("verify-case", str(case))
    assert code == 1 and "먼저 geosan import-case" in output

    _import_apjeong(tmp_path)
    data = factories.apjeong_case()
    data["expected"] = None
    no_expected = _write(tmp_path, "no-expected.json", data)
    code, output = _run("verify-case", str(no_expected))
    assert code == 1 and "expected 블록이 없어" in output

    code, output = _run("verify-case", str(tmp_path / "missing.json"))
    assert code == 1 and "파일을 찾을 수 없습니다" in output


def _verified_id(case: Path, *, reused: bool) -> str:
    code, output = _run("verify-case", str(case))
    assert code == 0, output
    assert "(재사용)" in output if reused else "(새로 생성)" in output
    match = re.search(r"· 평가 (eval-[\w-]+)", output)
    assert match is not None, output
    return match.group(1)


def _partial_evaluation_ids() -> set[str]:
    with session_scope() as session:
        batches = list(session.scalars(select(EvaluationBatch)))
        runs = list(session.scalars(select(EvaluationRun)))
        assert len(batches) == len(runs)
        assert all(batch.scope == "PARTIAL" and batch.status == "CONFIRMED" for batch in batches)
        return {run.eval_id for run in runs}


def test_verify_case_reuses_same_input_without_another_batch(tmp_db: Path, tmp_path: Path) -> None:
    """Given 투입한 A정밀, When 같은 파일을 두 번 검증, Then 평가·묶음은 하나만 저장한다."""
    case = _import_apjeong(tmp_path)
    first_code, first_output = _run("verify-case", str(case))
    second_code, second_output = _run("verify-case", str(case))
    assert first_code == second_code == 0, (first_output, second_output)
    first = re.search(r"· 평가 (eval-[\w-]+)", first_output).group(1)
    second = re.search(r"· 평가 (eval-[\w-]+)", second_output).group(1)
    assert second == first
    assert "(새로 생성)" in first_output and "(재사용)" in second_output
    assert [line for line in first_output.splitlines() if line.startswith("|")] == [
        line for line in second_output.splitlines() if line.startswith("|")
    ]
    assert _partial_evaluation_ids() == {first}


@pytest.mark.parametrize("change", ["base_date", "case_input", "rule_version", "rule_hash"])
def test_verify_case_creates_evaluation_after_input_changes(
    tmp_db: Path, tmp_path: Path, change: str
) -> None:
    """Given 저장된 검증, When 날짜·입력·규칙 중 하나가 변경, Then 새 평가 후에만 재사용한다."""
    case = _import_apjeong(tmp_path)
    first = _verified_id(case, reused=False)
    if change in {"base_date", "case_input"}:
        data = factories.apjeong_case()
        if change == "base_date":
            data["baseDate"] = "2026-10-21"
        else:
            data["itemInputs"][0]["factJudged"] = "공정 대응 근거를 다시 확인함 (가상)"
        case = _write(tmp_path, "changed.json", data)
        if change == "case_input":
            code, output = _run("import-case", str(case))
            assert code == 0, output
    else:
        rule_text = (EXAMPLES / "rule-config.yaml").read_text(encoding="utf-8")
        if change == "rule_version":
            rule_text = re.sub(r"(?m)^version:.*$", "version: test-reuse-version", rule_text)
        else:
            rule_text += "\n# 가상 검사: 규칙 수치는 유지하고 파일 해시만 바꿈\n"
        rule_path = tmp_path / "rule-config.yaml"
        rule_path.write_text(rule_text, encoding="utf-8")
        code, output = _run(
            "check-config", str(rule_path), str(EXAMPLES / "app-settings-virtual.yaml")
        )
        assert code == 0, output
    changed = _verified_id(case, reused=False)
    assert changed != first
    assert _verified_id(case, reused=True) == changed
    assert _partial_evaluation_ids() == {first, changed}


def test_verify_case_still_checks_expected_values_when_reusing(
    tmp_db: Path, tmp_path: Path
) -> None:
    """Given 이전 검증, When 기대값만 다른 파일을 검증, Then 저장을 늘리지 않고 불일치를 알린다."""
    case = _import_apjeong(tmp_path)
    first = _verified_id(case, reused=False)
    data = factories.apjeong_case()
    data["expected"]["E"] = 70
    wrong = _write(tmp_path, "wrong-expected.json", data)
    code, output = _run("verify-case", str(wrong))
    assert code == 2, output
    assert f"평가 {first} (재사용)" in output
    assert "| E | 70 | 77 | 불일치 |" in output
    assert _partial_evaluation_ids() == {first}


def test_verify_case_keeps_full_batch_and_latest_evaluation_unchanged_when_reusing(
    tmp_db: Path, tmp_path: Path
) -> None:
    """Given 전체 평가 사이에 저장한 부분 검증, When 재검증, Then 전체 묶음·최신 평가를 유지한다."""
    case = _import_apjeong(tmp_path)
    assert _run("evaluate", "--base-date", "2026-10-20")[0] == 0
    partial_id = _verified_id(case, reused=False)
    assert _run("evaluate", "--base-date", "2026-10-20")[0] == 0
    with session_scope() as session:
        before = {run.eval_id: run.run_status for run in session.scalars(select(EvaluationRun))}
        full_ids = set(
            session.scalars(select(EvaluationBatch.batch_id).where(EvaluationBatch.scope == "FULL"))
        )
    assert before[partial_id] == "SUPERSEDED"
    assert _verified_id(case, reused=True) == partial_id
    with session_scope() as session:
        assert {
            run.eval_id: run.run_status for run in session.scalars(select(EvaluationRun))
        } == before
        assert (
            set(
                session.scalars(
                    select(EvaluationBatch.batch_id).where(EvaluationBatch.scope == "FULL")
                )
            )
            == full_ids
        )
        assert len(list(session.scalars(select(EvaluationBatch)))) == 3


def test_verify_case_does_not_use_old_result_when_current_input_is_missing(
    tmp_db: Path, tmp_path: Path
) -> None:
    """Given 이전 정상 검증, When 현재 항목 입력이 사라짐, Then 예전 평가로 통과시키지 않는다."""
    case = _import_apjeong(tmp_path)
    first = _verified_id(case, reused=False)
    with session_scope() as session:
        session.execute(delete(ItemJudgmentInput))
    code, output = _run("verify-case", str(case))
    assert code == 1, output
    assert "항목 입력" in output
    assert "검증 통과" not in output
    assert _partial_evaluation_ids() == {first}


def test_verify_case_reports_lookup_failure_without_falling_back_to_old_result(
    tmp_db: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Given 이전 검증, When 재사용 조회가 실패, Then 예전 평가로 성공 처리하지 않는다."""
    case = _import_apjeong(tmp_path)
    first = _verified_id(case, reused=False)

    def fail_lookup(*args, **kwargs):
        raise RuntimeError("가상 DB 조회 실패")

    monkeypatch.setattr(verify_case, "reusable_partial_evaluation", fail_lookup)
    code, output = _run("verify-case", str(case))
    assert code == 2, output
    assert "조회하거나 저장하지 못했습니다" in output
    assert "검증 통과" not in output and "가상 DB 조회 실패" not in output
    assert _partial_evaluation_ids() == {first}


def test_verify_case_does_not_compare_old_result_when_flow_skips_target(
    tmp_db: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Given 이전 검증, When 새 평가 흐름이 대상을 건너뜀, Then 예전 평가로 비교하지 않는다."""
    case = _import_apjeong(tmp_path)
    first = _verified_id(case, reused=False)
    monkeypatch.setattr(verify_case, "reusable_partial_evaluation", lambda *args: None)
    monkeypatch.setattr(verify_case, "run_evaluation", lambda **kwargs: FlowResult(ok=True))
    code, output = _run("verify-case", str(case))
    assert code == 2, output
    assert "새 평가를 찾지 못했습니다" in output
    assert "검증 통과" not in output
    assert _partial_evaluation_ids() == {first}
