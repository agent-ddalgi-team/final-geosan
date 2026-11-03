"""U8 접속 세션과 공용 비밀번호 실패 상태(승인 #213, web_ 접두사)."""

from datetime import datetime

from sqlalchemy import Integer, String
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
