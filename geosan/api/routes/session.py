"""계약 C1 POST /session. 실패 상태도 커밋한 뒤 오류 응답을 반환한다."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from geosan.api.access_policy import SESSION_LIFETIME
from geosan.api.access_session import COOKIE_NAME, attempt_login
from geosan.api.app import error_response
from geosan.api.deps import runtime_for
from geosan.config.errors import AppError
from geosan.storage.session import session_scope

router = APIRouter()


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str


@router.post("/session")
def create_session(body: SessionRequest):
    # SQLite 쓰기 잠금을 먼저 잡아 실패 횟수 갱신과 발급을 직렬화한다.
    with session_scope() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        runtime = runtime_for(session)
        response = JSONResponse({"data": None, "meta": {}}, headers={"Cache-Control": "no-store"})
        if not runtime.app_settings.access_protection.enabled:
            return response
        decision, token = attempt_login(session, runtime, body.password)
        if not decision.allowed:
            blocked = decision.retry_after_seconds > 0
            error = AppError(
                "잠시 기다려 주세요." if blocked else "비밀번호가 맞지 않습니다.",
                "잠시 후 다시 입력해 주세요." if blocked else "비밀번호를 다시 입력해 주세요.",
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
