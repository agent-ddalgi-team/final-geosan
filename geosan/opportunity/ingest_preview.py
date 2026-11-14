"""#549: 고른 조건에 맞는 공장 수와 누르기 전 예상 금액·잠금(약속 C1 GET /ingest/preview).

AI·웹 검색·공장등록 조회를 부르지 않고 아무것도 저장하지 않는다(0원). 후보 찾기 실행과
같은 기준을 쓴다: 지역 추리기(#521), 판단 재사용(최신 기준·같은 생산품 지문), 조건
거르기(select_candidates), 같은 회사 가리기(이름·주소, #528). 예상 금액의 단가는 설정
ingestion.costEstimate에서 읽고, 이번 달 사용액은 전송 보호의 월 합과 같은 계산을 쓴다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

from sqlalchemy import select

from geosan.config.app_settings import AppSettings
from geosan.config.errors import AppError
from geosan.evidence.transfer import month_usage
from geosan.opportunity.candidate_judgments import select_candidates
from geosan.opportunity.candidate_pick import current_criteria_version
from geosan.opportunity.candidate_registration import company_key, registered_company_keys
from geosan.opportunity.factory_csv import parent_regions, row_in_selected_regions
from geosan.opportunity.factory_profile import ProfileIndex
from geosan.opportunity.judgment_store import _SOURCES, judgment_inputs
from geosan.opportunity.source_models import CandidateJudgment as StoredJudgment
from geosan.opportunity.source_models import SourceFactoryRow, public_source_kinds
from geosan.opportunity.web_candidate_store import has_cached_web_search

FIT_LEVELS = ("HIGH", "MEDIUM", "LOW")


@dataclass(frozen=True)
class IngestPreviewCounts:
    """맞는 공장·들어온 곳·판단 전 수. add_count는 지금 누르면 더할 최대 곳 수다."""

    matched_count: int
    fit_counts: dict[str, int]
    registered_count: int
    addable_count: int
    addable_high_count: int
    unjudged_count: int
    add_count: int
    row_count: int = 0
    """고른 지역의 공장 행 전체 수. 다시 판단(--rejudge)의 예상 금액에만 쓴다."""


def preview_counts(
    session,
    *,
    process_codes: Sequence[str],
    regions: Sequence[str],
    industries: Sequence[str],
    max_candidates: int,
    dataset_kind: str,
) -> IngestPreviewCounts:
    """검사를 마친 조건(validate_ingest_conditions 결과의 값)으로 센다."""
    is_virtual = dataset_kind == "VIRTUAL_REVIEWED"
    rows = [
        row
        for row in session.execute(
            select(
                SourceFactoryRow.row_id,
                SourceFactoryRow.region,
                SourceFactoryRow.address,
                SourceFactoryRow.company_name,
                SourceFactoryRow.product,
                SourceFactoryRow.industry_name,
            ).where(
                SourceFactoryRow.source_id.in_(sorted(_SOURCES)),
                SourceFactoryRow.region.in_(parent_regions(regions)),
                SourceFactoryRow.missing_since.is_(None),
                SourceFactoryRow.dataset_kind.in_(public_source_kinds(dataset_kind)),
                SourceFactoryRow.is_virtual == is_virtual,
            )
        )
        if row_in_selected_regions(row.region, row.address, regions)
    ]
    by_id = {row.row_id: row for row in rows}
    version = current_criteria_version(session)
    latest: dict[str, StoredJudgment] = {}
    # 행 번호를 IN으로 나열하지 않고 같은 지역 조건으로 이어 읽는다(충남은 만 곳이 넘는다).
    judged = session.scalars(
        select(StoredJudgment)
        .join(SourceFactoryRow, SourceFactoryRow.row_id == StoredJudgment.row_id)
        .where(
            StoredJudgment.criteria_version == version,
            SourceFactoryRow.region.in_(parent_regions(regions)),
            SourceFactoryRow.missing_since.is_(None),
        )
        .order_by(
            StoredJudgment.judged_at.desc(),
            StoredJudgment.created_at.desc(),
            StoredJudgment.judgment_id.desc(),
        )
    )
    for judgment in judged:
        if judgment.row_id in by_id:
            latest.setdefault(judgment.row_id, judgment)
    # 판단 때와 같은 입력(팩토리온 원자재·업종명 포함, #570)으로 지문을 비교한다.
    inputs = judgment_inputs(session, rows, index=ProfileIndex(session))
    current = [
        judgment
        for row_id, judgment in latest.items()
        if judgment.product_hash == inputs[row_id].product_hash(by_id[row_id].product)
    ]
    matched = select_candidates(current, process_codes=process_codes, industries=industries)
    known = registered_company_keys(session, is_virtual=is_virtual)
    fresh = [
        item
        for item in matched
        if company_key(by_id[item.row_id].company_name, by_id[item.row_id].address) not in known
    ]
    fits = Counter(item.fit_level for item in matched)
    unjudged = len(rows) - len(current)
    limit = max_candidates
    return IngestPreviewCounts(
        matched_count=len(matched),
        fit_counts={level: fits.get(level, 0) for level in FIT_LEVELS},
        registered_count=len(matched) - len(fresh),
        addable_count=len(fresh),
        addable_high_count=sum(item.fit_level == "HIGH" for item in fresh),
        unjudged_count=unjudged,
        # 판단 전 공장이 있으면 판단 뒤 늘 수 있어 최대 건수로 잡는다(약속 C1).
        add_count=limit if unjudged else min(limit, len(fresh)),
        row_count=len(rows),
    )


@dataclass(frozen=True)
class CostEstimate:
    """지금 누르면 들 것으로 보는 호출 수와 금액(달러). 추정이며 실제 한도 검사는 따로 한다."""

    judge_rows: int
    judge_calls: int
    judge_usd: float
    research_count: int
    research_calls: int
    research_usd: float
    web_search_usd: float
    total_usd: float


@dataclass(frozen=True)
class MonthUsage:
    used_usd: float
    limit_usd: float
    used_calls: int
    limit_calls: int


@dataclass(frozen=True)
class Blocked:
    kind: str
    judgeable_rows: int


@dataclass(frozen=True)
class IngestBudget:
    counts: IngestPreviewCounts
    estimate: CostEstimate
    month: MonthUsage
    blocked: Blocked | None


def _money(value: Decimal) -> float:
    return float(round(value, 6))


def read_month_usage(session, settings: AppSettings) -> MonthUsage:
    """이번 달 사용액·호출 수와 한도. 전송 보호의 월 합(C4)과 같은 계산이다."""
    calls, cost = month_usage(session, settings.llm)
    return MonthUsage(
        used_usd=_money(cost),
        limit_usd=settings.llm.monthly_cost_limit_usd,
        used_calls=calls,
        limit_calls=settings.llm.monthly_call_limit,
    )


def ingest_budget(
    session,
    *,
    process_codes: Sequence[str],
    regions: Sequence[str],
    industries: Sequence[str],
    max_candidates: int,
    settings: AppSettings,
    rejudge: bool = False,
) -> IngestBudget:
    """맞는 공장 수 + 예상 금액 + 이번 달 사용액 + 잠금. 화면·접수·명령이 같은 계산을 쓴다.

    rejudge(명령의 다시 판단)면 저장된 판단을 안 쓰므로 고른 지역의 공장 전체를 판단 몫으로 센다.
    """
    dataset_kind = settings.active_dataset_kind.value
    counts = preview_counts(
        session,
        process_codes=process_codes,
        regions=regions,
        industries=industries,
        max_candidates=max_candidates,
        dataset_kind=dataset_kind,
    )
    prices = settings.ingestion.cost_estimate
    judge_rows = counts.row_count if rejudge else counts.unjudged_count
    add_count = max_candidates if rejudge and judge_rows else counts.add_count
    judge_calls = -(-judge_rows // settings.ingestion.ai_pick.rows_per_call)
    judge_usd = judge_rows * Decimal(str(prices.judge_usd_per_row))
    research_count = add_count if settings.homepage_discovery.auto_research else 0
    research_calls = research_count * prices.research_calls_per_company
    research_usd = research_count * Decimal(str(prices.research_usd_per_company))
    web_search = settings.candidate_web_search.enabled and not has_cached_web_search(
        session,
        criteria={
            "processCodes": list(process_codes),
            "regions": list(regions),
            "industries": list(industries),
        },
        max_candidates=max_candidates,
        dataset_kind=dataset_kind,
        is_virtual=dataset_kind == "VIRTUAL_REVIEWED",
    )
    web_usd = Decimal(str(prices.web_search_usd_per_batch)) if web_search else Decimal(0)
    total = judge_usd + research_usd + web_usd
    estimate = CostEstimate(
        judge_rows=judge_rows,
        judge_calls=judge_calls,
        judge_usd=_money(judge_usd),
        research_count=research_count,
        research_calls=research_calls,
        research_usd=_money(research_usd),
        web_search_usd=_money(web_usd),
        total_usd=_money(total),
    )
    used_calls, used_cost = month_usage(session, settings.llm)
    limit_usd = Decimal(str(settings.llm.monthly_cost_limit_usd))
    limit_calls = settings.llm.monthly_call_limit
    month = MonthUsage(
        used_usd=_money(used_cost),
        limit_usd=settings.llm.monthly_cost_limit_usd,
        used_calls=used_calls,
        limit_calls=limit_calls,
    )
    other_calls = research_calls + (1 if web_search else 0)
    kind = None
    if used_cost + total > limit_usd:
        kind = "OVER_COST"
    elif used_calls + judge_calls + other_calls > limit_calls:
        kind = "OVER_CALLS"
    blocked = None
    if kind is not None:
        # 조사·웹 검색 몫을 먼저 뺀 남은 금액·호출로 판단할 수 있는 공장 수. 0 아래면 0.
        by_cost = (
            (limit_usd - used_cost - research_usd - web_usd)
            / Decimal(str(prices.judge_usd_per_row))
        ).to_integral_value(rounding=ROUND_FLOOR)
        by_calls = (
            limit_calls - used_calls - other_calls
        ) * settings.ingestion.ai_pick.rows_per_call
        blocked = Blocked(kind=kind, judgeable_rows=max(0, min(int(by_cost), by_calls)))
    return IngestBudget(counts=counts, estimate=estimate, month=month, blocked=blocked)


def over_budget_error() -> AppError:
    """C1: 예상 금액이 이번 달 남은 한도를 넘으면 회차를 만들지 않고 거부한다(422)."""
    return AppError(
        "이번 달 남은 AI 금액을 넘습니다",
        "시·군을 골라 나눠 진행해 주세요",
        status=422,
        kind="INGEST_OVER_BUDGET",
    )
