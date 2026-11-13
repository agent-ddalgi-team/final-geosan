"""#685 통화에서 확인한 신호: 꼬리 질문 답을 시점 점수의 신호로 맞춘다 (PM 결정 2026-11-13).

접촉 기록을 저장하거나 취소한 뒤 창구(`routes/records.py`)가 같은 트랜잭션 안에서 부른다.
지금 유효한 답(취소된 기록 제외, 같은 질문은 가장 최근 접촉의 답)을 규칙 설정 `callSignals`에 맞춰
통화 신호 행(`opp_signal`)과 두 항목의 입력 행(`eval_item_input`)으로 맞춘다. 현재와 다를 때만 쓴다.
옛 접촉의 답도 이때 함께 맞춘다. 다시 평가는 창구가 잇는다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.sales_step import contact_day
from geosan.config.sales_questions import OLD_ANSWER, SalesQuestions
from geosan.evaluation.call_inputs import (
    CALL,
    apply_call_signal_inputs,
    call_fact,
    live_call_signals,
)
from geosan.opportunity.models import Opportunity, Signal
from geosan.records.models import Outcome, OutcomeAnswer
from geosan.rules.models import CallSignalRule, RuleConfig
from geosan.storage.base import new_id, utcnow


@dataclass(frozen=True)
class CallAnswer:
    """지금 유효한 답 하나: 어느 접촉 날짜에 무엇을 골랐나."""

    answer_id: str
    day: date


@dataclass(frozen=True)
class WantedSignal:
    relation: str
    day: date
    question_id: str
    answer_id: str


def latest_answers(session: Session, opp_id: str) -> dict[str, CallAnswer]:
    """질문마다 가장 최근 접촉의 답. 취소된 기록(#253)의 답은 뺀다."""
    outcomes = list(
        session.scalars(
            select(Outcome)
            .where(Outcome.opp_id == opp_id, Outcome.cancelled_at.is_(None))
            .order_by(Outcome.version)
        )
    )
    order = {row.outcome_id: index for index, row in enumerate(outcomes)}
    days = {row.outcome_id: contact_day(row) for row in outcomes}
    answers = [
        row
        for row in session.scalars(
            select(OutcomeAnswer)
            .where(OutcomeAnswer.opp_id == opp_id)
            .order_by(OutcomeAnswer.created_at, OutcomeAnswer.answer_row_id)
        )
        if row.outcome_id in order
    ]
    answers.sort(key=lambda row: order[row.outcome_id])
    latest: dict[str, CallAnswer] = {}
    for row in answers:
        latest[row.question_id] = CallAnswer(row.answer_id, days[row.outcome_id])
    return latest


def wanted_signal(rule: CallSignalRule, latest: dict[str, CallAnswer]) -> WantedSignal | None:
    """한 항목에 맞는 답이 여럿이면 가장 센 것 하나: 직접 > 간접, 같으면 더 최근 접촉."""
    found = [
        WantedSignal(str(entry.relation), answer.day, entry.question_id, entry.answer_id)
        for entry in rule.answers
        if (answer := latest.get(entry.question_id)) is not None
        and answer.answer_id == entry.answer_id
    ]
    if not found:
        return None
    return max(found, key=lambda item: (item.relation == "DIRECT", item.day))


def _answer_label(questions: SalesQuestions, wanted: WantedSignal) -> str:
    question = questions.question(wanted.question_id)
    option = question.option(wanted.answer_id) if question else None
    return option.label if option else OLD_ANSWER


def sync_call_signals(
    session: Session,
    opportunity: Opportunity,
    rule_config: RuleConfig,
    *,
    staff: str,
    load_questions: Callable[[], SalesQuestions],
) -> bool:
    """통화 신호 행과 항목 입력 행을 지금 답에 맞춘다. 항목 입력이 바뀌었으면 True(다시 평가 필요).

    8항목 입력이 없는 "평가 전" 회사는 신호 행만 맞추고 False를 돌려준다.
    """
    if not rule_config.call_signals:
        return False
    opp_id = opportunity.opp_id
    latest = latest_answers(session, opp_id)
    now = utcnow()
    facts: dict[str, str] = {}
    for rule in rule_config.call_signals:
        wanted = wanted_signal(rule, latest)
        live = live_call_signals(session, opp_id, rule.signal_kind)
        if wanted is not None:
            facts[rule.item_code] = call_fact(wanted.day, _answer_label(load_questions(), wanted))
        if (
            wanted is not None
            and len(live) == 1
            and (live[0].relation, live[0].occurred_at) == (wanted.relation, wanted.day)
        ):
            continue
        for row in live:
            row.superseded_at = now
        if wanted is not None:
            session.add(
                Signal(
                    signal_id=new_id("sig"),
                    opp_id=opp_id,
                    signal_kind=rule.signal_kind,
                    occurred_at=wanted.day,
                    confirmed_at=wanted.day,
                    certainty="CONFIRMED",
                    relation=wanted.relation,
                    entered_by=CALL,
                    evidence_id=None,
                    dataset_kind=opportunity.dataset_kind,
                    is_virtual=opportunity.is_virtual,
                    created_by=staff,
                    created_at=now,
                )
            )
    session.flush()
    return apply_call_signal_inputs(
        session, opp_id, rule_config, entered_by=staff, facts=facts, now=now
    )
