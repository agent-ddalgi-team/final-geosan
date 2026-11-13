"""영업 분석표 경로 (U7, 계약 C1 `GET /sales-analysis`, #608). 응답 모양은 이 파일에 둔다.

읽기 전용이다: 저장·외부 호출이 없고 보기 전용 계정도 본다. 영업 기록에서 나온 내부 전용
화면이라 엑셀·질문 목록·외부 AI로 내보내지 않는다(계약 C4). 응답에는 코드값·건수·날짜·회사
이름만 있고 메모 글·사람 이름·연락처는 없다.
"""

from datetime import date, datetime

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.process_catalog import load_process_catalog
from geosan.api.routes.records import sales_questions, sales_step_state
from geosan.api.sales_step import AnswerRow, RecordRow, compute_sales_step
from geosan.api.schemas import ContactCount, Envelope, Meta, _ApiModel
from geosan.config.errors import RunFailedError
from geosan.config.sales_questions import KST, STEP_ORDER
from geosan.dashboard.sales_analysis import (
    build_sales_analysis,
    load_company_records,
    process_display_name,
)
from geosan.records.models import Outcome, OutcomeAnswer
from geosan.rules.codes import DatasetKind, LostReasonCode, OutcomeStatus, SalesStep
from geosan.storage.base import utcnow

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


class AnalysisBasis(_ApiModel):
    min_sample_for_ratio: int
    closed_window_days: int
    company_count: int
    older_closed_excluded: int


class SalesAnalysis(_ApiModel):
    as_of: datetime
    basis: AnalysisBasis
    by_process: list[ProcessRow]
    companies: list[CompanyRow]
    # (#684) 회사를 한 번씩만 센 합계와 단계별 접촉.
    total: GroupStats
    by_sales_step: list[StepRow]


SalesAnalysisEnvelope = Envelope[SalesAnalysis]


def _stats(stats) -> dict:
    return GroupStats.model_validate(stats, from_attributes=True).model_dump()


def _steps_after(session: Session, opp_id: str) -> dict[str, str | None]:
    """(#684) 기록 행마다 그 행을 저장한 뒤의 세부 단계. 저장하지 않으므로 행마다 다시 계산한다.

    상세·카드와 같은 계산(`compute_sales_step`)을 첫 행부터 그 행까지만 넣어 부른다. 그래서 답의
    `reaches`와 [단계 고치기]가 그대로 따라온다. 지금 성사·거절이어도 그때의 단계를 보려고
    큰 단계(status)는 넘기지 않는다. 취소된 기록과 거기 달린 답은 뺀다(#253).
    """
    rows = [
        RecordRow(
            outcome_id=row.outcome_id,
            method=row.method,
            attempted_at=row.attempted_at,
            created_at=row.created_at,
            created_by=row.created_by,
            step_override=row.step_override,
        )
        for row in session.scalars(
            select(Outcome)
            .where(Outcome.opp_id == opp_id, Outcome.cancelled_at.is_(None))
            .order_by(Outcome.version)
        )
    ]
    live_ids = {row.outcome_id for row in rows}
    answers = [
        AnswerRow(row.outcome_id, row.question_id, row.answer_id)
        for row in session.scalars(
            select(OutcomeAnswer)
            .where(OutcomeAnswer.opp_id == opp_id)
            .order_by(OutcomeAnswer.created_at, OutcomeAnswer.answer_row_id)
        )
        if row.outcome_id in live_ids
    ]
    questions = sales_questions(session)
    steps: dict[str, str | None] = {}
    for index, row in enumerate(rows):
        code = compute_sales_step(rows[: index + 1], answers, questions, None).code
        steps[row.outcome_id] = code.value if code is not None else None
    return steps


@router.get("/sales-analysis", response_model=SalesAnalysisEnvelope)
def sales_analysis(session: SessionDep):
    """공정별·회사별 영업 분석표. 영업 기록만으로 계산하며 저장하지 않는다."""
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
