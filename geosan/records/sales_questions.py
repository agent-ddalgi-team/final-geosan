"""#607 영업 꼬리 질문 파일(C7 `sales-questions.yaml`)과 세부 단계 계산.

질문 문구·보기·갈라지는 조건은 파일 하나에 두고, 답은 코드(questionId·answerId)로만 저장한다.
세부 단계는 접촉 횟수가 아니라 답으로 알아낸 사실로 정하며 앞으로만 간다(뒤로는 [단계 고치기]).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import Field, ValidationError, model_validator

from geosan.config.errors import AppError, FieldError
from geosan.config.loader import LoadedDocument, load_document
from geosan.config.schemas import FileModel
from geosan.config.validators import pydantic_errors_to_fields, scan_contacts
from geosan.rules.codes import OutcomeStatus, SalesStep

REPO_ROOT = Path(__file__).resolve().parents[2]
KST = ZoneInfo("Asia/Seoul")
STEP_ORDER: tuple[SalesStep, ...] = tuple(SalesStep)
STEP_STAGE: dict[SalesStep, OutcomeStatus] = {
    SalesStep.NOT_REACHED: OutcomeStatus.IN_PROGRESS,
    SalesStep.REACHED: OutcomeStatus.IN_PROGRESS,
    SalesStep.DEMAND_CONFIRMED: OutcomeStatus.IN_PROGRESS,
    SalesStep.MATERIAL_QUOTE: OutcomeStatus.SAMPLE_OR_REGISTRATION_APPROVED,
    SalesStep.VISIT_SAMPLE: OutcomeStatus.SAMPLE_OR_REGISTRATION_APPROVED,
}
# 세부 단계가 없는 큰 단계(담당자가 고른 결과).
CLOSED_STAGES = {OutcomeStatus.ON_HOLD, OutcomeStatus.WON, OutcomeStatus.LOST}
ALL_STEPS = "ALL"
_ID = r"^[A-Z][A-Z0-9_]{0,39}$"
OLD_QUESTION = "예전 질문"
OLD_ANSWER = "예전 보기"


class StepEntry(FileModel):
    code: SalesStep
    label: str = Field(min_length=1, max_length=20)
    stage: OutcomeStatus


class AnswerOption(FileModel):
    id: str = Field(pattern=_ID)
    label: str = Field(min_length=1, max_length=100)
    reaches: SalesStep | None = None


class ShowWhen(FileModel):
    answers: dict[str, list[str]] = Field(min_length=1)


class SalesQuestion(FileModel):
    id: str = Field(pattern=_ID)
    step: SalesStep | Literal["ALL"]
    text: str = Field(min_length=1, max_length=100)
    show_when: ShowWhen | None = None
    answers: list[AnswerOption] = Field(min_length=2, max_length=8)

    def option(self, answer_id: str) -> AnswerOption | None:
        return next((item for item in self.answers if item.id == answer_id), None)


class SalesQuestions(FileModel):
    version: int = Field(ge=1)
    steps: list[StepEntry]
    questions: list[SalesQuestion] = Field(min_length=1, max_length=60)

    @model_validator(mode="after")
    def _meaning(self) -> SalesQuestions:
        if [entry.code for entry in self.steps] != list(STEP_ORDER):
            raise ValueError(
                "steps는 NOT_REACHED, REACHED, DEMAND_CONFIRMED, MATERIAL_QUOTE, VISIT_SAMPLE "
                "다섯 개를 이 순서로 적어 주세요"
            )
        for entry in self.steps:
            if entry.stage != STEP_STAGE[entry.code]:
                raise ValueError(
                    f"{entry.code}의 stage는 {STEP_STAGE[entry.code].value}여야 합니다"
                )
        seen: set[str] = set()
        for question in self.questions:
            if question.id in seen:
                raise ValueError(f"질문 id '{question.id}'가 두 번 있습니다")
            seen.add(question.id)
            answer_ids = [item.id for item in question.answers]
            if len(set(answer_ids)) != len(answer_ids):
                raise ValueError(f"질문 '{question.id}'에 같은 보기 id가 두 번 있습니다")
        by_id = {question.id: question for question in self.questions}
        for question in self.questions:
            conditions = question.show_when.answers if question.show_when else {}
            for target, answer_ids in conditions.items():
                if target == question.id:
                    raise ValueError(f"질문 '{question.id}'의 showWhen이 자기 자신을 가리킵니다")
                if target not in by_id:
                    raise ValueError(f"질문 '{question.id}'의 showWhen에 없는 질문 '{target}'")
                missing = [item for item in answer_ids if by_id[target].option(item) is None]
                if not answer_ids or missing:
                    raise ValueError(
                        f"질문 '{question.id}'의 showWhen에 '{target}'에 없는 보기가 있습니다"
                    )
        return self

    def question(self, question_id: str) -> SalesQuestion | None:
        return next((item for item in self.questions if item.id == question_id), None)

    def step_label(self, code: SalesStep) -> str:
        return next(entry.label for entry in self.steps if entry.code == code)


@dataclass
class SalesQuestionsCheck:
    document: LoadedDocument | None
    questions: SalesQuestions | None
    errors: list[FieldError]


def questions_path(file_setting: str) -> Path:
    path = Path(file_setting)
    return path if path.is_absolute() else REPO_ROOT / path


def check_sales_questions_file(path: Path | str) -> SalesQuestionsCheck:
    """모양(모르는 키 거부) → 뜻(단계·id·꼬리 조건) → 연락처 순으로 검사한다."""
    try:
        document = load_document(path)
    except AppError as exc:
        errors = exc.fields or [FieldError(path="", message=exc.message)]
        return SalesQuestionsCheck(None, None, errors)
    errors = scan_contacts(document.data, document=document)
    if errors:
        return SalesQuestionsCheck(document, None, errors)
    try:
        questions = SalesQuestions.model_validate(document.data)
    except ValidationError as exc:
        return SalesQuestionsCheck(
            document, None, pydantic_errors_to_fields(exc, document.data, document)
        )
    return SalesQuestionsCheck(document, questions, [])


def load_sales_questions(file_setting: str) -> SalesQuestions:
    """서버가 읽을 때마다 검사한다. 틀리면 500 CONFIG_INVALID(운영자가 파일을 고쳐야 함)."""
    result = check_sales_questions_file(questions_path(file_setting))
    if result.questions is None:
        raise AppError(
            message="꼬리 질문 파일을 읽지 못했습니다.",
            next_action="운영자가 geosan check-config로 꼬리 질문 파일을 확인해 주세요.",
            status=500,
            kind="CONFIG_INVALID",
        )
    return result.questions


# ---------------------------------------------------------------------------
# 세부 단계 계산 (저장 없이 기록에서 매번 계산)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RecordRow:
    """계산에 필요한 접촉·단계 행 한 줄. version 순으로 넘긴다."""

    outcome_id: str
    method: str | None
    attempted_at: date | None
    created_at: datetime
    created_by: str
    step_override: str | None


@dataclass(frozen=True)
class AnswerRow:
    outcome_id: str
    question_id: str
    answer_id: str


@dataclass
class KnownAnswer:
    question_id: str
    question: str
    answer_id: str
    answer: str
    at: date
    by: str


@dataclass
class SalesStepState:
    code: SalesStep | None = None
    since: date | None = None
    overridden: bool = False
    known: list[KnownAnswer] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)


def _day(row: RecordRow) -> date:
    return row.attempted_at or row.created_at.astimezone(KST).date()


def _later(step: SalesStep, current: SalesStep | None) -> bool:
    return current is None or STEP_ORDER.index(step) > STEP_ORDER.index(current)


def compute_sales_step(
    rows: Sequence[RecordRow],
    answers: Iterable[AnswerRow],
    questions: SalesQuestions,
    status: str | None,
) -> SalesStepState:
    """기록 행(version 순)과 답으로 세부 단계·알아낸 것·아직 모르는 질문을 계산한다."""
    by_outcome: dict[str, list[AnswerRow]] = {}
    for answer in answers:
        by_outcome.setdefault(answer.outcome_id, []).append(answer)
    state = SalesStepState()
    latest: dict[str, tuple[AnswerRow, RecordRow]] = {}
    contacted = False
    step: SalesStep | None = None
    for row in rows:
        if row.step_override:
            step, state.since, state.overridden = SalesStep(row.step_override), _day(row), True
        if row.method:
            contacted = True
            if step is None:
                step, state.since, state.overridden = SalesStep.NOT_REACHED, _day(row), False
        for answer in by_outcome.get(row.outcome_id, []):
            latest[answer.question_id] = (answer, row)
            question = questions.question(answer.question_id)
            option = question.option(answer.answer_id) if question else None
            if option and option.reaches and _later(option.reaches, step):
                step, state.since, state.overridden = option.reaches, _day(row), False
    order = {question.id: index for index, question in enumerate(questions.questions)}
    for question_id, (answer, row) in sorted(
        latest.items(), key=lambda item: order.get(item[0], len(order))
    ):
        question = questions.question(question_id)
        option = question.option(answer.answer_id) if question else None
        state.known.append(
            KnownAnswer(
                question_id=question_id,
                question=question.text if question else OLD_QUESTION,
                answer_id=answer.answer_id,
                answer=option.label if option else OLD_ANSWER,
                at=_day(row),
                by=row.created_by,
            )
        )
    if not contacted or (status is not None and OutcomeStatus(status) in CLOSED_STAGES):
        state.since, state.overridden = None, False
        return state
    state.code = step
    chosen = {question_id: answer.answer_id for question_id, (answer, _) in latest.items()}
    state.open_questions = [
        question.id
        for question in questions.questions
        if question.step in (step, ALL_STEPS)
        and question.id not in chosen
        and all(
            chosen.get(target) in answer_ids
            for target, answer_ids in (
                question.show_when.answers if question.show_when else {}
            ).items()
        )
    ]
    return state


def stage_for(status: str, method: str | None, step: SalesStep | None) -> str:
    """큰 단계는 세부 단계를 따라 앞으로만 바뀐다. 보류·성사·거절은 그대로 둔다(C1 /outcomes)."""
    if status == OutcomeStatus.NOT_EXECUTED and method:
        status = OutcomeStatus.IN_PROGRESS
    if (
        step is not None
        and STEP_STAGE[step] == OutcomeStatus.SAMPLE_OR_REGISTRATION_APPROVED
        and status in (OutcomeStatus.NOT_EXECUTED, OutcomeStatus.IN_PROGRESS)
    ):
        status = OutcomeStatus.SAMPLE_OR_REGISTRATION_APPROVED
    return str(status)
