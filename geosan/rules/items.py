"""입력과 설정만으로 신규 기회의 항목 점수를 계산한다 (BR4.1~4.5)."""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from geosan.rules.codes import ItemCode, ItemState, Profile, SignalKind, SourceGrade
from geosan.rules.models import (
    EvaluationInput,
    ItemInput,
    ItemJudgmentOutput,
    ProfileItemConfig,
    SignalInput,
)

SIGNAL_KINDS = {
    ItemCode.SIG_EXPAND: SignalKind.EXPANSION,
    ItemCode.SIG_ORDER: SignalKind.NEW_ORDER,
    ItemCode.SIG_BID: SignalKind.BID,
    ItemCode.SIG_HIRE: SignalKind.HIRING,
}
SCORED_STATES = {ItemState.CONFIRMED, ItemState.STRONG, ItemState.WEAK}


def round_half_up(value: Decimal | float | int | str, places: int = 0) -> Decimal:
    """십진수로 0.5를 올린다. 자리 수는 계약의 정수·소수 첫째 자리 표현이다 (BR4.1)."""
    return Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def score_product(weight: int, match_rate: float, certainty: float, decay: float) -> int:
    """항목별로 반올림한 뒤 합산하도록 정수 점수를 돌려준다 (BR4.1)."""
    product = Decimal(weight)
    for factor in (match_rate, certainty, decay):
        product *= Decimal(str(factor))
    return int(round_half_up(product))


def linked_signals(item: ItemInput, data: EvaluationInput) -> list[SignalInput]:
    """현재 항목에 연결된 같은 종류의 신호만 사용한다 (BR4.4)."""
    by_id = {signal.signal_id: signal for signal in data.signals}
    if missing := set(item.signal_ids) - by_id.keys():
        raise ValueError(f"입력에 없는 신호 참조: {sorted(missing)}")
    return sorted(
        (
            by_id[key]
            for key in set(item.signal_ids)
            if by_id[key].signal_kind == SIGNAL_KINDS[item.item_code]
        ),
        key=lambda signal: signal.signal_id,
    )


def representative_signal(signals: list[SignalInput], base_date: date) -> SignalInput | None:
    """최근 실제 발생 또는 아직 유효한 가장 이른 공고를 선택한다 (BR4.4)."""
    if not signals:
        return None
    if signals[0].signal_kind == SignalKind.BID:
        dated = [s for s in signals if s.deadline_at is not None]
        active = [s for s in dated if s.deadline_at >= base_date]
        if active:
            return min(active, key=lambda s: (s.deadline_at, s.signal_id))
        if dated:
            return min(dated, key=lambda s: (-s.deadline_at.toordinal(), s.signal_id))
    else:
        dated = [s for s in signals if s.occurred_at is not None and s.occurred_at <= base_date]
        if dated:
            return min(dated, key=lambda s: (-s.occurred_at.toordinal(), s.signal_id))
    return min(signals, key=lambda s: s.signal_id)


def signal_decay(
    signal: SignalInput, config: ProfileItemConfig, data: EvaluationInput
) -> float | None:
    """날짜 미확인을 0점과 구분하며 감쇠값은 설정에서 읽는다 (BR4.4)."""
    if config.decay == "BID_EXCEPTION":
        if signal.deadline_at is None:
            return None
        return float(
            not (
                signal.progress_status in {"CLOSED", "CANCELLED"}
                or signal.deadline_at < data.base_date
            )
        )
    if signal.occurred_at is None or signal.occurred_at > data.base_date:
        return None
    if config.decay == "HIRE" and signal.progress_status in {"CLOSED", "DONE"}:
        return 0.0
    days = (data.base_date - signal.occurred_at).days
    for step in data.rule_config.general_decay:
        if step.max_days is None or days <= step.max_days:
            return step.factor
    raise ValueError("일반 시점 감쇠 설정에 해당 날짜 구간이 없습니다")


def resolve_match_rate(item: ItemInput, config: ProfileItemConfig) -> float | None:
    """설정된 단계 밖 숫자와 이름·숫자 불일치를 거부한다 (BR4.2)."""
    rate = item.match_rate
    if item.match_rate_step is not None:
        if item.match_rate_step not in config.match_rate_steps:
            raise ValueError(f"{item.item_code}: 설정에 없는 일치도 단계")
        step_rate = config.match_rate_steps[item.match_rate_step]
        if rate is not None and rate != step_rate:
            raise ValueError(f"{item.item_code}: 일치도 이름과 숫자가 다릅니다")
        rate = step_rate
    if rate is not None and (rate not in config.match_rate_steps.values() or not 0 <= rate <= 1):
        raise ValueError(f"{item.item_code}: 설정 단계 밖 일치도")
    return rate


def calculate_items(data: EvaluationInput) -> list[ItemJudgmentOutput]:
    """누락 항목도 미확보 행으로 남기고 설정 순서대로 계산한다 (BR4.1~4.5)."""
    if data.profile != Profile.NEW:
        raise ValueError("재접촉 프로필 계산은 U6에서 구현합니다")
    configs = data.rule_config.new_profile_items
    expected = set(SIGNAL_KINDS) | {
        ItemCode.NEW_PRODUCT,
        ItemCode.NEW_MATERIAL,
        ItemCode.NEW_RECORD,
        ItemCode.NEW_PERF,
    }
    if len(configs) != len(expected) or {c.item_code for c in configs} != expected:
        raise ValueError("신규 프로필 설정에는 중복 없이 전체 항목이 있어야 합니다")
    by_code = {item.item_code: item for item in data.item_inputs}
    if len(by_code) != len(data.item_inputs) or not by_code.keys() <= expected:
        raise ValueError("항목 입력이 중복되거나 신규 프로필 밖의 항목입니다")
    return [
        _calculate_item(
            by_code.get(c.item_code, ItemInput(item_code=c.item_code, state=ItemState.UNAVAILABLE)),
            c,
            data,
        )
        for c in configs
    ]


def _calculate_item(
    item: ItemInput, config: ProfileItemConfig, data: EvaluationInput
) -> ItemJudgmentOutput:
    """완료 상태·근거·대표 신호를 확인한 뒤 한 항목만 계산한다 (BR4.1~4.5)."""
    rate = resolve_match_rate(item, config)
    state, decay = item.state, 1.0
    reason = "입력된 판정 상태와 설정값으로 계산했습니다"
    evidence_ids = set(item.evidence_ids)
    if item.item_code in SIGNAL_KINDS:
        signals = linked_signals(item, data)
        evidence_ids.update(key for signal in signals for key in signal.evidence_ids)
        if state in SCORED_STATES:
            signal = representative_signal(signals, data.base_date)
            if signal is None:
                state, reason = ItemState.NO_SIGNAL, "연결된 해당 종류의 신호가 없습니다"
            else:
                decay = signal_decay(signal, config, data)
                rate = config.match_rate_steps[
                    "직접 관련" if signal.relation == "DIRECT" else "간접 관련"
                ]
                if decay is None:
                    state, reason = ItemState.UNAVAILABLE, "발생일·마감을 모르거나 예정 사건입니다"
    by_id = {e.evidence_id: e for e in data.evidence}
    if missing := evidence_ids - by_id.keys():
        raise ValueError(f"입력에 없는 근거 참조: {sorted(missing)}")
    if (
        state in SCORED_STATES
        and evidence_ids
        and all(by_id[key].source_grade == SourceGrade.D for key in evidence_ids)
    ):
        state, reason = ItemState.UNAVAILABLE, "D등급 단독 근거는 확인을 기다립니다"
    certainty = None
    if state in SCORED_STATES:
        if rate is None:
            raise ValueError(f"{item.item_code}: 점수를 계산할 일치도가 없습니다")
        certainty = getattr(data.rule_config.certainty, state.value)
        score = score_product(config.weight, rate, certainty, decay)
    else:
        score = None if state == ItemState.UNAVAILABLE else 0
    return ItemJudgmentOutput(
        item_code=item.item_code,
        state=state,
        weight=config.weight,
        match_rate=rate,
        certainty=certainty,
        decay=decay,
        score=score,
        fact_judged=item.fact_judged,
        summary=item.summary,
        reasoning=reason,
        evidence_ids=sorted(evidence_ids),
        used_capability_ids=sorted(set(item.used_capability_ids)),
    )
