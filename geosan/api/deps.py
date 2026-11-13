"""DB 요청 세션·접속 쿠키·담당자 키 검사."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import event
from sqlalchemy.orm import Session

from geosan.api.access_policy import session_is_active
from geosan.api.access_session import COOKIE_NAME, token_fingerprint
from geosan.api.models import AccessSession
from geosan.config.errors import AppError, ForbiddenError
from geosan.config.registry import RuntimeConfig, load_runtime_config
from geosan.storage.base import CommonColumns, utcnow
from geosan.storage.session import session_scope


def runtime_for(session: Session) -> RuntimeConfig:
    if "runtime_config" not in session.info:
        session.info["runtime_config"] = load_runtime_config(session)
    return session.info["runtime_config"]


def get_session(request: Request) -> Iterator[Session]:
    fingerprint = None
    with session_scope() as session:
        runtime = runtime_for(session)
        if runtime.app_settings.access_protection.enabled:
            fingerprint = token_fingerprint(request.cookies.get(COOKIE_NAME, ""))
            access = session.get(AccessSession, fingerprint) if fingerprint else None
            if access is None or not session_is_active(access.expires_at, now=utcnow()):
                raise AppError("접속 확인이 필요합니다.", "비밀번호를 입력해 주세요.", status=401)
            access.last_seen_at = utcnow()

            def record_session(db_session, _context, _instances):
                for row in db_session.new:
                    if isinstance(row, CommonColumns):
                        row.session_ref = fingerprint

            event.listen(session, "before_flush", record_session)
        # 실시간 좌표의 전송 기록은 독립 트랜잭션으로 먼저 저장한다.
        # 접속 시각 쓰기 잠금을 먼저 끝내야 같은 SQLite에 기록할 때 서로 기다리지 않는다.
        live_geocode = (
            request.method == "GET"
            and (
                request.url.path.startswith("/api/v1/opportunities")
                or request.url.path == "/api/v1/dashboard/map"
            )
            and runtime.app_settings.geocoding.enabled
            and runtime.app_settings.geocoding.naver_fallback_enabled
        )
        if not live_geocode:
            yield session
            return
    with session_scope() as session:
        session.info["runtime_config"] = runtime
        if fingerprint:
            event.listen(session, "before_flush", record_session)
        yield session


SessionDep = Annotated[Session, Depends(get_session, scope="function")]


def require_staff(
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
) -> str:
    if not runtime_for(session).app_settings.is_recording_staff(staff_key):
        raise ForbiddenError()
    return staff_key


StaffDep = Annotated[str, Depends(require_staff, scope="function")]
