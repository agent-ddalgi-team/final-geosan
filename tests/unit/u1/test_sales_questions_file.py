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


# --- #643: 마무리 답 칸 closes·lostReason 검사 ------------------------------------------

NEXT = """  - id: NEXT_ACTION
    step: ALL
    text: 다음 할 일은?
    answers:
      - { id: RECONTACT, label: 다시 연락 }
      - { id: END, label: 끝 }
"""
CLOSE = """  - id: CLOSE_RESULT
    step: ALL
    text: 어떻게 끝났나요?
    showWhen: { answers: { NEXT_ACTION: [END] } }
    answers:
      - { id: WON, label: 성사, closes: WON }
      - { id: LOST, label: 거절, closes: LOST }
      - { id: ON_HOLD, label: 보류, closes: ON_HOLD }
"""
REASON = """  - id: LOST_REASON
    step: ALL
    text: 거절 이유는?
    showWhen: { answers: { CLOSE_RESULT: [LOST] } }
    answers:
      - { id: PRICE, label: 가격, lostReason: PRICE }
      - { id: OTHER, label: 기타, lostReason: OTHER }
"""
HEAD = "version: 1\n" + STEPS + "questions:\n" + NEXT


def test_closing_questions_pass(tmp_path):
    result = check_sales_questions_file(write(tmp_path, HEAD + CLOSE + REASON))
    assert result.errors == []
    example = check_sales_questions_file(EXAMPLE).questions
    assert [item.closes for item in example.question("CLOSE_RESULT").answers] == [
        "WON",
        "LOST",
        "ON_HOLD",
    ]
    assert len(example.question("LOST_REASON").answers) == 6


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (HEAD + CLOSE.replace("closes: WON", "closes: IN_PROGRESS") + REASON, "closes"),
        (HEAD + CLOSE + REASON.replace("lostReason: PRICE", "lostReason: CHEAP"), "lostReason"),
        (HEAD + CLOSE, "거절 이유를 정하는 질문"),
        (
            HEAD + CLOSE.replace("closes: LOST", "closes: ON_HOLD") + REASON,
            "closes: LOST 보기가 없습니다",
        ),
        (
            HEAD + CLOSE + REASON.replace("CLOSE_RESULT: [LOST]", "CLOSE_RESULT: [LOST, WON]"),
            "closes: LOST 보기만",
        ),
        (
            HEAD
            + CLOSE
            + REASON.replace("    showWhen: { answers: { CLOSE_RESULT: [LOST] } }\n", ""),
            "closes: LOST 보기만",
        ),
        (HEAD + CLOSE + REASON.replace(", lostReason: OTHER", ""), "모든 보기에 lostReason"),
        (
            HEAD + CLOSE + REASON.replace("lostReason: OTHER", "lostReason: PRICE"),
            "같은 lostReason",
        ),
        (
            HEAD + CLOSE.replace("closes: WON", "closes: WON, reaches: VISIT_SAMPLE") + REASON,
            "같이 쓸 수 없습니다",
        ),
        (
            HEAD
            + CLOSE
            + REASON
            + CLOSE.replace("CLOSE_RESULT", "CLOSE_AGAIN").replace("closes: LOST", "closes: WON"),
            "하나만",
        ),
    ],
)
def test_broken_closing_questions_are_rejected(tmp_path, text, expected):
    result = check_sales_questions_file(write(tmp_path, text))
    assert result.questions is None
    assert any(expected in f"{error.path} {error.message}" for error in result.errors), result


# ---------------------------------------------------------------------------
# #652: 보기를 회사 값에서 가져오는 질문(choices)
# ---------------------------------------------------------------------------

CHOICE = """  - id: CONFIRM_PROCESS
    step: REACHED
    text: 어떤 공정을 맡길 수 있나요?
    choices: PROCESS
"""


def test_choice_questions_pass(tmp_path):
    text = "version: 1\n" + STEPS + "questions:\n" + QUESTION + CHOICE
    result = check_sales_questions_file(write(tmp_path, text))
    assert result.errors == []
    question = result.questions.question("CONFIRM_PROCESS")
    assert (question.choices, question.answers) == ("PROCESS", [])


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            CHOICE
            + "    answers:\n      - { id: YES, label: 있음 }\n      - { id: NO, label: 없음 }\n",
            "answers와 choices를 같이",
        ),
        (CHOICE.replace("    choices: PROCESS\n", ""), "choices를 적어 주세요"),
        (QUESTION.replace("      - { id: IN_HOUSE, label: 직접 함 }\n", ""), "2개 이상"),
        (CHOICE.replace("PROCESS", "REGION"), "choices"),
        (CHOICE + CHOICE.replace("CONFIRM_PROCESS", "CONFIRM_AGAIN"), "하나만 둘 수 있습니다"),
        (
            CHOICE
            + QUESTION.replace("PLATING_NOW", "AFTER_CHOICE")
            + "    showWhen: { answers: { CONFIRM_PROCESS: [ZINC_PLATING] } }\n",
            "choices 질문 'CONFIRM_PROCESS'",
        ),
    ],
)
def test_broken_choice_questions_are_rejected(tmp_path, text, expected):
    """answers와 choices는 하나만, choices 질문은 종류마다 하나, 꼬리 조건으로 가리킬 수 없다."""
    result = check_sales_questions_file(
        write(tmp_path, "version: 1\n" + STEPS + "questions:\n" + text)
    )
    assert result.questions is None
    assert any(expected in f"{error.path} {error.message}" for error in result.errors), result


def test_choice_question_keeps_every_value_of_the_latest_answering_contact():
    """Given 공정을 두 번 답함 / When 계산 / Then 가장 최근 접촉에서 고른 값만 값마다 한 줄."""
    questions = check_sales_questions_file(EXAMPLE).questions
    labels = {"PROCESS": {"ZINC_PLATING": "아연도금", "CHROMATE": "크로메이트"}, "INDUSTRY": {}}
    state = compute_sales_step(
        [row("o1"), row("o2"), row("o3")],
        [
            AnswerRow("o1", "CONFIRM_PROCESS", "ANODIZING"),
            AnswerRow("o2", "CONFIRM_PROCESS", "ZINC_PLATING"),
            AnswerRow("o2", "CONFIRM_PROCESS", "CHROMATE"),
            AnswerRow("o2", "CONFIRM_INDUSTRY", "없어진 산업"),
            AnswerRow("o3", "INTEREST", "HIGH"),
        ],
        questions,
        "IN_PROGRESS",
        labels,
    )
    known = [(item.question_id, item.answer_id, item.answer) for item in state.known]
    assert known == [
        ("INTEREST", "HIGH", "높음"),
        ("CONFIRM_PROCESS", "ZINC_PLATING", "아연도금"),
        ("CONFIRM_PROCESS", "CHROMATE", "크로메이트"),
        ("CONFIRM_INDUSTRY", "없어진 산업", "예전 보기"),
    ]
    assert "CONFIRM_PROCESS" not in state.open_questions
