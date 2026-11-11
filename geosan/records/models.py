"""SalesRecords 최소형 테이블 (rec_, entities.md). 이 파일의 열은 PM 세션만 고친다.

U1은 담당자 의견(ReviewOpinion)만 둔다. 담기·승인·결과(U5)는 자기 테이블을 더한다.
관심(찜) 표 rec_bookmark는 2026-11-06 PM 결정(#356)으로 더했다.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, UtcDateTime


class Bookmark(CommonColumns, Base):
    """관심(찜) 표시. 켜고 끌 때마다 새 행이며 마지막 행이 현재 값이다(C6, #356)."""

    __tablename__ = "rec_bookmark"

    bookmark_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False, index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False)
    staff_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # 어떻게 생긴 행인지: MANUAL(단추) / AUTO_RECORD(기록 저장 때 자동) / MIGRATED(옮긴 자료)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)


class Note(CommonColumns, Base):
    """영업 메모는 새 행으로만 남긴다. 외부 전송·내보내기에 쓰지 않는다(C4)."""

    __tablename__ = "rec_note"

    note_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    staff_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # #450·C6: 기록할 때 본 평가. 옛 기록·번호 없는 요청은 비워 둔다.
    eval_id: Mapped[str | None] = mapped_column(String(40))
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
    eval_id: Mapped[str | None] = mapped_column(String(40))
    reply_received: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    next_schedule_at: Mapped[date | None] = mapped_column(Date)
    next_schedule_note: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    # #250 PM 계약 C6: 이전 기록은 그대로 두고 거절 행에만 코드값을 더한다.
    lost_reason_code: Mapped[str | None] = mapped_column(String(32))
    # #531·C6: 접촉 때 AI 판단이 맞았나. 2차 되먹임 재료. 옛 기록·안 고른 기록은 비워 둔다.
    judgment_check: Mapped[str | None] = mapped_column(String(16))
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
