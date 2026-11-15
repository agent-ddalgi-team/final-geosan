"""배포용 DB 사본에서 시험 영업 기록만 지우기 (#753, 계약 C8 `copy-without-records`).

명령(`geosan/commands/copy_without_records.py`)이 사본을 만든 뒤 이 함수를 부른다. 기록·질문·
신호·평가를 다루는 부품을 창구 쪽(api)에서 한 번에 부르도록 여기에 둔다(부품 간 의존 허용표).
지우기·되돌리기·다시 평가는 호출자가 쥔 한 트랜잭션 안에서 한다.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from geosan.api.call_signals import sync_call_signals
from geosan.api.deps import runtime_for
from geosan.api.models import AccessSession
from geosan.config.errors import AppError
from geosan.evidence.models import Evidence
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import Customer, Opportunity, RelationHistory
from geosan.opportunity.source_models import CandidateJudgment
from geosan.questions.models import ConfirmationQuestion
from geosan.records.models import (
    Bookmark,
    Note,
    Outcome,
    OutcomeAnswer,
    ReviewCheck,
    ReviewOpinion,
)
from geosan.workflows.flow_evaluate import evaluate_in_session

SYSTEM = "system"

# 지우는 순서: 다른 표가 가리키는 표(접촉 결과)보다 그 답을 먼저 지운다.
CLEARED = (
    ("영업 메모·남긴 피드백·다음 통화 준비", Note),
    ("꼬리 질문 답", OutcomeAnswer),
    ("접촉 결과", Outcome),
    ("관심 표시", Bookmark),
    ("검토 확인", ReviewCheck),
    ("담당자 의견", ReviewOpinion),
    ("거래 관계 입력 이력", RelationHistory),
    ("외부 전송 기록(AI 사용액)", TransferLog),
    ("접속 기록", AccessSession),
)


@dataclass(frozen=True)
class CopyResult:
    cleared: dict[str, int]
    cleared_replies: int
    reverted_relations: int
    reevaluated: int
    kept: dict[str, int]


def _count(session: Session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def _revert_relations(session: Session) -> tuple[int, set[str]]:
    """거래 관계를 이력의 처음 값으로 되돌린다. 되돌린 회사 수와 그 회사의 기회 번호."""
    first: dict[str, RelationHistory] = {}
    for row in session.scalars(
        select(RelationHistory).order_by(RelationHistory.changed_at, RelationHistory.created_at)
    ):
        first.setdefault(row.customer_id, row)
    opp_ids: set[str] = set()
    for customer_id, row in first.items():
        customer = session.get(Customer, customer_id)
        if customer is None:
            continue
        customer.relation_status = row.from_status
        customer.relation_confirmed_at = None
        customer.relation_confirmed_by = None
        opp_ids.update(
            session.scalars(
                select(Opportunity.opp_id).where(Opportunity.customer_id == customer_id)
            )
        )
    return len(first), opp_ids


def _clear_question_replies(session: Session) -> int:
    """질문 목록에 담당자가 단 답만 비운다. 질문은 남기고 "답함"은 "기다림"으로 되돌린다."""
    rows = list(
        session.scalars(
            select(ConfirmationQuestion).where(
                (ConfirmationQuestion.status == "REPLIED")
                | ConfirmationQuestion.reply_text.is_not(None)
            )
        )
    )
    for question in rows:
        question.reply_text = None
        question.replied_at = None
        question.replied_by = None
        if question.status == "REPLIED":
            question.status = "WAITING"
    return len(rows)


def _resync_call_signals(session: Session, opp_ids: set[str]) -> set[str]:
    """기록을 지운 회사의 통화 신호를 화면 저장과 같은 함수로 다시 맞춘다(#685)."""
    from geosan.api.routes.records import sales_questions

    rule_config = runtime_for(session).rule_config
    changed: set[str] = set()
    for opp_id in sorted(opp_ids):
        opportunity = session.get(Opportunity, opp_id)
        if opportunity is None:
            continue
        if sync_call_signals(
            session,
            opportunity,
            rule_config,
            staff=SYSTEM,
            load_questions=lambda: sales_questions(session),
        ):
            changed.add(opp_id)
    return changed


def clear_records(session: Session) -> CopyResult:
    """사본 DB 안에서 영업 기록만 지우고 신호·평가를 맞춘다. 호출자가 트랜잭션을 쥔다."""
    touched = set(session.scalars(select(Outcome.opp_id).distinct()))
    reverted, relation_opps = _revert_relations(session)
    replies = _clear_question_replies(session)
    cleared: dict[str, int] = {}
    for label, model in CLEARED:
        cleared[label] = _count(session, model)
        session.execute(delete(model))
    session.flush()
    changed = _resync_call_signals(session, touched)
    reevaluate = sorted(changed | relation_opps)
    if reevaluate:
        result = evaluate_in_session(session, reevaluate, SYSTEM)
        if not result.ok:
            message = result.error.message if result.error else "다시 평가하지 못했습니다."
            raise AppError(message, "원본 DB를 확인한 뒤 다시 실행해 주세요.", status=500)
    kept = {
        "회사": _count(session, Customer),
        "조사 근거": _count(session, Evidence),
        "후보 판단": _count(session, CandidateJudgment),
    }
    return CopyResult(cleared, replies, reverted, len(reevaluate), kept)
