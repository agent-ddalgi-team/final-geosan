"""#685 통화에서 확인한 신호를 점수 항목 입력 행으로 맞춘다 (C6, PM 결정 2026-11-13).

살아 있는 통화 신호 행(`opp_signal`의 CALL_INTENT·CALL_INTEREST)을 보고 규칙 설정 `callSignals`가
짝지은 항목(SIG_BID·SIG_HIRE)의 입력 행을 맞춘다. 신호 행은 창구(`api/call_signals.py`)가 만든다.

- 8항목 입력이 없는 "평가 전" 회사는 건드리지 않는다(통화 점수만 따로 내지 않는다).
- 사례 파일(FILE)·담당자 확정(STAFF) 값에 점수가 있으면 덮지 않는다.
  그 밖(AI 제안, 미확보·신호 없음)은 통화 값(`proposed_by = "CALL"`)이 대신한다.
- 통화 신호가 없어지면 덮기 전 행을 새 버전으로 되살린다. 같은 입력이면 아무것도 쓰지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.evaluation.inputs import current_item_inputs
from geosan.evaluation.models import ItemJudgmentInput
from geosan.opportunity.models import Signal
from geosan.rules.items import RELATION_STEPS
from geosan.rules.models import RuleConfig
from geosan.storage.base import new_id, utcnow

CALL = "CALL"
"""항목 입력 행·신호 행의 출처 표시: 담당자가 통화에서 확인한 값."""
HUMAN_SOURCES = {"FILE", "STAFF"}
SCORED_STATES = {"CONFIRMED", "STRONG", "WEAK"}


def call_item_codes(rule_config: RuleConfig) -> set[str]:
    """통화에서 확인한 신호로 채우는 항목 코드. AI 조사는 이 항목을 제안하지 않는다."""
    return {rule.item_code for rule in rule_config.call_signals}


def call_fact(day: date | None, answer_label: str | None = None) -> str:
    """점수표에 보일 설명 글. 날짜와 답만 적는다(사람 이름 없음)."""
    text = f"통화에서 확인({day.month}/{day.day})" if day else "통화에서 확인"
    return f"{text} · {answer_label}" if answer_label else text


def live_call_signals(session: Session, opp_id: str, signal_kind: str) -> list[Signal]:
    return list(
        session.scalars(
            select(Signal)
            .where(
                Signal.opp_id == opp_id,
                Signal.signal_kind == signal_kind,
                Signal.superseded_at.is_(None),
            )
            .order_by(Signal.signal_id)
        )
    )


def _base_row(session: Session, row: ItemJudgmentInput) -> ItemJudgmentInput | None:
    """통화 값이 덮기 전의 행(가장 최근의 통화 출처가 아닌 행)."""
    if row.proposed_by != CALL:
        return row
    return session.scalar(
        select(ItemJudgmentInput)
        .where(
            ItemJudgmentInput.opp_id == row.opp_id,
            ItemJudgmentInput.item_code == row.item_code,
            ItemJudgmentInput.proposed_by != CALL,
        )
        .order_by(ItemJudgmentInput.version.desc())
    )


def _copied(value):
    """되살리는 행이 옛 행과 같은 목록 객체를 나눠 갖지 않게 한다."""
    return list(value) if isinstance(value, list) else value


def _next_version(session: Session, opp_id: str, item_code: str) -> int:
    last = session.scalar(
        select(func.max(ItemJudgmentInput.version)).where(
            ItemJudgmentInput.opp_id == opp_id, ItemJudgmentInput.item_code == item_code
        )
    )
    return (last or 0) + 1


def apply_call_signal_inputs(
    session: Session,
    opp_id: str,
    rule_config: RuleConfig,
    *,
    entered_by: str,
    facts: Mapping[str, str] | None = None,
    now: datetime | None = None,
) -> bool:
    """통화 신호에 맞게 항목 입력 행을 맞추고, 바뀐 행이 있으면 True(다시 평가해야 함).

    `facts`는 {항목 코드: 설명 글}이다. 없으면 날짜만 적은 글을 쓰고, 이미 맞는 행의 글은 안 고친다.
    """
    current = {row.item_code: row for row in current_item_inputs(session, opp_id)}
    if not current:
        return False
    now = now or utcnow()
    changed = False
    for rule in rule_config.call_signals:
        row = current.get(rule.item_code)
        if row is None:
            continue
        signals = live_call_signals(session, opp_id, rule.signal_kind)
        signal = signals[0] if signals else None
        base = _base_row(session, row)
        human_scored = (
            base is not None and base.proposed_by in HUMAN_SOURCES and base.state in SCORED_STATES
        )
        fact = (facts or {}).get(rule.item_code)
        if signal is not None and not human_scored:
            step = RELATION_STEPS["DIRECT" if signal.relation == "DIRECT" else "INDIRECT"]
            if (
                row.proposed_by == CALL
                and list(row.signal_ids) == [signal.signal_id]
                and row.match_rate_step == step
                and (fact is None or row.fact_judged == fact)
            ):
                continue
            item = next(i for i in rule_config.new_profile_items if i.item_code == rule.item_code)
            text = fact or call_fact(signal.occurred_at)
            values = dict(
                state="CONFIRMED",
                match_rate_step=step,
                match_rate=float(item.match_rate_steps[step]),
                fact_judged=text,
                summary=text,
                evidence_ids=[],
                signal_ids=[signal.signal_id],
                used_capability_refs=[],
                proposed_by=CALL,
                entered_by=entered_by,
                entered_at=now,
            )
        elif row.proposed_by == CALL:
            if base is None:
                if row.state == "UNAVAILABLE" and not row.signal_ids:
                    continue
                values = dict(
                    state="UNAVAILABLE",
                    match_rate_step=None,
                    match_rate=None,
                    fact_judged=None,
                    summary=None,
                    evidence_ids=[],
                    signal_ids=[],
                    used_capability_refs=[],
                    proposed_by=CALL,
                    entered_by=entered_by,
                    entered_at=now,
                )
            else:
                values = {
                    name: _copied(getattr(base, name))
                    for name in (
                        "state",
                        "match_rate_step",
                        "match_rate",
                        "fact_judged",
                        "summary",
                        "evidence_ids",
                        "signal_ids",
                        "used_capability_refs",
                        "proposed_by",
                        "entered_by",
                        "entered_at",
                    )
                }
        else:
            continue
        row.superseded_at = now
        session.add(
            ItemJudgmentInput(
                item_input_id=new_id("ii"),
                opp_id=opp_id,
                item_code=rule.item_code,
                version=_next_version(session, opp_id, rule.item_code),
                dataset_kind=row.dataset_kind,
                is_virtual=row.is_virtual,
                created_by=entered_by,
                created_at=now,
                **values,
            )
        )
        changed = True
    if changed:
        session.flush()
    return changed
