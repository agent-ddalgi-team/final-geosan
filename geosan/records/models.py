"""SalesRecords 최소형 테이블 (rec_, entities.md). 이 파일의 열은 PM 세션만 고친다.

U1은 담당자 의견(ReviewOpinion)만 둔다. 담기·승인·결과(U5)는 자기 테이블을 더한다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, UtcDateTime


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
