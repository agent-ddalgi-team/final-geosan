"""항목의 판정 완료 여부와 재확인 가능성을 합계에 반영한다 (BR4.6)."""

from decimal import Decimal

from geosan.rules.codes import ItemState
from geosan.rules.items import SIGNAL_KINDS, round_half_up, score_product
from geosan.rules.models import ItemJudgmentOutput, RuleConfig, Totals


def calculate_totals(items: list[ItemJudgmentOutput], config: RuleConfig) -> Totals:
    """정수 점수를 합치고 추정 항목은 확실도만 바꿔 R을 다시 계산한다 (BR4.6)."""
    weights = {item.item_code: item.weight for item in config.new_profile_items}
    if len(items) != len(weights) or {item.item_code for item in items} != weights.keys():
        raise ValueError("합계 계산에는 중복 없이 전체 항목이 필요합니다")
    if sum(weights.values()) != 100:
        raise ValueError("프로필 배점 합은 100이어야 합니다")
    for item in items:
        if item.weight != weights[item.item_code]:
            raise ValueError("항목 배점이 설정과 다릅니다")
        if (item.state == ItemState.UNAVAILABLE) != (item.score is None):
            raise ValueError("미확보 항목만 점수가 null이어야 합니다")
        if item.score is not None and not 0 <= item.score <= item.weight:
            raise ValueError("항목 점수는 0부터 배점 사이여야 합니다")
    completed = [item for item in items if item.score is not None]
    f = sum(item.score for item in completed if item.item_code not in SIGNAL_KINDS)
    t = sum(item.score for item in completed if item.item_code in SIGNAL_KINDS)
    e, p = f + t, sum(item.weight for item in completed)
    r = e + sum(item.weight for item in items if item.score is None)
    for item in completed:
        if item.state in {ItemState.STRONG, ItemState.WEAK}:
            if item.match_rate is None or item.decay is None:
                raise ValueError("추정 항목 재계산에는 일치도와 감쇠값이 필요합니다")
            r += (
                score_product(item.weight, item.match_rate, config.certainty.CONFIRMED, item.decay)
                - item.score
            )
    if not (0 <= e <= p <= 100 and e <= r <= 100):
        raise ValueError("합계 범위 검증 실패: 0≤E≤P≤100, E≤R≤100")
    return Totals(
        E=e,
        F=f,
        T=t,
        P=p,
        R=r,
        S=float(round_half_up(Decimal(e) / p * 100, 1)) if p else None,
        C=float(round_half_up(Decimal(len(completed)) / len(items) * 100, 1)),
    )
