"""수집 저장 실패의 안전한 원인 기록(#373, PR #367 PM 요청).

SQLAlchemy 오류 문자열에는 SQL·매개값이 들어간다. 문자열·스택 대신 원인 분류와
SQLite의 고정 오류 이름을 기존 event 칸에 넣어 JSON 로그에서도 보존한다.
"""

import logging
import sqlite3
from typing import Literal

from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError, SQLAlchemyError

from geosan.config.errors import RunFailedError

_EVENTS = {"factory": "ingest.factory.failed", "judgment": "ingest.judgment.failed"}
_LOGGER = logging.getLogger("geosan")


def storage_failure(
    exc: SQLAlchemyError, *, operation: Literal["factory", "judgment"], message: str
) -> RunFailedError:
    error = RunFailedError(message)
    category = "sqlalchemy_error"
    for kind, name in (
        (IntegrityError, "integrity_error"),
        (OperationalError, "operational_error"),
        (DBAPIError, "dbapi_error"),
    ):
        if isinstance(exc, kind):
            category = name
            break
    sqlite_name = "unknown"
    original = getattr(exc, "orig", None)
    if isinstance(original, sqlite3.Error):
        name = getattr(original, "sqlite_errorname", None)
        code = getattr(original, "sqlite_errorcode", None)
        if (
            isinstance(name, str)
            and name.startswith("SQLITE_")
            and type(code) is int
            and getattr(sqlite3, name, None) == code
        ):
            sqlite_name = name.lower()
    _LOGGER.error(f"{_EVENTS[operation]}.{category}.{sqlite_name}", extra={"ref": error.ref})
    return error
