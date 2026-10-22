"""DB 요청 세션과 담당자 키 검사. 접속 보호가 켜져 있으면 세션 구현 전에는 거부한다."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from geosan.config.errors import AppError, ForbiddenError
from geosan.config.registry import RuntimeConfig, load_runtime_config
from geosan.storage.session import session_scope


def runtime_for(session: Session) -> RuntimeConfig:
    if "runtime_config" not in session.info:
        session.info["runtime_config"] = load_runtime_config(session)
    return session.info["runtime_config"]


def get_session() -> Iterator[Session]:
    with session_scope() as session:
        runtime = runtime_for(session)
        if runtime.app_settings.access_protection.enabled:
            raise AppError(
                "접속 보호가 켜져 있습니다.",
                "PM의 세션 보호 기능 연결 후 접속해 주세요.",
                status=401,
            )
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
