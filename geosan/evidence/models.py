"""EvidenceExtraction 최소형 테이블 (ev_, entities.md). 이 파일의 열은 PM 세션만 고친다.

U1은 파일 투입(수동 입력)만 받는다. 홈페이지 읽기·LLM 추출(U2)은 열을 더하기만 한다.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, Supersedable, UtcDateTime


class Evidence(Supersedable, CommonColumns, Base):
    """근거 자료 한 건 (FR5.6, FR5.7). quote에 연락처 패턴은 들어오지 못한다(BR2.1)."""

    __tablename__ = "ev_evidence"

    evidence_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
    source_grade: Mapped[str] = mapped_column(String(4), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(500), nullable=False)
    source_version: Mapped[str | None] = mapped_column(String(120))
    origin_key: Mapped[str | None] = mapped_column(String(200))
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[date | None] = mapped_column(Date)
    confirmed_at: Mapped[date | None] = mapped_column(Date)
    security_grade: Mapped[str] = mapped_column(String(24), nullable=False)
    external_ai_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    presentation_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    extraction_method: Mapped[str] = mapped_column(String(16), nullable=False, default="MANUAL")
    extracted_by: Mapped[str] = mapped_column(String(64), nullable=False)
    extracted_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    certainty_proposed: Mapped[str | None] = mapped_column(String(16))
    certainty_confirmed: Mapped[str | None] = mapped_column(String(16))
    is_llm_proposed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
