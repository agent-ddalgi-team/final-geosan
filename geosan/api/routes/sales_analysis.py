"""영업 분석표 경로 (U7, 계약 C1 `GET /sales-analysis`, #608). 응답 모양은 이 파일에 둔다.

읽기 전용이다: 저장·외부 호출이 없고 보기 전용 계정도 본다. 영업 기록에서 나온 내부 전용
화면이라 엑셀·질문 목록·외부 AI로 내보내지 않는다(계약 C4). 응답에는 코드값·건수·날짜·회사
이름만 있고 메모 글·사람 이름·연락처는 없다.
"""

from datetime import date, datetime

from fastapi import APIRouter
from pydantic import Field

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.process_catalog import load_process_catalog
from geosan.api.routes.records import sales_step_state
from geosan.api.schemas import ContactCount, Envelope, Meta, _ApiModel
from geosan.config.errors import RunFailedError
from geosan.dashboard.sales_analysis import (
    build_sales_analysis,
    load_company_records,
    process_display_name,
)
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


class ProcessRow(GroupStats):
    process_code: str | None
    process_name: str
    by_industry: list[IndustryRow]


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


SalesAnalysisEnvelope = Envelope[SalesAnalysis]


def _stats(stats) -> dict:
    return GroupStats.model_validate(stats, from_attributes=True).model_dump()


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
    )
    data = SalesAnalysis(
        as_of=result.as_of,
        basis=AnalysisBasis.model_validate(result.basis, from_attributes=True),
        by_process=[
            ProcessRow(
                process_code=row.process_code,
                process_name=row.process_name,
                by_industry=[
                    IndustryRow(industry=item.industry, **_stats(item.stats))
                    for item in row.by_industry
                ],
                **_stats(row.stats),
            )
            for row in result.by_process
        ],
        companies=[
            CompanyRow.model_validate(row, from_attributes=True) for row in result.companies
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
