"""계약 C1 POST /session. 실패 상태도 커밋한 뒤 오류 응답을 반환한다.

#754 계정 방식(계정이 하나라도 있을 때): 본문에 staffKey(아이디)를 받아 그 계정의 비밀번호와
비교한다. 첫 로그인 설정(이름·새 비밀번호)은 POST /session/profile, 로그아웃은 POST /session/logout.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from geosan.api.access_policy import SESSION_LIFETIME
from geosan.api.access_session import COOKIE_NAME, attempt_login, token_fingerprint
from geosan.api.app import error_response
from geosan.api.deps import SessionDep, current_account, runtime_for
from geosan.api.models import AccessSession
from geosan.api.schemas import CurrentStaff
from geosan.api.staff_accounts import (
    accounts_mode,
    check_display_name,
    check_new_password,
    hash_password,
    password_ok,
)
from geosan.config.errors import AppError, NotFoundError
from geosan.storage.session import session_scope

router = APIRouter()


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    password: str
    staff_key: str | None = Field(default=None, alias="staffKey", max_length=32)


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    display_name: str = Field(alias="displayName", max_length=60)
    current_password: str = Field(alias="currentPassword", max_length=200)
    new_password: str = Field(alias="newPassword", max_length=200)


def current_staff_of(account) -> CurrentStaff:
    return CurrentStaff(
        key=account.staff_key,
        display_name=account.display_name,
        can_record=account.role == "STAFF" and not account.setup_required,
        setup_required=account.setup_required,
    )


@router.post("/session")
def create_session(body: SessionRequest):
    # SQLite 쓰기 잠금을 먼저 잡아 실패 횟수 갱신과 발급을 직렬화한다.
    with session_scope() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        runtime = runtime_for(session)
        response = JSONResponse({"data": None, "meta": {}}, headers={"Cache-Control": "no-store"})
        if not runtime.app_settings.access_protection.enabled:
            return response
        accounts = accounts_mode(session, True)
        decision, token = attempt_login(
            session, runtime, body.password, accounts=accounts, staff_key=body.staff_key
        )
        if not decision.allowed:
            blocked = decision.retry_after_seconds > 0
            if accounts:
                wrong = "아이디나 비밀번호가 맞지 않습니다."
                again = "아이디와 비밀번호를 다시 입력해 주세요."
            else:
                wrong = "비밀번호가 맞지 않습니다."
                again = "비밀번호를 다시 입력해 주세요."
            error = AppError(
                "잠시 기다려 주세요." if blocked else wrong,
                "잠시 후 다시 입력해 주세요." if blocked else again,
                status=429 if blocked else 401,
            )
            response = error_response(error)
            if blocked:
                payload = error.to_error_body()
                payload["error"]["retryAfterSeconds"] = decision.retry_after_seconds
                response = JSONResponse(payload, status_code=429)
                response.headers["Retry-After"] = str(decision.retry_after_seconds)
            response.headers["Cache-Control"] = "no-store"
            return response
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=int(SESSION_LIFETIME.total_seconds()),
            httponly=True,
            secure=True,
            samesite="lax",
            path="/",
        )
        return response


@router.post("/session/profile")
def save_profile(body: ProfileRequest, session: SessionDep):
    """지금 로그인한 사람의 표시 이름·비밀번호를 정한다(첫 로그인 설정과 나중에 바꾸기)."""
    account = current_account(session)
    if account is None:
        raise NotFoundError(
            "담당자 계정으로 로그인한 상태가 아닙니다.", "담당자 계정으로 로그인해 주세요."
        )
    if not password_ok(body.current_password, account.password_hash):
        raise AppError(
            "지금 비밀번호가 맞지 않습니다.", "지금 비밀번호를 다시 입력해 주세요.", status=401
        )
    name = check_display_name(body.display_name)
    new_password = check_new_password(body.new_password, current=body.current_password)
    account.display_name = name
    account.password_hash = hash_password(new_password)
    account.setup_required = False
    session.flush()
    return JSONResponse(
        {"data": current_staff_of(account).model_dump(by_alias=True), "meta": {}},
        headers={"Cache-Control": "no-store"},
    )


@router.post("/session/logout")
def logout(request: Request):
    """지금 세션 행을 지우고 쿠키를 지운다. 세션이 없어도 200(두 번 눌러도 같음)."""
    fingerprint = token_fingerprint(request.cookies.get(COOKIE_NAME, ""))
    if fingerprint:
        with session_scope() as session:
            row = session.get(AccessSession, fingerprint)
            if row is not None:
                session.delete(row)
    response = JSONResponse({"data": None, "meta": {}}, headers={"Cache-Control": "no-store"})
    response.delete_cookie(COOKIE_NAME, path="/", secure=True, httponly=True, samesite="lax")
    return response
