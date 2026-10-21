"""저장소 공통 바탕 (계약 C6, entities.md 공통 열).

- `Base`: 모든 모델의 선언 바탕(한 metadata). 각 부품의 `models.py`가 이것을 상속한다.
- `CommonColumns`: 모든 업무 테이블의 공통 열 `created_at`(시간대 포함, UTC 저장)·`created_by`·
  `session_ref`·`dataset_kind`·`is_virtual`. 저장소가 자동으로 채운다(보안 설계 6장).
- `Supersedable`: 사례 재투입 때 기존 행에 찍는 `superseded_at`(현재 행 = 비어 있음, BR1.7).
- `new_id(prefix)`: 접두사 + ULID(시간순 정렬 가능, 26자). 새 패키지 없이 표준 라이브러리로 만든다.
- `UtcDateTime`: SQLite가 시간대를 버리지 않도록 ISO 8601 문자열(+00:00)로 저장하고
  aware datetime으로 읽는다(NFR12).
"""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_base32(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def new_ulid() -> str:
    """ULID 26자: 앞 10자 = 밀리초 시각, 뒤 16자 = 난수 80비트 (같은 밀리초 안 순서는 비보장)."""
    timestamp_ms = int(time.time() * 1000)
    randomness = int.from_bytes(os.urandom(10), "big")
    return _encode_base32(timestamp_ms, 10) + _encode_base32(randomness, 16)


def new_id(prefix: str) -> str:
    """접두사가 붙은 ID. 예: new_id('opp') → 'opp-01J9…'. 접두사로 어느 테이블 ID인지 바로 안다."""
    if not prefix or "-" in prefix:
        raise ValueError(f"ID 접두사는 하이픈 없는 짧은 영문이어야 합니다: {prefix!r}")
    return f"{prefix}-{new_ulid()}"


def utcnow() -> datetime:
    return datetime.now(UTC)


class UtcDateTime(TypeDecorator[datetime]):
    """시간대 포함 시각. 저장은 UTC ISO 8601 문자열, 읽기는 aware datetime(UTC)."""

    impl = String(40)
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, datetime):
            raise TypeError(f"datetime이어야 합니다: {value!r}")
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("시각에는 시간대가 있어야 합니다(NFR12). 예: datetime.now(UTC)")
        return value.astimezone(UTC).isoformat(timespec="microseconds")

    def process_result_value(self, value: Any, dialect: Any) -> datetime | None:
        if value is None:
            return None
        parsed = datetime.fromisoformat(str(value))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)


class Base(DeclarativeBase):
    """모든 테이블의 선언 바탕. 마이그레이션은 `geosan.storage.metadata`가 모은 metadata를 쓴다."""


class CommonColumns:
    """공통 열(C6). 기록·이력 행도 이 열을 가진다. dataset_kind는 cfg_ 테이블에서는 비워도 된다."""

    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system")
    session_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dataset_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_virtual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Supersedable:
    """재투입 때 옛 행에 찍는 시각. 현재 행 = `superseded_at IS NULL` (BR1.7, BR2.4)."""

    superseded_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
