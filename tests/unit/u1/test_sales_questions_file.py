"""#607: 꼬리 질문 파일(C7 sales-questions.yaml) 검사와 세부 단계 계산."""

from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from typer.testing import CliRunner

from geosan.api.sales_step import AnswerRow, RecordRow, compute_sales_step, stage_for
from geosan.commands.app import app
from geosan.config.sales_questions import check_sales_questions_file

EXAMPLE = Path("examples/sales-questions.yaml")
STEPS = """steps:
  - { code: NOT_REACHED, label: 연결 전, stage: IN_PROGRESS }
  - { code: REACHED, label: 연결됨, stage: IN_PROGRESS }
  - { code: DEMAND_CONFIRMED, label: 수요 확인, stage: IN_PROGRESS }
  - { code: MATERIAL_QUOTE, label: 자료·견적, stage: SAMPLE_OR_REGISTRATION_APPROVED }
  - { code: VISIT_SAMPLE, label: 방문·샘플, stage: SAMPLE_OR_REGISTRATION_APPROVED }
"""
QUESTION = """  - id: PLATING_NOW
    step: REACHED
    text: 지금 도금은?
    answers:
      - { id: IN_HOUSE, label: 직접 함 }
      - { id: OUTSOURCED, label: 외주 줌, reaches: DEMAND_CONFIRMED }
"""


def write(tmp_path, text):
    path = tmp_path / "sales-questions.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def test_example_file_passes():
    result = check_sales_questions_file(EXAMPLE)
    assert result.errors == []
    assert result.questions is not None and len(result.questions.questions) >= 10


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "version: 1\n"
            + STEPS.replace("  - { code: VISIT_SAMPLE", "  # ")
            + "questions:\n"
            + QUESTION,
            "다섯 개",
        ),
        (
            "version: 1\n"
            + STEPS.replace(
                "REACHED, label: 연결됨, stage: IN_PROGRESS", "REACHED, label: 연결됨, stage: WON"
            )
            + "questions:\n"
            + QUESTION,
            "stage는",
        ),
        ("version: 1\n" + STEPS + "questions:\n" + QUESTION + QUESTION, "두 번"),
        (
            "version: 1\n"
            + STEPS
            + "questions:\n"
            + QUESTION
            + "    showWhen: { answers: { NOPE: [YES] } }\n",
            "없는 질문",
        ),
        (
            "version: 1\n"
            + STEPS
            + "questions:\n"
            + QUESTION.replace("label: 직접 함", "label: 010-1234-5678"),
            "연락처",
        ),
        ("version: 1\n" + STEPS + "questions:\n" + QUESTION + "    color: red\n", "color"),
    ],
)
def test_broken_files_are_rejected(tmp_path, text, expected):
    result = check_sales_questions_file(write(tmp_path, text))
    assert result.questions is None
    assert any(expected in f"{error.path} {error.message}" for error in result.errors), result


def test_check_config_also_checks_the_question_file(tmp_path, monkeypatch):
    settings = Path("examples/app-settings.yaml").read_text(encoding="utf-8")
    broken = write(tmp_path, "version: 1\n" + STEPS + "questions: []\n")
    settings_path = tmp_path / "app-settings.yaml"
    settings_path.write_text(
        settings + f"\nrecords:\n  salesQuestionsFile: {broken}\n", encoding="utf-8"
    )
    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "none.db"))
    result = CliRunner().invoke(
        app, ["check-config", "examples/rule-config.yaml", str(settings_path)]
    )
    assert result.exit_code == 1, result.output
    assert "sales-questions.yaml" in result.output


def row(outcome_id, method="CALL", day=20, override=None):
    return RecordRow(
        outcome_id=outcome_id,
        method=method,
        attempted_at=date(2026, 10, day) if method else None,
        created_at=datetime(2026, 10, day, tzinfo=UTC),
        created_by="kim",
        step_override=override,
    )


def test_removed_options_show_as_old_answers():
    questions = check_sales_questions_file(EXAMPLE).questions
    state = compute_sales_step(
        [row("o1")],
        [AnswerRow("o1", "GONE", "X"), AnswerRow("o1", "INTEREST", "GONE")],
        questions,
        "IN_PROGRESS",
    )
    assert [(item.question, item.answer) for item in state.known] == [
        ("관심 정도는?", "예전 보기"),
        ("예전 질문", "예전 보기"),
    ]


def test_override_without_contact_has_no_step():
    questions = check_sales_questions_file(EXAMPLE).questions
    state = compute_sales_step([row("o1", method=None, override="REACHED")], [], questions, None)
    assert state.code is None


@pytest.mark.parametrize(
    ("status", "method", "step", "expected"),
    [
        ("NOT_EXECUTED", "CALL", "NOT_REACHED", "IN_PROGRESS"),
        ("NOT_EXECUTED", None, None, "NOT_EXECUTED"),
        ("IN_PROGRESS", "CALL", "VISIT_SAMPLE", "SAMPLE_OR_REGISTRATION_APPROVED"),
        ("SAMPLE_OR_REGISTRATION_APPROVED", "CALL", "REACHED", "SAMPLE_OR_REGISTRATION_APPROVED"),
        ("ON_HOLD", "CALL", "VISIT_SAMPLE", "ON_HOLD"),
        ("WON", "CALL", "VISIT_SAMPLE", "WON"),
        ("LOST", "CALL", "MATERIAL_QUOTE", "LOST"),
    ],
)
def test_big_stage_only_moves_forward(status, method, step, expected):
    assert stage_for(status, method, step) == expected
