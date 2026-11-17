"""U8 접속 세션·공용 비밀번호 실패 상태(승인 #213)와 담당자 계정(#754, web_ 접두사)."""

from datetime import datetime

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, UtcDateTime


class AccessSession(CommonColumns, Base):
    __tablename__ = "web_access_session"

    # 쿠키 원문 대신 SHA-256 지문을 저장한다. 실패 상태 행은 인증에 쓰지 않는다.
    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    blocked_until: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    # 계정 방식에서 로그인한 계정(#754). 공용 비밀번호 방식이면 비어 있다.
    staff_key: Mapped[str | None] = mapped_column(String(32), nullable=True)


class StaffAccount(CommonColumns, Base):
    """담당자 계정(#754). 비밀번호는 scrypt 해시만, 표시 이름은 담당자가 첫 로그인 때 적는다.

    표시 이름은 저장소 파일·외부 AI·이슈·엑셀 밖으로 내보내지 않는다(계약 C6).
    """

    __tablename__ = "web_staff_account"

    staff_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="STAFF")
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    setup_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
