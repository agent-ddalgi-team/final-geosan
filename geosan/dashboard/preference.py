"""담당자 선호를 "근거 있음" 묶음 안 순서로 (#943, PM 결정 2026-11-26 되먹임 ③).

담당자가 최근에 고른 회사(관심을 직접 켬·접촉 기록)가 한 조합(공정 × 산업군, 또는 거산에서
가까운 거리)에 몰려 있으면 "순서 조정 제안"을 만든다. 관리자가 승인해야 목록 순서에 쓰인다.
점수·분류·부록 F 배점은 바꾸지 않는다. 모두 받은 값만 쓰는 순수 함수이고 저장하지 않는다.

선호만 따라가면 다른 곳의 기회를 잃을 수 있어 안전장치 3개를 둔다(PM 결정 2026-11-26).
① 그 조합의 성사율이 조합 밖보다 낮지 않을 때만 제안한다(고르기만 많고 결과가 없으면 제안 안 함).
② 승인은 기한 뒤 저절로 꺼진다(창구가 기한을 저장하고 켜진 승인만 넘긴다).
③ 근거 있음 위쪽 몇 자리 가운데 한 자리는 선호 밖 회사로 남긴다(`keep_explore_slot`).

기준 숫자는 앱 설정 `contactList.preference`에서 받는다(규칙 ⑩).
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass

PROCESS_INDUSTRY = "PROCESS_INDUSTRY"
DISTANCE = "DISTANCE"


@dataclass(frozen=True)
class CompanyTraits:
    """조합을 맞춰 볼 회사 한 곳의 값. 목록(#610)과 같은 공정 연결·산업군·저장 공공좌표 거리."""

    opp_id: str
    process_codes: frozenset[str]
    industries: frozenset[str]
    distance_km: float | None


@dataclass(frozen=True)
class Combo:
    """선호 조합 하나. 공정 × 산업군이면 두 값, 거리면 km만."""

    kind: str
    process_code: str | None = None
    industry: str | None = None
    distance_km: float | None = None

    def matches(self, company: CompanyTraits) -> bool:
        if self.kind == DISTANCE:
            return (
                company.distance_km is not None
                and self.distance_km is not None
                and company.distance_km <= self.distance_km
            )
        return self.process_code in company.process_codes and self.industry in company.industries


@dataclass(frozen=True)
class PreferenceRule:
    """설정 `contactList.preference`에서 제안에 쓰는 값."""

    min_picks: int
    min_share: float
    distance_km: float
    min_closed_for_rate: int


@dataclass(frozen=True)
class Suggestion:
    combo: Combo
    picked_count: int  # 조합 안 고른 회사
    excluded_count: int  # 조합 안 제외한 회사
    share: float  # (조합 안 고른 수 − 조합 안 제외 수) ÷ 고른 회사 수
    closed_count: int  # 조합 안 성사·거절 회사
    won_count: int
    other_closed_count: int  # 조합 밖 성사·거절 회사
    other_won_count: int


def _candidate_combos(
    picked: Sequence[CompanyTraits],
    *,
    rule: PreferenceRule,
    process_order: Sequence[str],
    industry_order: Sequence[str],
) -> list[Combo]:
    """고른 회사에 나온 공정 × 산업군 쌍(공정 목록 순 → 산업 설정 순)과 거리 하나."""
    pairs = {
        (code, name) for row in picked for code in row.process_codes for name in row.industries
    }
    process_rank = {code: index for index, code in enumerate(process_order)}
    industry_rank = {name: index for index, name in enumerate(industry_order)}
    ordered = sorted(
        pairs,
        key=lambda pair: (
            process_rank.get(pair[0], len(process_rank)),
            pair[0],
            industry_rank.get(pair[1], len(industry_rank)),
            pair[1],
        ),
    )
    combos = [Combo(PROCESS_INDUSTRY, process_code=code, industry=name) for code, name in ordered]
    combos.append(Combo(DISTANCE, distance_km=rule.distance_km))
    return combos


def _same_combo(left: Combo, right: Combo) -> bool:
    if left.kind != right.kind:
        return False
    if left.kind == DISTANCE:
        return left.distance_km == right.distance_km
    return (left.process_code, left.industry) == (right.process_code, right.industry)


def suggest(
    traits: Mapping[str, CompanyTraits],
    *,
    picked: Collection[str],
    excluded: Collection[str],
    closed: Sequence[tuple[str, bool]],
    rule: PreferenceRule,
    process_order: Sequence[str],
    industry_order: Sequence[str],
    active: Sequence[Combo] = (),
) -> list[Suggestion]:
    """제안 목록. 고른 회사가 기준보다 적으면 빈 목록.

    `picked`·`excluded`는 기간 안 고른·제외한 회사 번호(제외한 회사는 고른 회사에서 이미 뺀 값),
    `closed`는 (회사 번호, 성사 여부)로 목록 #610·영업 분석표와 같이 센 최근 성사·거절이다.
    `traits`에는 세 집합의 회사가 모두 있어야 한다(없는 회사는 어느 조합에도 맞지 않는다).
    """
    picked_rows = [traits[opp_id] for opp_id in picked if opp_id in traits]
    if len(picked_rows) < rule.min_picks:
        return []
    excluded_rows = [traits[opp_id] for opp_id in excluded if opp_id in traits]
    closed_rows = [(traits[opp_id], won) for opp_id, won in closed if opp_id in traits]
    suggestions: list[Suggestion] = []
    for combo in _candidate_combos(
        picked_rows, rule=rule, process_order=process_order, industry_order=industry_order
    ):
        if any(_same_combo(combo, other) for other in active):
            continue
        inside = sum(combo.matches(row) for row in picked_rows)
        excluded_inside = sum(combo.matches(row) for row in excluded_rows)
        share = (inside - excluded_inside) / len(picked_rows)
        if share < rule.min_share:
            continue
        # 안전장치①: 성사율이 조합 밖보다 낮지 않을 때만.
        # 표본이 모자라면 판단하지 않는다(제안 안 함).
        closed_in = [won for row, won in closed_rows if combo.matches(row)]
        closed_out = [won for row, won in closed_rows if not combo.matches(row)]
        if min(len(closed_in), len(closed_out)) < rule.min_closed_for_rate:
            continue
        won_in, won_out = sum(closed_in), sum(closed_out)
        # 비율을 곱셈으로 견줘 나눗셈 반올림을 피한다: won_in/len_in >= won_out/len_out.
        if won_in * len(closed_out) < won_out * len(closed_in):
            continue
        suggestions.append(
            Suggestion(
                combo=combo,
                picked_count=inside,
                excluded_count=excluded_inside,
                share=share,
                closed_count=len(closed_in),
                won_count=won_in,
                other_closed_count=len(closed_out),
                other_won_count=won_out,
            )
        )
    # 비율 큰 순. 같으면 만든 순서(공정 목록 순 → 산업 순, 거리는 맨 뒤)를 지킨다(안정 정렬).
    suggestions.sort(key=lambda row: (row.combo.kind == DISTANCE, -row.share))
    return suggestions


def first_match(company: CompanyTraits, approvals: Sequence[tuple[str, Combo]]) -> str | None:
    """회사에 맞는 켜진 승인 가운데 먼저 승인한 것의 번호. `approvals`는 승인 순 (번호, 조합)."""
    for pref_id, combo in approvals:
        if combo.matches(company):
            return pref_id
    return None


def preferred_level(base_level: int, *, matched: bool, step: int, max_level: int) -> int:
    """#610 조정 단계에 선호 단계를 더한 값. 위로는 max_level을 넘지 않는다(아래는 그대로)."""
    if not matched:
        return base_level
    return max(base_level, min(max_level, base_level + step))


def keep_explore_slot(
    order: Sequence[str], *, ready: Collection[str], preferred: Collection[str], top_n: int
) -> tuple[list[str], str | None]:
    """안전장치③: "근거 있음" 회사 가운데 앞 top_n 자리가 모두 선호에 맞으면, 선호 밖 가장 앞 회사를
    그 top_n번째 자리로 올린다. 바뀐 순서와 올린 회사 번호(없으면 None)를 돌려준다.

    다른 묶음의 자리는 건드리지 않는다. 선호 밖 회사가 이미 앞 top_n 안에 있거나 하나도 없으면
    그대로 둔다.
    """
    ready_positions = [index for index, opp_id in enumerate(order) if opp_id in ready]
    head = ready_positions[:top_n]
    if len(head) < top_n or any(order[index] not in preferred for index in head):
        return list(order), None
    later = next(
        (index for index in ready_positions[top_n:] if order[index] not in preferred), None
    )
    if later is None:
        return list(order), None
    moved = order[later]
    result = [opp_id for index, opp_id in enumerate(order) if index != later]
    result.insert(head[-1], moved)
    return result, moved
