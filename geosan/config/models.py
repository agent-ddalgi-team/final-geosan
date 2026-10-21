"""ConfigRegistry 테이블 (cfg_, entities.md). 이 파일의 열은 PM 세션만 고친다."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, UtcDateTime, utcnow


class RuleConfigVersion(CommonColumns, Base):
    """규칙 설정 파일(rule-config.yaml) 한 판. 수치는 모두 '기업 승인 전 가설'(NFR11, FR4.12)."""

    __tablename__ = "cfg_rule_config_version"

    rule_version: Mapped[str] = mapped_column(String(40), primary_key=True)
    rule_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT")
    change_reason: Mapped[str | None] = mapped_column(Text)
    fixed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    company_approval_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="HYPOTHESIS"
    )
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)


class AppSetting(CommonColumns, Base):
    """앱 설정(app-settings.yaml)을 키-값으로 읽은 사본. 비밀 값은 저장하지 않는다 (FR14.1)."""

    __tablename__ = "cfg_app_setting"

    setting_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    updated_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system")
