"""#549: 고른 조건에 맞는 공장 수와 누르기 전 예상 금액·잠금(약속 C1 GET /ingest/preview).

AI·웹 검색·공장등록 조회를 부르지 않고 아무것도 저장하지 않는다(0원). 후보 찾기 실행과
같은 기준을 쓴다: 지역 추리기(#521), 판단 재사용(최신 기준·같은 생산품 지문), 조건
거르기(select_candidates), 같은 회사 가리기(이름·주소, #528). 예상 금액의 단가는 설정
ingestion.costEstimate에서 읽고, 이번 달 사용액은 전송 보호의 월 합과 같은 계산을 쓴다.

#752: 고른 지역의 공장 행·최신 판단·판단 지문 비교는 충남처럼 만 곳이 넘으면 몇 초 걸린다.
공정·산업을 바꿀 때마다 다시 읽지 않도록 이 "지역 바탕"을 프로세스 안에 기억해 둔다.
기억의 열쇠는 DB·지역·묶음·판단 기준 지문·자료 도장(공장 행·판단·팩토리온 행의 건수와
마지막 적재 시각)이라 자료가 새로 들어오거나 기준이 바뀌면 다시 읽는다. 동시에 들어온
요청은 한 번만 읽고 나머지는 그 결과를 쓴다. 이미 들어온 회사(목록)는 매번 새로 센다.
"""

from __future__ import annotations

import threading
from collections import Counter, OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

from sqlalchemy import func, select

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
from geosan.opportunity.source_models import FactoryProfile, SourceFactoryRow, public_source_kinds
from geosan.opportunity.web_candidate_store import has_cached_web_search

FIT_LEVELS = ("HIGH", "MEDIUM", "LOW")
# 지역 바탕을 몇 벌까지 기억할지. 규칙 숫자가 아니라 메모리 상한이다(지역 조합 수만큼).
_BASE_CACHE_SIZE = 8


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


@dataclass(frozen=True)
class _Judged:
    """기억해 둘 최신 판단의 거르기 칸. select_candidates가 읽는 칸만 둔다."""

    row_id: str
    is_manufacturer: bool
    process_codes: tuple[str, ...]
    industries: tuple[str, ...]
    fit_level: str | None


@dataclass(frozen=True)
class _RegionBase:
    """고른 지역의 공장 행(이름·주소)과 지금 기준·지문에 맞는 최신 판단."""

    places: dict[str, tuple[str, str]]
    current: tuple[_Judged, ...]
    row_count: int


_base_cache: OrderedDict[tuple, _RegionBase] = OrderedDict()
_base_lock = threading.Lock()


def clear_region_cache() -> None:
    """기억한 지역 바탕을 모두 버린다(시험·DB 바꾸기용)."""
    with _base_lock:
        _base_cache.clear()


def _data_stamp(session) -> tuple:
    """공장 행·판단·팩토리온 행의 건수와 마지막 적재 시각. 하나라도 바뀌면 다시 읽는다."""
    rows = session.execute(
        select(
            func.count(),
            func.max(SourceFactoryRow.loaded_at),
            func.max(SourceFactoryRow.missing_since),
        ).select_from(SourceFactoryRow)
    ).one()
    judged = session.execute(
        select(func.count(), func.max(StoredJudgment.created_at)).select_from(StoredJudgment)
    ).one()
    profiles = session.execute(
        select(func.count(), func.max(FactoryProfile.loaded_at)).select_from(FactoryProfile)
    ).one()
    return (tuple(rows), tuple(judged), tuple(profiles))


def _read_region_base(session, regions: Sequence[str], dataset_kind: str, version: str):
    """고른 지역의 공장 행을 읽고, 기준·생산품 지문이 맞는 최신 판단만 남긴다."""
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
    current = tuple(
        _Judged(
            row_id=row_id,
            is_manufacturer=judgment.is_manufacturer,
            process_codes=tuple(judgment.process_codes or ()),
            industries=tuple(judgment.industries or ()),
            fit_level=judgment.fit_level,
        )
        for row_id, judgment in latest.items()
        if judgment.product_hash == inputs[row_id].product_hash(by_id[row_id].product)
    )
    places = {row.row_id: (row.company_name, row.address) for row in rows}
    return _RegionBase(places=places, current=current, row_count=len(rows))


def _region_base(session, regions: Sequence[str], dataset_kind: str) -> _RegionBase:
    """기억한 지역 바탕을 쓰고, 없거나 자료·기준이 바뀌었으면 한 번만 다시 읽는다."""
    key = (
        str(session.get_bind().url),
        tuple(sorted(regions)),
        dataset_kind,
        current_criteria_version(session),
        _data_stamp(session),
    )
    with _base_lock:
        base = _base_cache.get(key)
        if base is not None:
            _base_cache.move_to_end(key)
            return base
        base = _read_region_base(session, regions, dataset_kind, key[3])
        _base_cache[key] = base
        while len(_base_cache) > _BASE_CACHE_SIZE:
            _base_cache.popitem(last=False)
        return base


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
    base = _region_base(session, regions, dataset_kind)
    matched = select_candidates(base.current, process_codes=process_codes, industries=industries)
    known = registered_company_keys(session, is_virtual=is_virtual)
    fresh = [item for item in matched if company_key(*base.places[item.row_id]) not in known]
    fits = Counter(item.fit_level for item in matched)
    unjudged = base.row_count - len(base.current)
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
        row_count=base.row_count,
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
