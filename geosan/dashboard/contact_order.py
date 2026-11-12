"""추천 목록의 세 묶음과 묶음 안 순서 (계약 C1 `sort=contact`·카드 `bucket`·`rankAdjust`, #610).

"지금 연락할 곳 / 확인 필요 / 나중" 묶음, 그 묶음에 든 이유, 영업 결과로 올리거나 내리는 조정
단계를 계산한다. 모두 받은 값만 쓰는 순수 함수다. 저장하지 않고 목록을 읽을 때마다 계산한다.

바꾸지 않는 것: 부록 F 점수(E·P·S·R)·분류·기존 순위(original_rank)·기본 정렬(`sort=rank`).
필수 판정도 건너뛰지 않는다: 필수 탈락·제외 의견·거래 중인 회사는 설정과 무관하게
"지금 연락할 곳"에 들지 않는다.

기준 숫자와 분류 목록은 앱 설정 `contactList`에서 받아 온다(규칙 ⑩). 성사·거절은 영업 분석표
(`sales_analysis.py`)와 같은 함수로 세어 두 화면의 숫자가 서로 맞는다.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from geosan.dashboard.sales_analysis import KST, CompanyRecords, summarize_company
from geosan.rules.codes import (
    ClassificationCode,
    FitLevel,
    LostReasonCode,
    OutcomeStatus,
    RelationStatus,
    SortGroup,
)

NOW = "NOW"
CHECK = "CHECK"
LATER = "LATER"
BUCKETS: tuple[str, ...] = (NOW, CHECK, LATER)

EXCLUDED_OPINION = "EXCLUDED_OPINION"
REQUIRED_FAILED = "REQUIRED_FAILED"
EXISTING_CUSTOMER = "EXISTING_CUSTOMER"
CLOSED_OR_HOLD = "CLOSED_OR_HOLD"
IN_PROGRESS = "IN_PROGRESS"
NEED_CHECK_OPINION = "NEED_CHECK_OPINION"
REQUIRED_PENDING = "REQUIRED_PENDING"
OWN_PLATING = "OWN_PLATING"
NOT_EVALUATED_HIGH_FIT = "NOT_EVALUATED_HIGH_FIT"
NOT_EVALUATED_LOWER_FIT = "NOT_EVALUATED_LOWER_FIT"
EVIDENCE_RECHECK = "EVIDENCE_RECHECK"
REQUIRED_PASSED = "REQUIRED_PASSED"
MONITOR = "MONITOR"

_OPINION_EXCLUDED = "NOT_TARGET"
_OPINION_NEED_CHECK = "NEED_CHECK"
_STAGES_CLOSED_OR_HOLD = frozenset({OutcomeStatus.WON, OutcomeStatus.LOST, OutcomeStatus.ON_HOLD})
_STAGES_IN_PROGRESS = frozenset(
    {OutcomeStatus.IN_PROGRESS, OutcomeStatus.SAMPLE_OR_REGISTRATION_APPROVED}
)
_PENDING_CLASSES = frozenset({ClassificationCode.FILTER_PENDING, ClassificationCode.OPS_PENDING})
# 부록 F의 접촉 분류 순서(지금 바로 → 계획 → 확인 후 → 그 밖). 규칙 엔진의 정렬 묶음과 같은 값.
_SORT_GROUPS = {
    ClassificationCode.CONTACT_URGENT: SortGroup.URGENT,
    ClassificationCode.CONTACT_PLANNED: SortGroup.PLANNED,
    ClassificationCode.CONTACT_REVIEW: SortGroup.REVIEW,
}
_GROUP_ORDER = {group: index for index, group in enumerate(SortGroup)}
_FIT_ORDER = {level: index for index, level in enumerate(FitLevel)}
_LOST_REASON_ORDER = {code.value: index for index, code in enumerate(LostReasonCode)}


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
    scored: bool  # 점수가 있는가(평가 전이면 False)
    fit_level: str | None
    own_plating: bool  # 표면처리를 직접 하는 회사일 수 있음
    core_evidence_recheck: bool
    blocks_approval: bool


def is_unevaluated(state: CompanyState) -> bool:
    return not state.scored or state.classification_code == ClassificationCode.NOT_EVALUATED


def assign_bucket(
    state: CompanyState,
    *,
    now_classifications: Collection[str],
    unscored_high_fit_to_now: bool,
) -> tuple[str, str]:
    """(묶음, 그 묶음에 든 이유). 위에서부터 처음 맞는 줄 하나로 정한다."""
    if state.opinion == _OPINION_EXCLUDED:
        return LATER, EXCLUDED_OPINION
    if state.classification_code == ClassificationCode.FILTER_EXCLUDED:
        return LATER, REQUIRED_FAILED
    if state.relation_status == RelationStatus.EXISTING_CONFIRMED:
        return LATER, EXISTING_CUSTOMER
    if state.outcome_status in _STAGES_CLOSED_OR_HOLD:
        return LATER, CLOSED_OR_HOLD
    if state.outcome_status in _STAGES_IN_PROGRESS:
        return NOW, IN_PROGRESS
    if state.opinion == _OPINION_NEED_CHECK:
        return CHECK, NEED_CHECK_OPINION
    if state.classification_code in _PENDING_CLASSES:
        return CHECK, REQUIRED_PENDING
    if is_unevaluated(state):
        if state.own_plating:
            return CHECK, OWN_PLATING
        if state.fit_level == FitLevel.HIGH:
            return (NOW if unscored_high_fit_to_now else CHECK), NOT_EVALUATED_HIGH_FIT
        return LATER, NOT_EVALUATED_LOWER_FIT
    if (
        state.core_evidence_recheck
        or state.classification_code == ClassificationCode.CONTACT_REVIEW
    ):
        return CHECK, EVIDENCE_RECHECK
    if state.own_plating:
        return CHECK, OWN_PLATING
    if not state.blocks_approval and state.classification_code in now_classifications:
        return NOW, REQUIRED_PASSED
    return LATER, MONITOR


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
    companies: Sequence[CompanyRecords], *, window_days: int, now: datetime
) -> list[ClosedResult]:
    """영업 분석표와 같은 기준으로 최근 성사·거절 회사만 고른다.

    접촉 시도가 있는 회사만 세고, 결과 기록 시각(성사·거절로 처음 바뀐 행)이 기간 안이어야 한다.
    """
    oldest = now - timedelta(days=window_days)
    today = now.astimezone(KST).date()
    results = []
    for company in companies:
        row = summarize_company(company, today)
        if row is None or row.closed_at is None or row.closed_at < oldest:
            continue
        results.append(
            ClosedResult(
                opp_id=row.opp_id,
                process_codes=frozenset(row.process_codes),
                industries=frozenset(row.industries),
                won=row.outcome_status == OutcomeStatus.WON,
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
) -> RankAdjust | None:
    """이 회사를 뺀 같은 공정 × 산업군 회사들의 성사·거절로 조정 단계를 정한다.

    `processes`는 역량 파일 순서의 (코드, 이름), `industry_order`는 설정 순서다. 표본(성사 + 센
    거절)이 가장 많은 쌍 하나만 쓰고, 동수면 공정 순 → 산업 순으로 앞선 쌍을 쓴다. 표본이
    기준보다 적으면 조정하지 않는다(None).
    """
    others = [row for row in results if row.opp_id != opp_id]
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
            key=lambda reason: _LOST_REASON_ORDER.get(reason, len(_LOST_REASON_ORDER)),
        ),
        window_days=rule.window_days,
    )


# ---------------------------------------------------------------------------
# 묶음 안 순서
# ---------------------------------------------------------------------------


def contact_order_key(
    *,
    bucket: str,
    basis: str,
    state: CompanyState,
    null_fit_level_as: str,
    level: int,
    valid_until: date | None,
    timing_met_count: int,
    score_t: int,
    base_position: int,
) -> tuple:
    """`sort=contact`의 정렬 키. 작은 값이 앞이다.

    묶음 → (평가 전 + 표면처리 직접 표시는 묶음 맨 뒤) → 접촉 분류 → 공정 적합도 → 조정 단계 →
    시점 신호(유효 기한 가까운 순 → 시점 조건 충족 수 → T 점수) → 지금 순서(`base_position`).
    마지막 키가 추천 순의 자리 번호라 같은 입력이면 늘 같은 순서가 나온다.
    """
    group = _SORT_GROUPS.get(state.classification_code, SortGroup.OTHER)
    fit = state.fit_level or null_fit_level_as
    return (
        BUCKETS.index(bucket),
        basis == OWN_PLATING and is_unevaluated(state),
        _GROUP_ORDER[group],
        _FIT_ORDER[fit],
        -level,
        valid_until or date.max,
        -timing_met_count,
        -score_t,
        base_position,
    )
