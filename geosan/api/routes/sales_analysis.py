"""영업 분석표 경로 (U7, 계약 C1 `GET /sales-analysis`, #608). 응답 모양은 이 파일에 둔다.

읽기 전용이다: 저장·외부 호출이 없고 보기 전용 계정도 본다. 영업 기록에서 나온 내부 전용
화면이라 엑셀·질문 목록·외부 AI로 내보내지 않는다(계약 C4). 응답에는 코드값·건수·날짜·회사
이름만 있고 메모 글·사람 이름·연락처는 없다.
"""

from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api import analysis_feedback as feedback
from geosan.api.deps import SessionDep, get_session, require_staff, runtime_for
from geosan.api.process_catalog import load_process_catalog
from geosan.api.routes.opportunities import _address_region
from geosan.api.routes.records import (
    COACH_SUGGESTION_SUFFIX,
    sales_questions,
    sales_step_state,
)
from geosan.api.sales_step import compute_sales_step, step_rows
from geosan.api.schemas import ContactCount, Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import AppError, FieldError, InputError, RunFailedError
from geosan.config.sales_questions import KST, STEP_ORDER
from geosan.config.validators import find_contact
from geosan.dashboard.sales_analysis import (
    build_sales_analysis,
    load_company_records,
    load_process_proposal_hit,
    process_display_name,
)
from geosan.dashboard.sales_patterns import (
    PatternCompany,
    PatternLine,
    QuestionInfo,
    build_sales_patterns,
)
from geosan.evidence.assistant_llm import analyze_sales
from geosan.evidence.sales_record_gate import (
    SALES_ANALYSIS_KIND,
    sales_record_calls_today,
    scrub_sales_record,
)
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.live import live_outcomes_with_answers
from geosan.records.models import AnalysisFeedback, Note
from geosan.records.program_note import CHANGE_KIND
from geosan.rules.codes import (
    ContactMethod,
    ContactResult,
    DatasetKind,
    LostReasonCode,
    OutcomeStatus,
    SalesStep,
)
from geosan.storage.base import new_id, utcnow

router = APIRouter()


class ReachCount(_ApiModel):
    reached: int
    tried: int


class ContactReach(_ApiModel):
    """방법별 시도(tried)와 그중 연결(reached). 키는 계약의 대문자 코드 그대로다."""

    call: ReachCount = Field(alias="CALL")
    email: ReachCount = Field(alias="EMAIL")
    visit: ReachCount = Field(alias="VISIT")


class ReachRatios(_ApiModel):
    call: float | None = Field(alias="CALL")
    email: float | None = Field(alias="EMAIL")
    visit: float | None = Field(alias="VISIT")


class Ratios(_ApiModel):
    """표본이 설정 기준 이상일 때만 싣는 비율(소수 2자리)."""

    won: float
    reach: ReachRatios


class LostReasonCount(_ApiModel):
    code: LostReasonCode
    count: int


class GroupStats(_ApiModel):
    """집계 칸. contactedCount가 표본 수이고 진행 중·보류·성사·거절의 합과 같다."""

    contacted_count: int
    in_progress_count: int
    on_hold_count: int
    won_count: int
    lost_count: int
    avg_contacts_to_won: float | None
    contact_reach: ContactReach
    lost_reasons: list[LostReasonCount]
    ratios: Ratios | None


class IndustryRow(GroupStats):
    industry: str
    # (#684) 이 줄의 회사 가운데 같은 공정 아래 다른 산업군 줄에도 든 회사 수.
    overlap_count: int


class ProcessRow(GroupStats):
    process_code: str | None
    process_name: str
    by_industry: list[IndustryRow]
    # (#684) 이 줄의 회사 가운데 다른 공정 줄에도 든 회사 수.
    overlap_count: int


class StepRow(_ApiModel):
    """(#684) 세부 단계 한 줄. 앞 네 칸은 그 단계에 머무는 동안, 뒤 세 칸은 그 단계에 이르기까지."""

    step: SalesStep
    contacted_count: int
    contact_count: int
    contact_reach: ContactReach
    reach_ratios: ReachRatios | None
    reached_count: int
    contacts_to_reach: int
    avg_contacts_to_reach: float | None


class TimelineEvent(_ApiModel):
    """(#801) 회사별 타임라인의 기록 행 하나(취소 안 한 행, 저장 순서). 코드값·날짜만."""

    at: date
    method: ContactMethod | None
    result: ContactResult | None
    step_after: SalesStep | None
    status: OutcomeStatus


class CompanyRow(_ApiModel):
    opp_id: str
    name: str
    process_codes: list[str]
    industries: list[str]
    contact_count: ContactCount
    outcome_status: OutcomeStatus
    sales_step: SalesStep | None
    lost_reason_code: LostReasonCode | None
    first_contact_at: date
    last_contact_at: date
    days_since_first_contact: int
    outcome_at: date | None
    days_to_outcome: int | None
    # (#801) 기록으로 이른 가장 먼 세부 단계(성사·거절·보류 회사도 값이 있다)와 기록 행 줄.
    furthest_step: SalesStep | None
    timeline: list[TimelineEvent]


class AnalysisBasis(_ApiModel):
    min_sample_for_ratio: int
    closed_window_days: int
    company_count: int
    older_closed_excluded: int
    # (#760) 기간 모드에서 실제로 쓴 양끝. 기간 모드가 아니면 둘 다 null.
    period_from: date | None = Field(default=None, alias="from")
    period_to: date | None = Field(default=None, alias="to")


class ProposalHit(_ApiModel):
    """(#678) 담당자가 확정한 회사 수와 그 가운데 AI 제안 안에서 고른 회사 수."""

    confirmed_count: int
    hit_count: int
    ratio: float | None


class AiProposalHit(_ApiModel):
    """(#678) 지금은 공정만 센다. 산업군은 확정 전 AI 제안이 저장에 남지 않아 셀 수 없다."""

    process: ProposalHit


class SalesAnalysis(_ApiModel):
    as_of: datetime
    basis: AnalysisBasis
    by_process: list[ProcessRow]
    companies: list[CompanyRow]
    # (#684) 회사를 한 번씩만 센 합계와 단계별 접촉.
    total: GroupStats
    by_sales_step: list[StepRow]
    # (#678) AI 제안 적중.
    ai_proposal_hit: AiProposalHit


SalesAnalysisEnvelope = Envelope[SalesAnalysis]


def _stats(stats) -> dict:
    return GroupStats.model_validate(stats, from_attributes=True).model_dump()


def _steps_after(session: Session, opp_id: str) -> dict[str, str | None]:
    """(#684) 기록 행마다 그 행을 저장한 뒤의 세부 단계. 저장하지 않으므로 행마다 다시 계산한다.

    상세·카드와 같은 계산(`compute_sales_step`)을 첫 행부터 그 행까지만 넣어 부른다. 그래서 답의
    `reaches`와 [단계 고치기]가 그대로 따라온다. 지금 성사·거절이어도 그때의 단계를 보려고
    큰 단계(status)는 넘기지 않는다. 취소된 기록과 거기 달린 답은 뺀다(#253).
    """
    rows, answers = step_rows(*live_outcomes_with_answers(session, opp_id))
    questions = sales_questions(session)
    steps: dict[str, str | None] = {}
    for index, row in enumerate(rows):
        code = compute_sales_step(rows[: index + 1], answers, questions, None).code
        steps[row.outcome_id] = code.value if code is not None else None
    return steps


def _period_day(value: str | None, field: str) -> date | None:
    """(#760) 기간 질의 한 칸을 한국 날짜로. 비었으면 None, 모양이 틀리면 칸 이름을 붙여 400."""
    if value is None or value.strip() == "":
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise InputError(
            "기간 날짜는 2026-11-15처럼 적어 주세요.",
            fields=[FieldError(path=field, message="날짜 모양이 아닙니다.")],
        ) from None


def _analysis_inputs(session: Session, period_from: str | None, period_to: str | None):
    """영업 분석표와 패턴 세기(#802)가 함께 쓰는 입력: 기간·설정·회사 기록·분석표 결과."""
    day_from = _period_day(period_from, "from")
    day_to = _period_day(period_to, "to")
    if day_from is not None and day_to is not None and day_from > day_to:
        raise InputError(
            "기간의 시작일이 끝일보다 뒤입니다.",
            fields=[
                FieldError(path="from", message="끝일보다 앞이어야 합니다."),
                FieldError(path="to", message="시작일보다 뒤여야 합니다."),
            ],
        )
    period = None if day_from is None and day_to is None else (day_from, day_to)
    runtime = runtime_for(session)
    settings = runtime.app_settings.sales_analysis
    if settings is None:
        # 기준 숫자를 코드에서 지어내지 않는다(규칙 ⑩). 설정이 없으면 표를 내지 않고 알린다.
        raise RunFailedError(
            "영업 분석표 기준(salesAnalysis)이 설정에 없습니다. 앱 설정 파일을 확인해 주세요."
        )
    dataset_kind = runtime.app_settings.active_dataset_kind
    now = utcnow()
    companies = load_company_records(
        session,
        dataset_kind=dataset_kind.value,
        sales_step_of=lambda opp_id, status: sales_step_state(session, opp_id, status=status).code,
        # #652: 영업 분석표는 확정된 공정·산업군만 센다. 확인 전 회사는 "확인 전" 한 줄.
        confirmed_only=True,
        # #684: 단계별 접촉에 쓸 행마다의 세부 단계. 계산 부품이 창구를 거꾸로 부르지 않게 넘긴다.
        steps_after_of=lambda opp_id: _steps_after(session, opp_id),
    )
    result = build_sales_analysis(
        companies,
        processes=[
            (row.code, process_display_name(row.name))
            for row in load_process_catalog(session, dataset_kind)
        ],
        industries=runtime.app_settings.industries,
        min_sample_for_ratio=settings.min_sample_for_ratio,
        closed_window_days=settings.closed_window_days,
        now=now,
        # 계산 부품은 규칙·설정 부품을 가져오지 않는다. 시간대와 거절 이유 순서는 여기서 넘긴다.
        tz=KST,
        lost_reason_order=[code.value for code in LostReasonCode],
        step_order=[step.value for step in STEP_ORDER],
        period=period,
    )
    return period, runtime, settings, dataset_kind, now, companies, result


@router.get("/sales-analysis", response_model=SalesAnalysisEnvelope)
def sales_analysis(
    session: SessionDep,
    period_from: Annotated[str | None, Query(alias="from")] = None,
    period_to: Annotated[str | None, Query(alias="to")] = None,
):
    """공정별·회사별 영업 분석표. 영업 기록만으로 계산하며 저장하지 않는다.

    (#760) `from`·`to`(한국 날짜)를 하나라도 주면 그 기간 안 접촉으로 센다. 둘 다 없으면 전과 같다.
    """
    period, runtime, settings, dataset_kind, now, companies, result = _analysis_inputs(
        session, period_from, period_to
    )
    data = SalesAnalysis(
        as_of=result.as_of,
        basis=AnalysisBasis.model_validate(result.basis, from_attributes=True),
        by_process=[
            ProcessRow(
                process_code=row.process_code,
                process_name=row.process_name,
                by_industry=[
                    IndustryRow(
                        industry=item.industry,
                        overlap_count=item.overlap_count,
                        **_stats(item.stats),
                    )
                    for item in row.by_industry
                ],
                overlap_count=row.overlap_count,
                **_stats(row.stats),
            )
            for row in result.by_process
        ],
        companies=[
            CompanyRow.model_validate(row, from_attributes=True) for row in result.companies
        ],
        total=GroupStats.model_validate(result.total, from_attributes=True),
        by_sales_step=[
            StepRow.model_validate(row, from_attributes=True) for row in result.by_sales_step
        ],
        ai_proposal_hit=AiProposalHit(
            process=ProposalHit.model_validate(
                load_process_proposal_hit(
                    session,
                    dataset_kind=dataset_kind.value,
                    min_sample_for_ratio=settings.min_sample_for_ratio,
                ),
                from_attributes=True,
            )
        ),
    )
    return SalesAnalysisEnvelope(
        data=data,
        meta=Meta(
            updated_at=now,
            dataset_kind=dataset_kind,
            has_virtual_data=bool(result.companies)
            and dataset_kind == DatasetKind.VIRTUAL_REVIEWED,
        ),
    )


# ---------------------------------------------------------------------------
# #802·#820: 패턴 펼쳐 보기 (GET /sales-analysis/patterns). AI·외부 호출·저장 없음.
# ---------------------------------------------------------------------------


class PatternBasis(_ApiModel):
    min_sample_for_ratio: int
    closed_count: int
    won_count: int
    overall_won_ratio: float | None


class PatternStepCount(_ApiModel):
    step: SalesStep | None
    count: int


class PatternCodeCount(_ApiModel):
    code: LostReasonCode
    count: int


class PatternAnswerCount(_ApiModel):
    answer_id: str
    count: int


class PatternStepAnswers(_ApiModel):
    step: SalesStep
    question_id: str
    answers: list[PatternAnswerCount]


class PatternFailure(_ApiModel):
    count: int
    on_hold_count: int
    by_step: list[PatternStepCount]
    lost_reasons: list[PatternCodeCount]
    step_answers: list[PatternStepAnswers]


class PatternSuccess(_ApiModel):
    count: int
    by_step: list[PatternStepCount]
    avg_contacts_to_won: float | None
    avg_first_visit_index: float | None
    failed_avg_first_visit_index: float | None


class PatternContactRow(_ApiModel):
    visited: bool
    bucket: Literal["ZERO", "ONE", "TWO", "THREE", "FOUR_PLUS"]
    won: int
    failed: int
    in_progress: int
    won_ratio: float | None
    judged: bool


class PatternGapRow(_ApiModel):
    bucket: Literal[
        "WITHIN_WEEK", "WITHIN_TWO_WEEKS", "WITHIN_MONTH", "OVER_MONTH", "SINGLE_CONTACT"
    ]
    won: int
    failed: int
    in_progress: int
    won_ratio: float | None
    judged: bool


class PatternAnswerRow(_ApiModel):
    question_id: str
    answer_id: str
    won: int
    failed: int
    in_progress: int
    won_ratio: float | None
    judged: bool


class PatternCombo(_ApiModel):
    process_code: str | None
    industry: str | None
    region: str | None
    contacted: int
    won: int
    lost: int
    on_hold: int
    won_ratio: float | None


class PatternStandout(_ApiModel):
    table: Literal["CONTACTS_BEFORE_VISIT", "LONGEST_GAP", "ANSWER", "COMBO"]
    won: int
    failed: int
    won_ratio: float
    overall_won_ratio: float
    diff: float
    visited: bool | None = None
    bucket: str | None = None
    question_id: str | None = None
    answer_id: str | None = None
    process_code: str | None = None
    industry: str | None = None
    region: str | None = None


class PatternAnswerFill(_ApiModel):
    question_id: str
    step: str
    eligible: int
    answered: int
    ratio: float | None
    answers: list[PatternAnswerCount]
    unknown_share: float | None
    top_share: float | None


class PatternHint(_ApiModel):
    question_id: str
    kind: Literal["SAME_ANSWER", "UNKNOWN_MANY"]
    answer_id: str | None = None
    share: float | None = None


class PatternCoachEffect(_ApiModel):
    applied: int
    progressed: int
    companies: int


class SalesPatternsData(_ApiModel):
    as_of: datetime
    basis: PatternBasis
    failure: PatternFailure
    success: PatternSuccess
    contacts_before_visit: list[PatternContactRow]
    longest_gap: list[PatternGapRow]
    answer_outcomes: list[PatternAnswerRow]
    combos: list[PatternCombo]
    standouts: list[PatternStandout]
    answer_fill: list[PatternAnswerFill]
    questionnaire_hints: list[PatternHint]
    coach_effect: PatternCoachEffect


SalesPatternsEnvelope = Envelope[SalesPatternsData]


def _region_label(address: str | None, presets) -> str | None:
    """권역 묶음(listFilters.regionPresets) 이름, 없으면 주소의 시·군, 주소가 없으면 None."""
    city = _address_region(address)
    if city is None:
        return None
    return next((preset.label for preset in presets if city in preset.cities), city)


def _pattern_company(session: Session, row, presets, first_step: str) -> PatternCompany:
    outcomes, answers = live_outcomes_with_answers(session, row.opp_id)
    steps = _steps_after(session, row.opp_id)
    by_outcome: dict[str, list[tuple[str, str]]] = {}
    for answer in answers:
        by_outcome.setdefault(answer.outcome_id, []).append((answer.question_id, answer.answer_id))
    lines: list[PatternLine] = []
    before: str | None = first_step
    for outcome in outcomes:
        after = steps.get(outcome.outcome_id)
        lines.append(
            PatternLine(
                day=outcome.attempted_at or outcome.created_at.astimezone(KST).date(),
                method=outcome.method,
                result=outcome.result,
                status=outcome.status,
                step_before=before,
                step_after=after,
                answers=tuple(by_outcome.get(outcome.outcome_id, [])),
            )
        )
        before = after or before
    address = session.scalar(
        select(Customer.address)
        .join(Opportunity, Opportunity.customer_id == Customer.customer_id)
        .where(Opportunity.opp_id == row.opp_id)
    )
    coach_days = tuple(
        note.created_at.astimezone(KST).date()
        for note in session.scalars(
            select(Note).where(
                Note.opp_id == row.opp_id,
                Note.kind == CHANGE_KIND,
                Note.cancelled_at.is_(None),
                Note.text.endswith(COACH_SUGGESTION_SUFFIX),
            )
        )
    )
    return PatternCompany(
        opp_id=row.opp_id,
        outcome_status=row.outcome_status,
        furthest_step=row.furthest_step,
        process_codes=tuple(row.process_codes),
        industries=tuple(row.industries),
        region=_region_label(address, presets),
        lost_reason_code=row.lost_reason_code,
        lines=tuple(lines),
        coach_days=coach_days,
    )


def _patterns_from(session: Session, runtime, settings, period, result):
    """#820 펼친 표 계산(패턴 경로와 AI 분석 피드백 #824가 함께 쓴다)."""
    questions = sales_questions(session)
    first_step = STEP_ORDER[0].value
    presets = runtime.app_settings.list_filters.region_presets
    companies = [_pattern_company(session, row, presets, first_step) for row in result.companies]
    return build_sales_patterns(
        companies,
        questions=[
            QuestionInfo(
                question_id=question.id,
                step=question.step if isinstance(question.step, str) else question.step.value,
                choices=question.choices is not None,
                show_when=dict(question.show_when.answers) if question.show_when else {},
                decides_outcome=any(
                    answer.closes or answer.lost_reason for answer in question.answers
                ),
            )
            for question in questions.questions
        ],
        step_order=[step.value for step in STEP_ORDER],
        lost_reason_order=[code.value for code in LostReasonCode],
        min_sample_for_ratio=settings.min_sample_for_ratio,
        period=(result.basis.period_from, result.basis.period_to) if period is not None else None,
    )


@router.get("/sales-analysis/patterns", response_model=SalesPatternsEnvelope)
def sales_patterns(
    session: SessionDep,
    period_from: Annotated[str | None, Query(alias="from")] = None,
    period_to: Annotated[str | None, Query(alias="to")] = None,
):
    """#802·#820: 기록을 펼쳐 센다(기준 숫자 없음, 표본 기준은 salesAnalysis 하나).

    영업 분석표와 같은 대상·기간 규칙.
    """
    period, runtime, settings, dataset_kind, now, _companies, result = _analysis_inputs(
        session, period_from, period_to
    )
    patterns = _patterns_from(session, runtime, settings, period, result)
    data = SalesPatternsData.model_validate(
        {"as_of": result.as_of, **asdict(patterns)}, from_attributes=False
    )
    return SalesPatternsEnvelope(
        data=data,
        meta=Meta(
            updated_at=now,
            dataset_kind=dataset_kind,
            has_virtual_data=bool(result.companies)
            and dataset_kind == DatasetKind.VIRTUAL_REVIEWED,
        ),
    )


# ---------------------------------------------------------------------------
# #824: AI 분석 피드백 (GET·POST /sales-analysis/feedback). 숫자 표만 외부 AI로 보낸다.
# ---------------------------------------------------------------------------


class FeedbackClaim(_ApiModel):
    text: str
    evidence: list[str]


class FeedbackFailure(_ApiModel):
    where: list[FeedbackClaim]
    why: list[FeedbackClaim]
    signals: list[FeedbackClaim]
    vs_success: list[FeedbackClaim]
    next: list[FeedbackClaim]


class FeedbackSuccess(_ApiModel):
    where: list[FeedbackClaim]
    why: list[FeedbackClaim]
    signals: list[FeedbackClaim]


class FeedbackCompareRow(_ApiModel):
    key: Literal["CONTACTED", "WON", "LOST", "ON_HOLD", "IN_PROGRESS"]
    current: int
    previous: int


class FeedbackCompared(_ApiModel):
    previous_from: date
    previous_to: date
    rows: list[FeedbackCompareRow]


class AnalysisFeedbackView(_ApiModel):
    feedback_id: str
    period_from: date | None
    period_to: date | None
    generated_at: datetime
    generated_by: str
    model: str | None
    prompt_version: str
    input_hash: str
    cost_usd: float | None
    failure: FeedbackFailure
    success: FeedbackSuccess
    next: list[FeedbackClaim]
    held_back: list[str]
    compared_to_previous: FeedbackCompared | None
    ai_generated: Literal[True] = True


class FeedbackState(_ApiModel):
    feedback: AnalysisFeedbackView | None
    current: bool
    switch_on: bool


class FeedbackResult(_ApiModel):
    feedback: AnalysisFeedbackView
    reused: bool


class FeedbackRequest(_RequestModel):
    period_from: date | None = Field(default=None, alias="from")
    period_to: date | None = Field(default=None, alias="to")
    refresh: bool = False


@dataclass(frozen=True)
class _FeedbackInputs:
    period: tuple[date | None, date | None] | None
    dataset_kind: object
    text: str
    input_hash: str
    instructions: str
    prompt_version: str
    opp_ids: list[str]
    compared: dict | None
    switch_on: bool
    assistant: object
    now: datetime


def _feedback_inputs(
    session: Session, period_from: str | None, period_to: str | None
) -> _FeedbackInputs:
    period, runtime, settings, dataset_kind, now, _companies, result = _analysis_inputs(
        session, period_from, period_to
    )
    patterns = _patterns_from(session, runtime, settings, period, result)
    labels = feedback.Labels.from_questions(sales_questions(session))
    previous = None
    span = feedback.previous_period(*period) if period is not None else None
    if span is not None:
        *_, previous_result = _analysis_inputs(session, span[0].isoformat(), span[1].isoformat())
        previous = (span, feedback.totals(previous_result))
    instructions, version = feedback.load_prompt()
    text = feedback.build_input_text(
        period=period, patterns=patterns, result=result, labels=labels, previous=previous
    )
    llm = runtime.app_settings.llm
    return _FeedbackInputs(
        period=period,
        dataset_kind=dataset_kind,
        text=text,
        input_hash=feedback.input_hash(text, version),
        instructions=instructions,
        prompt_version=version,
        opp_ids=[row.opp_id for row in result.companies],
        compared=feedback.compared(feedback.totals(result), previous),
        switch_on=bool(llm.sales_records_enabled and llm.mode == "EXTERNAL"),
        assistant=runtime.app_settings.assistant,
        now=now,
    )


def _saved_feedback(session: Session, inputs: _FeedbackInputs) -> AnalysisFeedback | None:
    period_from, period_to = inputs.period if inputs.period is not None else (None, None)
    query = select(AnalysisFeedback).where(
        AnalysisFeedback.dataset_kind == inputs.dataset_kind.value,
        AnalysisFeedback.period_from.is_(None)
        if period_from is None
        else AnalysisFeedback.period_from == period_from,
        AnalysisFeedback.period_to.is_(None)
        if period_to is None
        else AnalysisFeedback.period_to == period_to,
    )
    return session.scalars(
        query.order_by(AnalysisFeedback.created_at.desc(), AnalysisFeedback.feedback_id.desc())
    ).first()


def _feedback_view(row: AnalysisFeedback) -> AnalysisFeedbackView:
    return AnalysisFeedbackView.model_validate(
        {
            **row.response,
            "feedbackId": row.feedback_id,
            "periodFrom": row.period_from,
            "periodTo": row.period_to,
            "generatedAt": row.created_at,
            "generatedBy": row.created_by,
            "model": row.model,
            "promptVersion": row.prompt_version,
            "inputHash": row.input_hash,
            "costUsd": float(row.cost_usd) if row.cost_usd is not None else None,
        }
    )


def _feedback_meta(inputs: _FeedbackInputs) -> Meta:
    return Meta(
        updated_at=inputs.now,
        dataset_kind=inputs.dataset_kind,
        has_virtual_data=inputs.dataset_kind == DatasetKind.VIRTUAL_REVIEWED,
    )


@router.get("/sales-analysis/feedback", response_model=Envelope[FeedbackState])
def sales_feedback(
    session: SessionDep,
    period_from: Annotated[str | None, Query(alias="from")] = None,
    period_to: Annotated[str | None, Query(alias="to")] = None,
):
    """#824 저장본 읽기. AI·외부 호출 없음. current = 지금 기록으로 만든 입력과 같은지."""
    inputs = _feedback_inputs(session, period_from, period_to)
    row = _saved_feedback(session, inputs)
    return Envelope[FeedbackState](
        data=FeedbackState(
            feedback=_feedback_view(row) if row is not None else None,
            current=row is not None and row.input_hash == inputs.input_hash,
            switch_on=inputs.switch_on,
        ),
        meta=_feedback_meta(inputs),
    )


@router.post("/sales-analysis/feedback", response_model=Envelope[FeedbackResult])
def request_sales_feedback(
    body: FeedbackRequest,
    request: Request,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    """#824 [분석 받기 💰]. 숫자 표 글만 영업 기록 문(SALES_ANALYSIS)을 거쳐 한 번 보내고 저장한다.

    같은 기간·같은 입력의 저장본이 있으면 refresh가 아닌 한 AI를 부르지 않는다. 세션은 AI를 기다리는
    동안 붙들지 않는다(영업 비서와 같은 방식).
    """
    period_from = body.period_from.isoformat() if body.period_from else None
    period_to = body.period_to.isoformat() if body.period_to else None
    with contextmanager(get_session)(request) as session:
        staff = require_staff(session, staff_key)
        inputs = _feedback_inputs(session, period_from, period_to)
        row = _saved_feedback(session, inputs)
        if row is not None and row.input_hash == inputs.input_hash and not body.refresh:
            return Envelope[FeedbackResult](
                data=FeedbackResult(feedback=_feedback_view(row), reused=True),
                meta=_feedback_meta(inputs),
            )
    if inputs.assistant is None:
        # 한도 숫자를 코드에서 지어내지 않는다(규칙 ⑩).
        raise RunFailedError(
            "영업 비서 기준(assistant)이 설정에 없습니다. 앱 설정 파일을 확인해 주세요."
        )
    if not inputs.opp_ids:
        raise AppError(
            "이 기간에 접촉 기록이 없어 분석할 자료가 없습니다.",
            "기간을 넓히거나 접촉 기록을 남긴 뒤 다시 받아 주세요.",
            status=422,
            kind="ASSISTANT_NO_RECORDS",
        )
    # 숫자 표 글이지만 질문 파일 문구가 섞인다. 전화·이메일 모양이 하나라도 있으면 보내지 않는다.
    if find_contact(inputs.text):
        raise AppError(
            "보낼 분석 글에 연락처 모양이 있어 보내지 않았습니다.",
            "질문 파일 문구에 전화·이메일이 들어 있지 않은지 확인해 주세요.",
            status=422,
            kind="CONTACT_IN_INPUT",
        )
    if (
        sales_record_calls_today(record_kind=SALES_ANALYSIS_KIND)
        >= inputs.assistant.daily_question_limit
    ):
        raise AppError(
            "오늘 분석 받기 한도를 넘었습니다.",
            "내일 다시 받아 주세요.",
            status=503,
            kind="ASSISTANT_LIMIT",
        )
    answer, ticket = analyze_sales(
        inputs.opp_ids[0],
        [scrub_sales_record(inputs.text)],
        instructions=inputs.instructions,
        max_output_tokens=inputs.assistant.max_output_tokens,
        requested_by=staff,
        schema_name=feedback.SCHEMA_NAME,
        schema=feedback.feedback_schema(),
    )
    try:
        reading = feedback.FeedbackReading.model_validate_json(answer)
    except ValueError:
        raise AppError(
            "AI 분석 답의 형식이 맞지 않습니다.",
            "잠시 뒤 다시 받아 주세요.",
            status=503,
            kind="LLM_FAILED",
        ) from None
    response = {**feedback.clean_reading(reading), "comparedToPrevious": inputs.compared}
    period_from_day, period_to_day = inputs.period if inputs.period is not None else (None, None)
    with contextmanager(get_session)(request) as session:
        log = session.get(TransferLog, ticket.log_id)
        saved = AnalysisFeedback(
            feedback_id=new_id("feedback"),
            period_from=period_from_day,
            period_to=period_to_day,
            input_hash=inputs.input_hash,
            prompt_version=inputs.prompt_version,
            model=ticket.llm.model,
            response=response,
            cost_usd=log.cost_usd if log is not None else None,
            transfer_log_id=ticket.log_id,
            created_by=staff,
            dataset_kind=inputs.dataset_kind.value,
            is_virtual=inputs.dataset_kind == DatasetKind.VIRTUAL_REVIEWED,
        )
        session.add(saved)
        session.flush()
        view = _feedback_view(saved)
    return Envelope[FeedbackResult](
        data=FeedbackResult(feedback=view, reused=False),
        meta=_feedback_meta(inputs),
    )
