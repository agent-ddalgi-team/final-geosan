"""ConfirmationDesk 최소형 테이블 (q_, entities.md). 이 파일의 열은 PM 세션만 고친다.

U1은 평가가 만든 질문 후보를 WAITING으로 저장하고 읽기 전용으로 보이기만 한다. 요청·회신·반영은 U4.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, Supersedable, UtcDateTime


class ConfirmationQuestion(CommonColumns, Base):
    """확인 질문. (targetKind, targetId)당 하나이고 연결만 늘어난다 (FR11.1, BR8.2)."""

    __tablename__ = "q_question"
    __table_args__ = (UniqueConstraint("target_kind", "target_id", name="uq_q_question_target"),)

    question_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[str] = mapped_column(String(40), nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    current_value: Mapped[str | None] = mapped_column(String(200))
    answer_format: Mapped[str] = mapped_column(String(16), nullable=False, default="YES_NO")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="WAITING")
    source_eval_id: Mapped[str | None] = mapped_column(String(40))
    is_user_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class QuestionOpportunityLink(CommonColumns, Base):
    """질문이 영향을 주는 기회와 '답하면 바뀌는 것'."""

    __tablename__ = "q_question_opportunity_link"
    __table_args__ = (UniqueConstraint("question_id", "opp_id", name="uq_q_question_opp"),)

    question_link_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    question_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("q_question.question_id"), nullable=False
    )
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
    effect_if_answered: Mapped[str] = mapped_column(Text, nullable=False)
    linked_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)


class ResearchTask(Supersedable, CommonColumns, Base):
    """조사 요건 입력값. U1은 파일 투입 저장만 (FR4.9, FR12.1)."""

    __tablename__ = "q_research_task"

    task_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
    eval_id: Mapped[str | None] = mapped_column(String(40))
    question_set: Mapped[Any | None] = mapped_column(JSON)
    allowed_channel: Mapped[str | None] = mapped_column(String(120))
    owner: Mapped[str | None] = mapped_column(String(32))
    can_change_class: Mapped[bool | None] = mapped_column(Boolean)
    estimated_hours: Mapped[float | None] = mapped_column(Float)
    max_hours: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PLANNED")
    recheck_at: Mapped[date | None] = mapped_column(Date)
