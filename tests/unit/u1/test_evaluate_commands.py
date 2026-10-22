"""`evaluate`·`verify-case` 명령 단위 테스트 (Step 19 나머지, 이슈 #46).

실제 마이그레이션 임시 SQLite(tmp_db)와 진짜 규칙 엔진으로 돈다. 모든 데이터는 가상(A정밀)이다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from typer.testing import CliRunner

from geosan.commands.app import app
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
