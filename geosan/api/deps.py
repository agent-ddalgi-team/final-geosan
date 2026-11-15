"""DB 요청 세션·접속 쿠키·담당자 키 검사.

#754 계정 방식: 접속 보호가 켜져 있고 계정이 있으면 세션의 계정이 담당자다. 이때 실행 설정의
담당자 목록을 계정 목록으로 바꿔 끼워, 기존의 담당자 검사(is_recording_staff)와 화면 설정이
그대로 계정을 보게 한다. 보기 전용 계정은 기록할 수 없는 키로 표시한다.
"""

from collections.abc import Iterator
from dataclasses import replace
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import event
from sqlalchemy.orm import Session

from geosan.api.access_policy import session_is_active
from geosan.api.access_session import COOKIE_NAME, token_fingerprint
from geosan.api.models import AccessSession, StaffAccount
from geosan.api.staff_accounts import accounts_mode, active_accounts, find_active
from geosan.config.app_settings import StaffEntry
from geosan.config.errors import AppError, ForbiddenError
from geosan.config.registry import RuntimeConfig, load_runtime_config
from geosan.storage.base import CommonColumns, utcnow
from geosan.storage.session import session_scope


def runtime_for(session: Session) -> RuntimeConfig:
    if "runtime_config" not in session.info:
        session.info["runtime_config"] = load_runtime_config(session)
    return session.info["runtime_config"]


def with_account_staff(runtime: RuntimeConfig, accounts: list[StaffAccount]) -> RuntimeConfig:
    """담당자 목록을 계정 목록으로 바꾼 실행 설정. 표시 이름이 없으면 아이디를 보인다.

    계정을 만들기 전에 남은 기록의 담당자(앱 설정 staff)는 이름만 보이도록 목록 뒤에 두고,
    기록할 수 없는 키로 표시한다(그 이름으로 새 기록을 남길 수 없음).
    """
    keys = {row.staff_key for row in accounts}
    earlier = [entry for entry in runtime.app_settings.staff if entry.key not in keys]
    settings = runtime.app_settings.model_copy(
        update={
            "staff": [
                StaffEntry(key=row.staff_key, display_name=row.display_name or row.staff_key)
                for row in accounts
            ]
            + earlier
        }
    )
    settings.set_viewer_keys(
        [row.staff_key for row in accounts if row.role == "VIEWER"]
        + [entry.key for entry in earlier]
    )
    return replace(runtime, app_settings=settings)


SETUP_REQUIRED = "STAFF_SETUP_REQUIRED"
LOGIN_KIND = "STAFF_LOGIN_REQUIRED"


def get_session(request: Request) -> Iterator[Session]:
    fingerprint = None
    with session_scope() as session:
        runtime = runtime_for(session)
        if runtime.app_settings.access_protection.enabled:
            fingerprint = token_fingerprint(request.cookies.get(COOKIE_NAME, ""))
            access = session.get(AccessSession, fingerprint) if fingerprint else None
            if access is None or not session_is_active(access.expires_at, now=utcnow()):
                if accounts_mode(session, True):
                    # 화면이 아이디 칸을 보이도록 계정 방식임을 알린다(#754).
                    raise AppError(
                        "접속 확인이 필요합니다.",
                        "아이디와 비밀번호를 입력해 주세요.",
                        status=401,
                        kind=LOGIN_KIND,
                    )
                raise AppError("접속 확인이 필요합니다.", "비밀번호를 입력해 주세요.", status=401)
            access.last_seen_at = utcnow()
            if accounts_mode(session, True):
                # 공용 비밀번호로 받은 세션이나 막힌 계정의 세션은 다시 로그인해야 한다.
                account = find_active(session, access.staff_key)
                if account is None:
                    raise AppError(
                        "접속 확인이 필요합니다.",
                        "아이디와 비밀번호를 입력해 주세요.",
                        status=401,
                        kind=LOGIN_KIND,
                    )
                session.info["staff_account"] = account
                runtime = with_account_staff(runtime, active_accounts(session))
                session.info["runtime_config"] = runtime

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


def current_account(session: Session) -> StaffAccount | None:
    """계정 방식에서 지금 로그인한 계정. 공용 방식이면 None."""
    return session.info.get("staff_account")


def require_staff(
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
) -> str:
    account = current_account(session)
    if account is not None:
        # 계정 방식: 담당자는 로그인한 사람이다. 다른 키를 보내면 거부한다(#754).
        if staff_key and staff_key != account.staff_key:
            raise ForbiddenError(
                "로그인한 담당자로만 기록할 수 있습니다.", "화면을 새로고침해 주세요."
            )
        if account.setup_required:
            raise AppError(
                "첫 로그인 설정이 남아 있습니다.",
                "화면에 보일 이름과 새 비밀번호를 먼저 정해 주세요.",
                status=403,
                kind=SETUP_REQUIRED,
            )
        if account.role == "VIEWER":
            raise ForbiddenError(
                "보기 전용 계정은 기록할 수 없습니다.", "기록은 담당자 계정으로 해 주세요."
            )
        return account.staff_key
    if not runtime_for(session).app_settings.is_recording_staff(staff_key):
        raise ForbiddenError()
    return staff_key


StaffDep = Annotated[str, Depends(require_staff, scope="function")]
