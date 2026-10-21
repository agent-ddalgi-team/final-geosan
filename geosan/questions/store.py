"""조사 요건과 평가에서 나온 확인 질문 후보를 저장한다."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.errors import InputError
from geosan.config.schemas import CaseResearchReadiness
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.models import Opportunity
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink, ResearchTask
from geosan.rules.models import QuestionCandidate
from geosan.storage.base import new_id, utcnow


def store_research(
    session: Session,
    opp_id: str,
    readiness: CaseResearchReadiness | None,
    *,
    dataset_kind: str,
    is_virtual: bool,
    requested_by: str,
) -> ResearchTask | None:
    if readiness is None:
        return None
    if session.get(Opportunity, opp_id) is None:
        raise InputError("조사 요건을 연결할 기회가 없습니다.")
    row = ResearchTask(
        task_id=new_id("rt"),
        opp_id=opp_id,
        **readiness.model_dump(),
        dataset_kind=dataset_kind,
        is_virtual=is_virtual,
        created_by=requested_by,
    )
    session.add(row)
    session.flush()
    return row


def current_research(session: Session, opp_id: str) -> ResearchTask | None:
    return session.scalar(
        select(ResearchTask)
        .where(ResearchTask.opp_id == opp_id, ResearchTask.superseded_at.is_(None))
        .order_by(ResearchTask.created_at.desc())
    )


def supersede_research(session: Session, opp_id: str) -> None:
    for row in session.scalars(
        select(ResearchTask).where(
            ResearchTask.opp_id == opp_id, ResearchTask.superseded_at.is_(None)
        )
    ):
        row.superseded_at = utcnow()
    session.flush()


def upsert_question(
    session: Session,
    candidate: QuestionCandidate,
    opp_id: str,
    source_eval_id: str,
    *,
    dataset_kind: str,
    is_virtual: bool,
    requested_by: str = "system",
) -> ConfirmationQuestion:
    evaluation = session.get(EvaluationRun, source_eval_id)
    if (
        session.get(Opportunity, opp_id) is None
        or evaluation is None
        or evaluation.opp_id != opp_id
    ):
        raise InputError("질문의 기회와 평가 연결을 확인해 주세요.")
    common = dict(dataset_kind=dataset_kind, is_virtual=is_virtual, created_by=requested_by)
    question = session.scalar(
        select(ConfirmationQuestion).where(
            ConfirmationQuestion.target_kind == candidate.target_kind.value,
            ConfirmationQuestion.target_id == candidate.target_id,
        )
    )
    if question is None:
        question = ConfirmationQuestion(
            question_id=new_id("q"),
            target_kind=candidate.target_kind.value,
            target_id=candidate.target_id,
            question_text=candidate.text,
            status="WAITING",
            **common,
        )
        session.add(question)
    question.question_text = candidate.text
    question.current_value = candidate.current_value
    question.source_eval_id = source_eval_id
    session.flush()
    link = session.scalar(
        select(QuestionOpportunityLink).where(
            QuestionOpportunityLink.question_id == question.question_id,
            QuestionOpportunityLink.opp_id == opp_id,
        )
    )
    if link is None:
        link = QuestionOpportunityLink(
            question_link_id=new_id("ql"),
            question_id=question.question_id,
            opp_id=opp_id,
            effect_if_answered=candidate.effect_if_answered,
            linked_at=utcnow(),
            **common,
        )
        session.add(link)
    link.effect_if_answered = candidate.effect_if_answered
    session.flush()
    return question
