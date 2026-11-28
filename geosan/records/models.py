"""SalesRecords 최소형 테이블 (rec_, entities.md). 이 파일의 열은 PM 세션만 고친다.

U1은 담당자 의견(ReviewOpinion)만 둔다. 담기·승인·결과(U5)는 자기 테이블을 더한다.
관심(찜) 표 rec_bookmark는 2026-11-06 PM 결정(#356)으로 더했다.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, Numeric, String, Text
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
    # #259·C6: 검토사항 자료 줄 번호(예 GAP:REQ:req-3). 줄에 붙이지 않은 메모·옛 행은 비워 둔다.
    item_id: Mapped[str | None] = mapped_column(String(64))
    # #253·C6: 잘못 입력으로 표시(취소)한 시각·담당자·이유. 행은 지우지 않고 이 세 칸만 채운다.
    cancelled_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    cancelled_by: Mapped[str | None] = mapped_column(String(32))
    cancel_reason: Mapped[str | None] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # #771·C6: 전달 사항(HANDOFF)의 받는 사람과, 받는 사람이 확인한 시각·사람.
    # 다른 종류는 비워 둔다.
    to_staff_key: Mapped[str | None] = mapped_column(String(64))
    # #853·C6: 사람 대신 역할 묶음(설정 handoffTeams의 key)으로 보낸 전달 사항.
    # 이때 to_staff_key는 비운다.
    to_team: Mapped[str | None] = mapped_column(String(32))
    confirmed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    confirmed_by: Mapped[str | None] = mapped_column(String(64))


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
    # #607·C6: [단계 고치기]로 담당자가 정한 세부 단계(SalesStep). 옛 행·안 고친 행은 비워 둔다.
    step_override: Mapped[str | None] = mapped_column(String(24))
    # #253·C6: 잘못 입력으로 표시(취소)한 시각·담당자·이유. 행은 지우지 않고 이 세 칸만 채운다.
    cancelled_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    cancelled_by: Mapped[str | None] = mapped_column(String(32))
    cancel_reason: Mapped[str | None] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, nullable=False)


class OutcomeAnswer(CommonColumns, Base):
    """#607·C6: 접촉 기록의 꼬리 질문 답(코드). 답마다 새 행이며 수정·삭제하지 않는다."""

    __tablename__ = "rec_outcome_answer"

    answer_row_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    outcome_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("rec_outcome.outcome_id"), nullable=False, index=True
    )
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    question_id: Mapped[str] = mapped_column(String(40), nullable=False)
    answer_id: Mapped[str] = mapped_column(String(40), nullable=False)
    # #742·C6: 누가 채웠나(STAFF 담당자가 고름 / AI_CONFIRMED 영업 코치가 채우고 그대로 저장).
    # 옛 행은 비워 둔다.
    filled_by: Mapped[str | None] = mapped_column(String(16))


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


class AnalysisFeedback(CommonColumns, Base):
    """AI 분석 피드백 저장본(#824, 계약 C6). 받을 때마다 새 행이고 덮어쓰지 않는다.

    응답은 숫자 표만 보고 AI가 쓴 글(근거 숫자 포함)과 프로그램이 센 앞 기간 비교다. 회사 이름·
    메모 글·연락처는 없다. 읽을 때는 같은 묶음·같은 기간의 가장 최근 행을 쓴다.
    """

    __tablename__ = "rec_analysis_feedback"

    feedback_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    period_from: Mapped[date | None] = mapped_column(Date)
    period_to: Mapped[date | None] = mapped_column(Date)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(120), nullable=False)
    model: Mapped[str | None] = mapped_column(String(80))
    response: Mapped[Any] = mapped_column(JSON, nullable=False)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    transfer_log_id: Mapped[str | None] = mapped_column(String(40))


class PreferenceApproval(CommonColumns, Base):
    """담당자 선호 승인(#943, 계약 C6, PM 결정 2026-11-26 되먹임 ③).

    승인·끄기마다 행을 지우지 않는다.

    켜진 승인 = revoked_at 없음 + expires_at이 지금보다 뒤. 점수·분류는 바꾸지 않고 "근거 있음"
    묶음 안 순서만 올린다. 외부 AI·엑셀·질문 목록으로 내보내지 않는다.
    """

    __tablename__ = "rec_preference"

    pref_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    process_code: Mapped[str | None] = mapped_column(String(32))
    industry: Mapped[str | None] = mapped_column(String(80))
    distance_km: Mapped[float | None] = mapped_column(Numeric(10, 3))
    approved_by: Mapped[str] = mapped_column(String(64), nullable=False)
    approved_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    # 승인 때 숫자(고른 회사 수·비율·성사율). 나중에 왜 승인했는지 돌아볼 때 쓴다.
    basis: Mapped[Any] = mapped_column(JSON, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    revoked_by: Mapped[str | None] = mapped_column(String(64))


class ContactPerson(CommonColumns, Base):
    """상대 회사 담당자의 개인 연락처(#980, 계약 C6, PM 결정 2026-11-28).

    거산 담당자가 상세 [상대 담당자 연락처]에 직접 적은 것만 둔다(자동 수집 없음). 화면에는
    가려서 보이고, 기록 담당자가 확인 문구에 체크해 열 때만 값을 준다(열람은 ContactReveal).
    지우면 행은 남기되 이름·부서·번호를 비운다. 외부 AI·검색·엑셀·보고서·질문 목록·MCP로
    내보내지 않는다(C4).
    """

    __tablename__ = "rec_contact_person"

    contact_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False, index=True
    )
    person_name: Mapped[str | None] = mapped_column(String(20))
    role: Mapped[str | None] = mapped_column(String(30))
    phone: Mapped[str | None] = mapped_column(String(20))
    # 보관 기한(한국 날짜). 이 날짜 − personalContacts.noticeDays부터 지울지 묻는다.
    retain_until: Mapped[date] = mapped_column(Date, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    updated_by: Mapped[str | None] = mapped_column(String(64))
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    deleted_by: Mapped[str | None] = mapped_column(String(64))
    # STAFF = 담당자가 지움, RETENTION = 보관 기한 알림을 보고 지움.
    deleted_reason: Mapped[str | None] = mapped_column(String(16))


class ContactReveal(CommonColumns, Base):
    """가린 연락처·메모 글을 연 기록(#980). 덧붙이기만 한다. 연 값은 남기지 않는다."""

    __tablename__ = "rec_contact_reveal"

    reveal_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False, index=True
    )
    contact_id: Mapped[str | None] = mapped_column(String(40))
    note_id: Mapped[str | None] = mapped_column(String(40))
    staff_key: Mapped[str] = mapped_column(String(64), nullable=False)
