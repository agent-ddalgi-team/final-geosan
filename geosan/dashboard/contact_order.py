"""추천 목록의 근거 상태 묶음과 묶음 안 순서 (계약 C1 `sort=contact`·카드 `bucket`·`rankAdjust`).

"근거 있음 / 근거 조금 / 홈페이지 없음 / 조사 전 / 끝난 회사" 묶음(#675, PM 결정 2026-11-13 —
#610의 "지금 연락할 곳 / 확인 필요 / 나중"을 바꿈), 그 묶음에 든 이유, 영업 결과로 올리거나 내리는
조정 단계(#610)를 계산한다. 모두 받은 값만 쓰는 순수 함수다. 저장하지 않고 목록을 읽을 때마다
계산한다.

바꾸지 않는 것: 부록 F 점수(E·P·S·R)·분류·기존 순위(original_rank)·기본 정렬(`sort=rank`).
필수 판정도 건너뛰지 않는다: 필수 탈락·제외 의견·거래 중·성사·거절·보류인 회사는 근거가 많아도
맨 아래 "끝난 회사" 묶음이다.

기준 숫자는 앱 설정 `contactList`에서 받아 온다(규칙 ⑩). 성사·거절은 영업 분석표
(`sales_analysis.py`)와 같은 함수로 세어 두 화면의 숫자가 서로 맞는다.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, tzinfo

from geosan.dashboard.sales_analysis import STATUS_WON, CompanyRecords, summarize_company

EVIDENCE_READY = "EVIDENCE_READY"
EVIDENCE_SOME = "EVIDENCE_SOME"
NO_HOMEPAGE = "NO_HOMEPAGE"
NOT_RESEARCHED = "NOT_RESEARCHED"
CLOSED = "CLOSED"
# 적은 순서가 목록의 큰 순서다. 끝난 회사가 맨 아래.
BUCKETS: tuple[str, ...] = (EVIDENCE_READY, EVIDENCE_SOME, NO_HOMEPAGE, NOT_RESEARCHED, CLOSED)

# 끝난 회사의 이유(#610의 "나중" 앞 네 줄 그대로).
EXCLUDED_OPINION = "EXCLUDED_OPINION"
REQUIRED_FAILED = "REQUIRED_FAILED"
EXISTING_CUSTOMER = "EXISTING_CUSTOMER"
CLOSED_OR_HOLD = "CLOSED_OR_HOLD"
# 근거 상태의 이유(#675).
EVIDENCE_ENOUGH = "EVIDENCE_ENOUGH"
EVIDENCE_FEW = "EVIDENCE_FEW"
HOMEPAGE_ONLY = "HOMEPAGE_ONLY"
HOMEPAGE_NOT_FOUND = "HOMEPAGE_NOT_FOUND"
RESEARCH_NOT_RUN = "RESEARCH_NOT_RUN"

_OPINION_EXCLUDED = "NOT_TARGET"
# 계약 C0의 코드값. 이 부품은 규칙·설정 부품을 가져오지 않아서(`queries.py`와 같은 방식) 글자 그대로
# 적는다. 코드표 전체가 필요한 것(거절 이유 순서)과 시간대는 창구가 인자로 넘긴다.
_STAGES_CLOSED_OR_HOLD = frozenset({"WON", "LOST", "ON_HOLD"})
_CLASS_FILTER_EXCLUDED = "FILTER_EXCLUDED"
_CLASS_CONTACT_REVIEW = "CONTACT_REVIEW"
_RELATION_EXISTING = "EXISTING_CONFIRMED"
_HOMEPAGE_NOT_FOUND = "NOT_FOUND"
_FIT_HIGH = "HIGH"
# 부록 F의 접촉 분류 순서(지금 바로 → 계획 → 확인 후 → 그 밖). 규칙 엔진의 정렬 묶음과 같은 순서.
_CONTACT_CLASS_ORDER = {"CONTACT_URGENT": 0, "CONTACT_PLANNED": 1, _CLASS_CONTACT_REVIEW: 2}
_OTHER_CLASS_ORDER = len(_CONTACT_CLASS_ORDER)
_FIT_ORDER = {_FIT_HIGH: 0, "MEDIUM": 1, "LOW": 2}


# ---------------------------------------------------------------------------
# 묶음 정하기
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CompanyState:
    """묶음을 정할 때 보는 회사 한 곳의 지금 상태. 모두 이미 저장된 값이다."""

    opinion: str | None  # 최신 검토 의견
    classification_code: str
    relation_status: str
    outcome_status: str | None  # 최신 영업 단계
    fit_level: str | None
    evidence_count: int  # 살아 있는 근거 수(교체되지 않았고 처리 금지가 아닌 것)
    homepage_url: str | None
    homepage_status: str | None  # 홈페이지 찾기 결과. 아직 안 찾았으면 None


def assign_bucket(state: CompanyState, *, evidence_ready_min: int) -> tuple[str, str]:
    """(묶음, 그 묶음에 든 이유). 위에서부터 처음 맞는 줄 하나로 정한다.

    앞의 네 줄(끝난 회사)은 근거 수를 보지 않는다. 필수 판정을 근거 수로 건너뛰지 않기 위해서다.
    """
    if state.opinion == _OPINION_EXCLUDED:
        return CLOSED, EXCLUDED_OPINION
    if state.classification_code == _CLASS_FILTER_EXCLUDED:
        return CLOSED, REQUIRED_FAILED
    if state.relation_status == _RELATION_EXISTING:
        return CLOSED, EXISTING_CUSTOMER
    if state.outcome_status in _STAGES_CLOSED_OR_HOLD:
        return CLOSED, CLOSED_OR_HOLD
    if state.evidence_count >= evidence_ready_min:
        return EVIDENCE_READY, EVIDENCE_ENOUGH
    if state.evidence_count > 0:
        return EVIDENCE_SOME, EVIDENCE_FEW
    if state.homepage_status == _HOMEPAGE_NOT_FOUND:
        return NO_HOMEPAGE, HOMEPAGE_NOT_FOUND
    if state.homepage_url:
        return EVIDENCE_SOME, HOMEPAGE_ONLY
    return NOT_RESEARCHED, RESEARCH_NOT_RUN


# ---------------------------------------------------------------------------
# 영업 결과 조정
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AdjustRule:
    """설정 `contactList.adjust` 값 그대로."""

    window_days: int
    min_closed_count: int
    won_per_step: int
    max_up: int
    lost_per_step: int
    max_down: int
    lost_reasons_counted: frozenset[str]


@dataclass(frozen=True)
class ClosedResult:
    """기간 안에 성사 또는 거절로 끝난 회사 한 곳."""

    opp_id: str
    process_codes: frozenset[str]
    industries: frozenset[str]
    won: bool
    lost_reason_code: str | None


@dataclass(frozen=True)
class RankAdjust:
    level: int
    process_code: str
    process_name: str
    industry: str
    won_count: int
    lost_count: int  # 센 거절 수
    counted_lost_reasons: list[str]
    window_days: int


def closed_results(
    companies: Sequence[CompanyRecords], *, window_days: int, now: datetime, tz: tzinfo
) -> list[ClosedResult]:
    """영업 분석표와 같은 기준으로 최근 성사·거절 회사만 고른다.

    접촉 시도가 있는 회사만 세고, 결과 기록 시각(성사·거절로 처음 바뀐 행)이 기간 안이어야 한다.
    """
    oldest = now - timedelta(days=window_days)
    today = now.astimezone(tz).date()
    results = []
    for company in companies:
        row = summarize_company(company, today, tz=tz)
        if row is None or row.closed_at is None or row.closed_at < oldest:
            continue
        results.append(
            ClosedResult(
                opp_id=row.opp_id,
                process_codes=frozenset(row.process_codes),
                industries=frozenset(row.industries),
                won=row.outcome_status == STATUS_WON,
                lost_reason_code=row.lost_reason_code,
            )
        )
    return results


def adjustment_for(
    opp_id: str,
    process_codes: Collection[str],
    industries: Collection[str],
    results: Sequence[ClosedResult],
    *,
    rule: AdjustRule,
    processes: Sequence[tuple[str, str]],
    industry_order: Sequence[str],
    lost_reason_order: Sequence[str],
) -> RankAdjust | None:
    """이 회사를 뺀 같은 공정 × 산업군 회사들의 성사·거절로 조정 단계를 정한다.

    `processes`는 역량 파일 순서의 (코드, 이름), `industry_order`는 설정 순서다. 표본(성사 + 센
    거절)이 가장 많은 쌍 하나만 쓰고, 동수면 공정 순 → 산업 순으로 앞선 쌍을 쓴다. 표본이
    기준보다 적으면 조정하지 않는다(None).
    """
    others = [row for row in results if row.opp_id != opp_id]
    reason_order = {code: index for index, code in enumerate(lost_reason_order)}
    ordered_industries = [name for name in industry_order if name in industries] + sorted(
        name for name in industries if name not in industry_order
    )
    best: tuple[int, list[ClosedResult], list[ClosedResult], str, str, str] | None = None
    for code, name in processes:
        if code not in process_codes:
            continue
        for industry in ordered_industries:
            members = [
                row for row in others if code in row.process_codes and industry in row.industries
            ]
            won = [row for row in members if row.won]
            lost = [
                row
                for row in members
                if not row.won and row.lost_reason_code in rule.lost_reasons_counted
            ]
            sample = len(won) + len(lost)
            # 순서대로 돌므로 표본이 더 많을 때만 바꾸면 동수는 앞선 쌍이 남는다.
            if best is None or sample > best[0]:
                best = (sample, won, lost, code, name, industry)
    if best is None or best[0] < rule.min_closed_count:
        return None
    _, won, lost, code, name, industry = best
    up = min(rule.max_up, len(won) // rule.won_per_step)
    down = min(rule.max_down, len(lost) // rule.lost_per_step)
    return RankAdjust(
        level=up - down,
        process_code=code,
        process_name=name,
        industry=industry,
        won_count=len(won),
        lost_count=len(lost),
        counted_lost_reasons=sorted(
            {row.lost_reason_code for row in lost},
            key=lambda reason: reason_order.get(reason, len(reason_order)),
        ),
        window_days=rule.window_days,
    )


# ---------------------------------------------------------------------------
# 묶음 안 순서
# ---------------------------------------------------------------------------


def contact_order_key(
    *,
    bucket: str,
    state: CompanyState,
    null_fit_level_as: str,
    level: int,
    valid_until: date | None,
    timing_met_count: int,
    score_t: int,
    base_position: int,
) -> tuple:
    """`sort=contact`의 정렬 키. 작은 값이 앞이다.

    묶음 → 공정 적합도(상 → 중 → 하, 없으면 설정 값) → 지금 순서(`base_position`).
    "근거 있음" 묶음만 적합도와 지금 순서 사이에 접촉 분류 → 조정 단계 → 시점 신호(유효 기한
    가까운 순 → 시점 조건 충족 수 → T 점수)를 더 본다. 다른 묶음은 점수를 매길 근거가 모자라
    점수·분류·영업 결과 조정으로 순서를 가르지 않는다(#675).
    마지막 키가 추천 순의 자리 번호라 같은 입력이면 늘 같은 순서가 나온다.
    """
    fit = _FIT_ORDER[state.fit_level or null_fit_level_as]
    if bucket != EVIDENCE_READY:
        return (BUCKETS.index(bucket), fit, 0, 0, date.max, 0, 0, base_position)
    return (
        BUCKETS.index(bucket),
        fit,
        _CONTACT_CLASS_ORDER.get(state.classification_code, _OTHER_CLASS_ORDER),
        -level,
        valid_until or date.max,
        -timing_met_count,
        -score_t,
        base_position,
    )
