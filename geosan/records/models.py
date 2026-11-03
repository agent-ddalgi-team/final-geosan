"""SalesRecords 최소형 테이블 (rec_, entities.md). 이 파일의 열은 PM 세션만 고친다.

U1은 담당자 의견(ReviewOpinion)만 둔다. 담기·승인·결과(U5)는 자기 테이블을 더한다.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, UtcDateTime


class Note(CommonColumns, Base):
    """영업 메모는 새 행으로만 남긴다. 외부 전송·내보내기에 쓰지 않는다(C4)."""

    __tablename__ = "rec_note"

    note_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    staff_key: Mapped[str] = mapped_column(String(64), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="MEMO", server_default="MEMO"
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)


class Outcome(CommonColumns, Base):
    """단계·접촉 시도·다음 일정의 저장본. 변경할 때마다 새 행을 남긴다."""

    __tablename__ = "rec_outcome"

    outcome_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    reply_received: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    next_schedule_at: Mapped[date | None] = mapped_column(Date)
    next_schedule_note: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    memo: Mapped[str | None] = mapped_column(Text)
    action_id: Mapped[str | None] = mapped_column(String(40))
    method: Mapped[str | None] = mapped_column(String(16))
    result: Mapped[str | None] = mapped_column(String(16))
    attempted_at: Mapped[date | None] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer, nullable=False)


class ReviewCheck(CommonColumns, Base):
    """검토사항 체크·해제는 모두 새 행이며 마지막으로 저장한 행이 현재 값이다(C6, #227)."""

    __tablename__ = "rec_review_check"

    review_check_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    item_id: Mapped[str] = mapped_column(Text, nullable=False)
    checked: Mapped[bool] = mapped_column(Boolean, nullable=False)
    staff_key: Mapped[str] = mapped_column(String(64), nullable=False)
    eval_id: Mapped[str] = mapped_column(String(40), ForeignKey("eval_run.eval_id"), nullable=False)


class ReviewOpinion(CommonColumns, Base):
    """담당자 의견(검토할 만함 / 추가 확인 / 대상 아님). 본 평가 ID 필수, 수정은 새 행 (FR7)."""

    __tablename__ = "rec_review_opinion"

    opinion_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
    eval_id: Mapped[str] = mapped_column(String(40), nullable=False)
    opinion: Mapped[str] = mapped_column(String(16), nullable=False)
    memo: Mapped[str | None] = mapped_column(String(200))
    reason: Mapped[str | None] = mapped_column(String(200))
    staff_name: Mapped[str] = mapped_column(String(32), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    previous_opinion_id: Mapped[str | None] = mapped_column(
        String(40), ForeignKey("rec_review_opinion.opinion_id")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
