"""쿠키는 무작위 토큰, DB는 지문만 보관한다. 실패 상태는 공용 비밀번호당 한 행이다."""

import hashlib
import re
import secrets

from sqlalchemy.orm import Session

from geosan.api.access_policy import FailureState, decide_access, session_expires_at
from geosan.api.models import AccessSession
from geosan.config.registry import RuntimeConfig
from geosan.storage.base import utcnow

COOKIE_NAME = "geosan_session"
FAILURE_ROW_ID = "login-failures"  # SHA-256 지문이 아니므로 쿠키로 이 행을 인증할 수 없다.


def token_fingerprint(token: str) -> str | None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def attempt_login(session: Session, runtime: RuntimeConfig, password: str):
    """호출자가 BEGIN IMMEDIATE로 잠근 트랜잭션 안에서 호출한다."""
    now = utcnow()
    throttle = session.get(AccessSession, FAILURE_ROW_ID)
    state = FailureState(
        failures=throttle.failure_count if throttle else 0,
        blocked_until=throttle.blocked_until if throttle else None,
    )
    decision = decide_access(password, state, now=now, protection_enabled=True)
    if throttle is None:
        throttle = AccessSession(
            session_id=FAILURE_ROW_ID, expires_at=now, last_seen_at=now, created_at=now
        )
        session.add(throttle)
    throttle.failure_count = decision.state.failures
    throttle.blocked_until = decision.state.blocked_until
    throttle.last_seen_at = now
    if not decision.allowed:
        return decision, None
    token = secrets.token_urlsafe(32)
    fingerprint = token_fingerprint(token)
    session.add(
        AccessSession(
            session_id=fingerprint,
            session_ref=fingerprint,
            created_at=now,
            expires_at=session_expires_at(now),
            last_seen_at=now,
            dataset_kind=runtime.app_settings.active_dataset_kind,
            is_virtual=runtime.app_settings.active_dataset_kind.startswith("VIRTUAL"),
        )
    )
    return decision, token
