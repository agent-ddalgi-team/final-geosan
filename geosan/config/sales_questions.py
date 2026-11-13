"""#607·#643 영업 꼬리 질문 파일(C7 `sales-questions.yaml`)의 모양·검사·읽기.

질문 문구·보기·갈라지는 조건은 파일 하나에 두고, 답은 코드(questionId·answerId)로만 저장한다.
세부 단계는 접촉 횟수가 아니라 답으로 알아낸 사실로 정하며 앞으로만 간다(뒤로는 [단계 고치기]).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import Field, ValidationError, model_validator

from geosan.config.errors import AppError, FieldError
from geosan.config.loader import LoadedDocument, load_document
from geosan.config.schemas import FileModel
from geosan.config.validators import pydantic_errors_to_fields, scan_contacts
from geosan.rules.codes import LostReasonCode, OutcomeStatus, SalesStep
from geosan.rules.models import RuleConfig

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
# 고정 보기 질문의 보기 수 하한(약속 C7 "보기 2~8개").
MIN_ANSWERS = 2


class StepEntry(FileModel):
    code: SalesStep
    label: str = Field(min_length=1, max_length=20)
    stage: OutcomeStatus


class AnswerOption(FileModel):
    id: str = Field(pattern=_ID)
    label: str = Field(min_length=1, max_length=100)
    reaches: SalesStep | None = None
    # #643: 이 답이면 큰 단계를 끝낸다(closes) · 이 답이 거절 이유 코드다(lostReason).
    closes: Literal["WON", "LOST", "ON_HOLD"] | None = None
    lost_reason: LostReasonCode | None = None
    # #691: 화면이 미리 골라 두는 보기. 이 칸이 있는 질문은 접촉 자체에 대한 질문이다.
    default: bool = False


class ShowWhen(FileModel):
    answers: dict[str, list[str]] = Field(min_length=1)


class SalesQuestion(FileModel):
    id: str = Field(pattern=_ID)
    step: SalesStep | Literal["ALL"]
    text: str = Field(min_length=1, max_length=100)
    show_when: ShowWhen | None = None
    # 고정 보기(answers)와 회사 값에서 가져오는 보기(choices, #652) 가운데 하나만 쓴다.
    answers: list[AnswerOption] = Field(default_factory=list, max_length=8)
    # #652: PROCESS = 거산 공정 목록, INDUSTRY = 설정 산업군. 여러 개를 고르는 질문이다.
    choices: Literal["PROCESS", "INDUSTRY"] | None = None

    def option(self, answer_id: str) -> AnswerOption | None:
        return next((item for item in self.answers if item.id == answer_id), None)

    @property
    def about_contact(self) -> bool:
        """#691 기본 보기가 있는 질문(누가 먼저 연락했나). 부재 접촉에도 답을 받는다."""
        return any(item.default for item in self.answers)


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
        seen_choices: set[str] = set()
        for question in self.questions:
            if question.id in seen:
                raise ValueError(f"질문 id '{question.id}'가 두 번 있습니다")
            seen.add(question.id)
            if question.choices and question.answers:
                raise ValueError(f"질문 '{question.id}'에 answers와 choices를 같이 쓸 수 없습니다")
            if question.choices is None and len(question.answers) < MIN_ANSWERS:
                raise ValueError(
                    f"질문 '{question.id}'에 보기(answers)를 {MIN_ANSWERS}개 이상 적거나 "
                    "choices를 적어 주세요"
                )
            if question.choices in seen_choices:
                raise ValueError(f"choices: {question.choices} 질문은 파일에 하나만 둘 수 있습니다")
            if question.choices:
                seen_choices.add(question.choices)
                if question.step == ALL_STEPS:
                    raise ValueError(
                        f"choices 질문 '{question.id}'의 step은 ALL일 수 없습니다. "
                        "시작 세부 단계를 적어 주세요"
                    )
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
                if by_id[target].choices:
                    raise ValueError(
                        f"질문 '{question.id}'의 showWhen은 choices 질문 '{target}'을 "
                        "가리킬 수 없습니다"
                    )
                missing = [item for item in answer_ids if by_id[target].option(item) is None]
                if not answer_ids or missing:
                    raise ValueError(
                        f"질문 '{question.id}'의 showWhen에 '{target}'에 없는 보기가 있습니다"
                    )
        self._closing_meaning()
        self._default_meaning()
        return self

    def _default_meaning(self) -> None:
        """#691 기본 보기 칸(default)의 어긋남을 거부한다."""
        for question in self.questions:
            if not question.about_contact:
                continue
            if sum(1 for item in question.answers if item.default) > 1:
                raise ValueError(f"질문 '{question.id}'에 default 보기는 하나만 둘 수 있습니다")
            if question.step != ALL_STEPS or question.show_when is not None:
                raise ValueError(
                    f"default 보기가 있는 질문 '{question.id}'는 step이 ALL이고 "
                    "showWhen이 없어야 합니다"
                )
            if any(item.reaches or item.closes or item.lost_reason for item in question.answers):
                raise ValueError(
                    f"default 보기가 있는 질문 '{question.id}'의 보기에는 "
                    "reaches·closes·lostReason을 쓸 수 없습니다"
                )
            for other in self.questions:
                if other.show_when and question.id in other.show_when.answers:
                    raise ValueError(
                        f"질문 '{other.id}'의 showWhen은 default 보기가 있는 질문 "
                        f"'{question.id}'을 가리킬 수 없습니다"
                    )

    def _closing_meaning(self) -> None:
        """#643 마무리 답 칸(closes·lostReason)의 어긋남을 거부한다."""
        for question in self.questions:
            for option in question.answers:
                if option.reaches and option.closes:
                    raise ValueError(
                        f"질문 '{question.id}'의 보기 '{option.id}'에 reaches와 closes를 "
                        "같이 쓸 수 없습니다"
                    )
        closing = [q for q in self.questions if any(item.closes for item in q.answers)]
        reasons = [q for q in self.questions if any(item.lost_reason for item in q.answers)]
        if len(closing) > 1:
            raise ValueError("closes 보기가 있는 질문은 파일에 하나만 둘 수 있습니다")
        if len(reasons) > 1:
            raise ValueError("lostReason 보기가 있는 질문은 파일에 하나만 둘 수 있습니다")
        lost_ids = [
            item.id for q in closing for item in q.answers if item.closes == OutcomeStatus.LOST
        ]
        if not lost_ids:
            if reasons:
                raise ValueError(
                    f"질문 '{reasons[0].id}'에 lostReason 보기가 있는데 "
                    "closes: LOST 보기가 없습니다"
                )
            return
        if not reasons:
            raise ValueError(
                f"질문 '{closing[0].id}'에 closes: LOST 보기가 있으면 "
                "거절 이유를 정하는 질문(lostReason 보기)이 이어져야 합니다"
            )
        reason = reasons[0]
        conditions = reason.show_when.answers if reason.show_when else {}
        if sorted(conditions.get(closing[0].id, [])) != sorted(lost_ids) or len(conditions) != 1:
            raise ValueError(
                f"질문 '{reason.id}'의 showWhen은 '{closing[0].id}'의 "
                "closes: LOST 보기만 가리켜야 합니다"
            )
        codes = [item.lost_reason for item in reason.answers]
        if None in codes:
            raise ValueError(f"질문 '{reason.id}'의 모든 보기에 lostReason을 적어 주세요")
        if len(set(codes)) != len(codes):
            raise ValueError(f"질문 '{reason.id}'에 같은 lostReason이 두 번 있습니다")

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


def call_signal_errors(
    config: RuleConfig, questions: SalesQuestions, document: LoadedDocument | None = None
) -> list[FieldError]:
    """#685 규칙 설정 `callSignals`의 질문·보기 id가 꼬리 질문 파일에 실제로 있는지 본다.

    `document`는 규칙 설정 파일(줄 번호용)이다. 보기를 회사 값에서 가져오는 질문(choices)은 못 쓴다.
    """
    errors: list[FieldError] = []
    for index, rule in enumerate(config.call_signals):
        for answer_index, answer in enumerate(rule.answers):
            path = f"callSignals[{index}].answers[{answer_index}]"
            question = questions.question(answer.question_id)
            if question is None:
                message = f"꼬리 질문 파일에 없는 질문 '{answer.question_id}'입니다"
            elif question.choices:
                message = (
                    f"질문 '{answer.question_id}'는 보기를 회사 값에서 가져오는 질문(choices)이라 "
                    "통화 신호 대응표에 쓸 수 없습니다"
                )
            elif question.option(answer.answer_id) is None:
                message = f"질문 '{answer.question_id}'에 없는 보기 '{answer.answer_id}'입니다"
            else:
                continue
            line = document.line_of(path) if document is not None else None
            errors.append(FieldError(path=path, message=message, line=line))
    return errors


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
