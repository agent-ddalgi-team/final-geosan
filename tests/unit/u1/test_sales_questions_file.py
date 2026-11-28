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
  - { code: NOT_REACHED, label: 연결 전, stage: NOT_EXECUTED }
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
    # 예시 설정에 records 묶음이 생겼으므로(#691) 묶음을 새로 붙이지 않고 그 안에 칸을 넣는다
    assert settings.count("\nrecords:\n") == 1
    settings_path.write_text(
        settings.replace("\nrecords:\n", f"\nrecords:\n  salesQuestionsFile: {broken}\n"),
        encoding="utf-8",
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
    ("status", "step", "expected"),
    [
        # (바뀜 2026-11-23 #899 — PM 결정) 연결 전 = 미접촉:
        # 연락만 하고 연결되지 않으면 미접촉에 남는다.
        ("NOT_EXECUTED", "NOT_REACHED", "NOT_EXECUTED"),
        ("NOT_EXECUTED", "REACHED", "IN_PROGRESS"),
        ("NOT_EXECUTED", "DEMAND_CONFIRMED", "IN_PROGRESS"),
        # [단계 고치기]로 연결 전으로 되돌리면 접촉에서 미접촉으로 돌아간다.
        ("IN_PROGRESS", "NOT_REACHED", "NOT_EXECUTED"),
        ("NOT_EXECUTED", None, "NOT_EXECUTED"),
        ("IN_PROGRESS", "VISIT_SAMPLE", "SAMPLE_OR_REGISTRATION_APPROVED"),
        ("NOT_EXECUTED", "MATERIAL_QUOTE", "SAMPLE_OR_REGISTRATION_APPROVED"),
        # 견적·샘플은 세부 단계를 고쳐도 내려가지 않고, 보류·성사·거절은 그대로다.
        ("SAMPLE_OR_REGISTRATION_APPROVED", "REACHED", "SAMPLE_OR_REGISTRATION_APPROVED"),
        ("SAMPLE_OR_REGISTRATION_APPROVED", "NOT_REACHED", "SAMPLE_OR_REGISTRATION_APPROVED"),
        ("ON_HOLD", "VISIT_SAMPLE", "ON_HOLD"),
        ("WON", "VISIT_SAMPLE", "WON"),
        ("LOST", "MATERIAL_QUOTE", "LOST"),
    ],
)
def test_big_stage_follows_step_for_open_companies(status, step, expected):
    assert stage_for(status, step) == expected


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
        (CHOICE.replace("step: REACHED", "step: ALL"), "step은 ALL일 수 없습니다"),
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


WHO_FIRST = """  - id: WHO_FIRST
    step: ALL
    text: 누가 먼저 연락했나요?
    answers:
      - { id: OURS, label: 우리가, default: true }
      - { id: THEIRS, label: 상대가 }
"""


def test_default_answer_question_passes(tmp_path):
    """#691 Given 기본 보기가 있는 질문 / When 검사 / Then 통과하고 접촉 자체 질문으로 읽힌다."""
    text = "version: 1\n" + STEPS + "questions:\n" + QUESTION + WHO_FIRST
    result = check_sales_questions_file(write(tmp_path, text))
    assert result.errors == []
    question = result.questions.question("WHO_FIRST")
    assert question.about_contact is True
    assert [item.default for item in question.answers] == [True, False]
    assert result.questions.question("PLATING_NOW").about_contact is False
    example = check_sales_questions_file(EXAMPLE).questions.question("WHO_FIRST")
    assert [(item.id, item.default) for item in example.answers] == [
        ("OURS", True),
        ("THEIRS", False),
    ]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (WHO_FIRST.replace("label: 상대가 }", "label: 상대가, default: true }"), "하나만"),
        (WHO_FIRST.replace("step: ALL", "step: REACHED"), "step이 ALL"),
        (
            QUESTION + WHO_FIRST + "    showWhen: { answers: { PLATING_NOW: [IN_HOUSE] } }\n",
            "showWhen이 없어야",
        ),
        (
            WHO_FIRST.replace("label: 상대가 }", "label: 상대가, reaches: REACHED }"),
            "reaches·closes·lostReason",
        ),
        (
            WHO_FIRST + QUESTION + "    showWhen: { answers: { WHO_FIRST: [THEIRS] } }\n",
            "가리킬 수 없습니다",
        ),
        (WHO_FIRST.replace("default: true", "default: maybe"), "default"),
    ],
)
def test_broken_default_answers_are_rejected(tmp_path, text, expected):
    """#691 기본 보기는 하나뿐, step ALL, 꼬리·단계 칸 없음."""
    result = check_sales_questions_file(
        write(tmp_path, "version: 1\n" + STEPS + "questions:\n" + text)
    )
    assert result.questions is None
    assert any(expected in f"{error.path} {error.message}" for error in result.errors), result


# ---------------------------------------------------------------------------
# #985(PM 결정 2026-11-29): 접촉마다 묻는 상대 반응 질문 3개
# ---------------------------------------------------------------------------

REACTION_IDS = ["REACTION", "REACTION_GOOD", "REACTION_BAD"]


def test_example_file_starts_with_the_three_reaction_questions():
    """Given 예시 질문 파일 / When 읽음 / Then 맨 앞 세 질문이 상대 반응·좋게 본 부분·걸린 부분이다.

    영업 코치는 빠진 필수 질문을 파일 순서로 상한까지만 고른다. 접촉마다 꼭 묻도록 맨 앞에 둔다.
    """
    questions = check_sales_questions_file(EXAMPLE).questions
    first = questions.questions[:3]
    assert [question.id for question in first] == REACTION_IDS
    assert [question.step for question in first] == ["ALL", "ALL", "ALL"]
    assert [question.text for question in first] == [
        "상대 반응은 어땠나요?",
        "어느 부분을 좋게 봤나요?",
        "어느 부분이 걸렸나요?",
    ]
    # 보기를 회사 값에서 가져오는 질문이 아니다(하나만 고르는 고정 보기).
    assert [question.choices for question in first] == [None, None, None]


def test_reaction_question_options_are_exactly_these():
    questions = check_sales_questions_file(EXAMPLE).questions
    options = {
        question_id: [(item.id, item.label) for item in questions.question(question_id).answers]
        for question_id in REACTION_IDS
    }
    assert options == {
        "REACTION": [("POSITIVE", "긍정적"), ("NEUTRAL", "보통"), ("NEGATIVE", "부정적")],
        "REACTION_GOOD": [
            ("PROCESS_FIT", "공정·기술"),
            ("QUALITY_CERT", "품질·인증"),
            ("LEAD_TIME", "납기"),
            ("PRICE", "가격"),
            ("DISTANCE", "거리·물류"),
            ("RESPONSE", "대응·신뢰"),
            ("OTHER", "기타"),
        ],
        "REACTION_BAD": [
            ("PRICE", "가격"),
            ("LEAD_TIME", "납기"),
            ("QUALITY_CERT", "품질·인증"),
            ("PROCESS_FIT", "공정·기술"),
            ("DISTANCE", "거리·물류"),
            ("INCUMBENT_SUPPLIER", "기존 거래처"),
            ("CLAIM", "클레임(불량·납기)"),
            ("OTHER", "기타"),
        ],
    }


def test_reaction_tails_show_only_after_the_matching_reaction():
    """좋게 본 부분은 '긍정적'일 때만, 걸린 부분은 '부정적'일 때만 보인다. 상대 반응은 늘 보인다."""
    questions = check_sales_questions_file(EXAMPLE).questions
    assert questions.question("REACTION").show_when is None
    assert questions.question("REACTION_GOOD").show_when.answers == {"REACTION": ["POSITIVE"]}
    assert questions.question("REACTION_BAD").show_when.answers == {"REACTION": ["NEGATIVE"]}


def test_reaction_questions_are_required_for_the_coach_and_filled_by_ai():
    """셋 다 영업 코치 필수이고 AI가 채운다. 앞 답 조건(requiredWhen) 없이 보이면 필수다."""
    questions = check_sales_questions_file(EXAMPLE).questions
    for question_id, keyword in zip(
        REACTION_IDS, ["상대 반응", "좋게 본 부분", "걸린 부분"], strict=True
    ):
        question = questions.question(question_id)
        assert (question.coach_fill, question.required) == ("AI", True), question_id
        assert question.coach.required_when is None, question_id
        assert question.coach.keyword == keyword, question_id


def test_reaction_answers_do_not_touch_the_step_or_the_stage():
    """세 질문의 어떤 보기도 세부 단계를 옮기거나(reaches) 영업을 끝내거나(closes·lostReason)
    미리 골라져 있지(default) 않다. 부재 접촉에도 받는 '접촉 자체 질문'도 아니다."""
    questions = check_sales_questions_file(EXAMPLE).questions
    for question_id in REACTION_IDS:
        question = questions.question(question_id)
        assert question.about_contact is False, question_id
        for option in question.answers:
            touched = (option.reaches, option.closes, option.lost_reason, option.default)
            assert touched == (None, None, None, False), (question_id, option.id)


def test_reaction_answers_keep_the_computed_step_where_it_was():
    """Given 연결된 접촉 한 번 / When 그 접촉에 상대 반응 답을 더해 계산
    / Then 세부 단계·시작일은 답이 없을 때와 같고, 알아낸 것에만 두 줄이 더 있다."""
    questions = check_sales_questions_file(EXAMPLE).questions
    reached = RecordRow(
        outcome_id="o1",
        method="CALL",
        attempted_at=date(2026, 10, 20),
        created_at=datetime(2026, 10, 20, tzinfo=UTC),
        created_by="kim",
        step_override=None,
        result="REACHED",
    )
    plain = compute_sales_step([reached], [], questions, "IN_PROGRESS")
    answered = compute_sales_step(
        [reached],
        [AnswerRow("o1", "REACTION", "NEGATIVE"), AnswerRow("o1", "REACTION_BAD", "CLAIM")],
        questions,
        "IN_PROGRESS",
    )
    assert (plain.code, plain.since) == ("REACHED", date(2026, 10, 20))
    assert (answered.code, answered.since, answered.overridden) == (plain.code, plain.since, False)
    assert [(item.question_id, item.answer) for item in answered.known] == [
        ("REACTION", "부정적"),
        ("REACTION_BAD", "클레임(불량·납기)"),
    ]
    assert stage_for("IN_PROGRESS", answered.code) == stage_for("IN_PROGRESS", plain.code)
