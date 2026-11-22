"""#607 세부 단계 계산. 기록 행과 꼬리 질문 답으로 저장 없이 매번 계산한다.

세부 단계는 접촉 횟수가 아니라 답으로 알아낸 사실로 정하며 앞으로만 간다(뒤로는 [단계 고치기]).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime

from geosan.config.sales_questions import (
    ALL_STEPS,
    CLOSED_STAGES,
    KST,
    OLD_ANSWER,
    OLD_QUESTION,
    STEP_ORDER,
    STEP_STAGE,
    SalesQuestions,
)
from geosan.rules.codes import ContactResult, OutcomeStatus, SalesStep

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
    # (#748) 접촉 결과. REACHED면 세부 단계가 "연결됨"까지 간다(reached_by_result).
    result: str | None = None


@dataclass(frozen=True)
class AnswerRow:
    outcome_id: str
    question_id: str
    answer_id: str


def step_rows(outcomes: Iterable, answers: Iterable) -> tuple[list[RecordRow], list[AnswerRow]]:
    """(#725) 저장된 기록 행·답 행을 계산용 행으로 옮긴다. 순서는 받은 그대로다."""
    return (
        [
            RecordRow(
                outcome_id=row.outcome_id,
                method=row.method,
                attempted_at=row.attempted_at,
                created_at=row.created_at,
                created_by=row.created_by,
                step_override=row.step_override,
                result=row.result,
            )
            for row in outcomes
        ],
        [AnswerRow(row.outcome_id, row.question_id, row.answer_id) for row in answers],
    )


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


contact_day = _day
"""접촉 날짜(없으면 저장한 날). 통화 신호 날짜(#685)도 같은 기준을 쓴다."""


def _later(step: SalesStep, current: SalesStep | None) -> bool:
    return current is None or STEP_ORDER.index(step) > STEP_ORDER.index(current)


FIRST_STEP = STEP_ORDER[0]
REACHED_STEP = STEP_ORDER[1]


def reached_by_result(questions: SalesQuestions, picked: Mapping[str, Sequence[str]]) -> bool:
    """(#748) 결과 "연결됨" 접촉이 세부 단계를 "연결됨"까지 옮기나.

    그 접촉에서 맨 앞 단계(연결 전) 질문에 reaches 없는 보기("다른 부서"·"안내만")를 골랐으면
    옮기지 않는다.
    """
    for question_id, answer_ids in picked.items():
        question = questions.question(question_id)
        if question is None or question.choices or question.step != FIRST_STEP:
            continue
        for answer_id in answer_ids:
            option = question.option(answer_id)
            if option is not None and not option.reaches:
                return False
    return True


def _asked_at(question, step: SalesStep | None) -> bool:
    """이 세부 단계에서 묻는 질문인가. choices 질문(#652)은 그 단계부터 답할 때까지 계속 묻는다."""
    if question.step == ALL_STEPS or question.step == step:
        return True
    return bool(question.choices) and step is not None and not _later(question.step, step)


def compute_sales_step(
    rows: Sequence[RecordRow],
    answers: Iterable[AnswerRow],
    questions: SalesQuestions,
    status: str | None,
    choice_labels: Mapping[str, Mapping[str, str]] | None = None,
) -> SalesStepState:
    """기록 행(version 순)과 답으로 세부 단계·알아낸 것·아직 모르는 질문을 계산한다.

    `choice_labels`는 보기를 회사 값에서 가져오는 질문(#652 choices)의 {종류: {값: 이름}}이다.
    그런 질문은 한 접촉에서 여러 값을 고르므로, 그 질문에 답한 가장 최근 접촉의 값을 모두 싣는다.
    """
    by_outcome: dict[str, list[AnswerRow]] = {}
    for answer in answers:
        by_outcome.setdefault(answer.outcome_id, []).append(answer)
    state = SalesStepState()
    latest: dict[str, tuple[list[AnswerRow], RecordRow]] = {}
    contacted = False
    step: SalesStep | None = None
    for row in rows:
        if row.step_override:
            step, state.since, state.overridden = SalesStep(row.step_override), _day(row), True
        if row.method:
            contacted = True
            if step is None:
                step, state.since, state.overridden = SalesStep.NOT_REACHED, _day(row), False
        in_this_row: dict[str, list[AnswerRow]] = {}
        for answer in by_outcome.get(row.outcome_id, []):
            question = questions.question(answer.question_id)
            if question is not None and question.choices:
                in_this_row.setdefault(answer.question_id, []).append(answer)
            else:
                in_this_row[answer.question_id] = [answer]
            latest[answer.question_id] = (in_this_row[answer.question_id], row)
            option = question.option(answer.answer_id) if question else None
            if option and option.reaches and _later(option.reaches, step):
                step, state.since, state.overridden = option.reaches, _day(row), False
        if (
            row.method
            and row.result == ContactResult.REACHED
            and _later(REACHED_STEP, step)
            and reached_by_result(
                questions,
                {key: [item.answer_id for item in found] for key, found in in_this_row.items()},
            )
        ):
            step, state.since, state.overridden = REACHED_STEP, _day(row), False
    order = {question.id: index for index, question in enumerate(questions.questions)}
    for question_id, (chosen_answers, row) in sorted(
        latest.items(), key=lambda item: order.get(item[0], len(order))
    ):
        question = questions.question(question_id)
        labels = (choice_labels or {}).get(question.choices, {}) if question else {}
        for answer in chosen_answers:
            option = question.option(answer.answer_id) if question else None
            if question is not None and question.choices:
                label = labels.get(answer.answer_id, OLD_ANSWER)
            else:
                label = option.label if option else OLD_ANSWER
            state.known.append(
                KnownAnswer(
                    question_id=question_id,
                    question=question.text if question else OLD_QUESTION,
                    answer_id=answer.answer_id,
                    answer=label,
                    at=_day(row),
                    by=row.created_by,
                )
            )
    if not contacted or (status is not None and OutcomeStatus(status) in CLOSED_STAGES):
        state.since, state.overridden = None, False
        return state
    state.code = step
    chosen = {question_id: found[-1].answer_id for question_id, (found, _) in latest.items()}
    state.open_questions = [
        question.id
        for question in questions.questions
        if _asked_at(question, step)
        and question.id not in chosen
        and all(
            chosen.get(target) in answer_ids
            for target, answer_ids in (
                question.show_when.answers if question.show_when else {}
            ).items()
        )
    ]
    return state


def stage_for(status: str, step: SalesStep | None) -> str:
    """미접촉·접촉인 회사의 큰 단계는 세부 단계를 따른다(C1 /outcomes).

    (바뀜 2026-11-23 #899 — PM 결정) 연결 전 = 미접촉, 연결됨·수요 확인 = 접촉, 자료·견적 이상 = 견적·샘플.
    그래서 연락만 하고 연결되지 않은 회사는 미접촉에 남는다. 견적·샘플은 세부 단계를 고쳐도 내려가지 않고,
    보류·성사·거절은 담당자가 고른 그대로 둔다.
    """
    if step is not None and status in (OutcomeStatus.NOT_EXECUTED, OutcomeStatus.IN_PROGRESS):
        status = STEP_STAGE[step]
    return str(status)
