"""#213 접속 판단만 담당한다(계약 C1: 5회 실패·30초 대기·12시간 만료).

이 파일은 DB·쿠키를 직접 다루지 않는다. 호출자는 서버에서 읽은 실패 상태를 넘기고,
반환된 상태의 읽기·저장을 한 번에 처리해야 한다. 브라우저가 보낸 횟수를 믿지 않는다.
"""

from __future__ import annotations

import hmac
import math
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

# 점수 규칙이 아닌 계약 C1의 고정 접속 기준이다.
FAILURE_LIMIT = 5
WAIT_TIME = timedelta(seconds=30)
SESSION_LIFETIME = timedelta(hours=12)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("접속 판단 시각에는 시간대가 필요합니다.")
    return value.astimezone(UTC)


@dataclass(frozen=True)
class FailureState:
    failures: int = 0
    blocked_until: datetime | None = None

    def __post_init__(self) -> None:
        if not 0 <= self.failures <= FAILURE_LIMIT:
            raise ValueError("실패 횟수 상태를 확인해 주세요.")
        if (self.blocked_until is not None) != (self.failures == FAILURE_LIMIT):
            raise ValueError("실패 횟수와 대기 시각이 일치하지 않습니다.")
        if self.blocked_until is not None:
            _utc(self.blocked_until)


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    state: FailureState
    retry_after_seconds: int = 0


def password_matches(submitted: str) -> bool:
    """환경 변수로만 읽는다. 미설정이면 빈 비밀번호 접속을 허용하지 않는다."""
    configured = os.environ.get("GEOSAN_PASSWORD")
    if configured is None or not configured.strip():
        raise RuntimeError("접속 비밀번호가 설정되지 않았습니다.")
    return hmac.compare_digest(submitted.encode("utf-8"), configured.encode("utf-8"))


def decide_access(
    submitted: str, state: FailureState, *, now: datetime, protection_enabled: bool
) -> AccessDecision:
    """상태를 바꾸지 않고 다음 상태를 반환한다. 저장·차단은 호출자가 맡는다."""
    now = _utc(now)
    if not protection_enabled:
        return AccessDecision(allowed=True, state=state)
    if state.blocked_until is not None:
        remaining = (_utc(state.blocked_until) - now).total_seconds()
        if remaining > 0:
            return AccessDecision(
                allowed=False, state=state, retry_after_seconds=math.ceil(remaining)
            )
        state = FailureState()
    if password_matches(submitted):
        return AccessDecision(allowed=True, state=FailureState())
    failures = state.failures + 1
    if failures == FAILURE_LIMIT:
        return AccessDecision(
            allowed=False,
            state=FailureState(failures=failures, blocked_until=now + WAIT_TIME),
            retry_after_seconds=int(WAIT_TIME.total_seconds()),
        )
    return AccessDecision(allowed=False, state=FailureState(failures=failures))


def session_expires_at(created_at: datetime) -> datetime:
    return _utc(created_at) + SESSION_LIFETIME


def session_is_active(expires_at: datetime | None, *, now: datetime) -> bool:
    now = _utc(now)
    return expires_at is not None and now < _utc(expires_at)
