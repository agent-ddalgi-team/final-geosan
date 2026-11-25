"""#754 담당자 계정: 비밀번호 해시, 계정 방식 판단, 로그인한 사람.

계약 C1·C6·C8, PM 결정 2026-11-15.

계정(막지 않은 것)이 하나라도 있고 접속 보호가 켜져 있으면 "계정 방식"이다. 계정 방식에서는
사람마다 아이디·비밀번호로 로그인하고, 기록 요청의 담당자는 세션의 계정으로 정해진다. 계정이
없으면 지금처럼 공용 비밀번호 + 화면에서 담당자 고르기다.

비밀번호는 표준 라이브러리 scrypt로 해시만 저장한다(새 패키지 없음). 임시 비밀번호는 명령 출력에
한 번만 보이고, 담당자가 첫 로그인 때 표시 이름과 새 비밀번호를 정한다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import string

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from geosan.api.models import AccessSession, StaffAccount
from geosan.config.errors import InputError
from geosan.config.schemas import STAFF_KEY_PATTERN
from geosan.config.validators import find_contact
from geosan.storage.base import utcnow

ROLES = ("STAFF", "VIEWER")
RESERVED_KEYS = {"viewer"}
DISPLAY_NAME_MAX = 20
PASSWORD_MIN = 8
PASSWORD_MAX = 72
TEMP_PASSWORD_LENGTH = 12
# scrypt 매개변수(OWASP 권장 하한 근처, 로그인 한 번 수십 ms).
# 해시 문자열에 같이 적어 나중에 바꿀 수 있다.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1
# 헷갈리는 글자(0·O·1·l·I)를 뺀 임시 비밀번호 글자.
_TEMP_ALPHABET = "".join(ch for ch in string.ascii_letters + string.digits if ch not in "0O1lI")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    encode = lambda raw: base64.b64encode(raw).decode("ascii")  # noqa: E731
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${encode(salt)}${encode(digest)}"


def password_ok(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, digest = stored.split("$")
        if kind != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def temporary_password() -> str:
    return "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(TEMP_PASSWORD_LENGTH))


def active_accounts(session: Session) -> list[StaffAccount]:
    return list(
        session.scalars(
            select(StaffAccount)
            .where(StaffAccount.disabled_at.is_(None))
            .order_by(StaffAccount.staff_key)
        )
    )


def accounts_mode(session: Session, protection_enabled: bool) -> bool:
    """접속 보호가 켜져 있고 막지 않은 계정이 하나라도 있으면 계정 방식."""
    if not protection_enabled:
        return False
    return (
        session.scalar(
            select(StaffAccount.staff_key).where(StaffAccount.disabled_at.is_(None)).limit(1)
        )
        is not None
    )


def find_active(session: Session, staff_key: str | None) -> StaffAccount | None:
    if not staff_key:
        return None
    account = session.get(StaffAccount, staff_key)
    if account is None or account.disabled_at is not None:
        return None
    return account


def check_display_name(value: str) -> str:
    name = value.strip()
    if not 1 <= len(name) <= DISPLAY_NAME_MAX:
        raise InputError(
            "화면에 보일 이름을 확인해 주세요.",
            f"1~{DISPLAY_NAME_MAX}자로 적어 주세요.",
        )
    if find_contact(name) or "@" in name or re.search(r"\d{3,}", name):
        raise InputError(
            "이름에 전화번호·이메일은 넣을 수 없습니다.",
            "이름이나 부르는 말만 적어 주세요. 예: 영업 김",
        )
    return name


def check_new_password(password: str, *, current: str | None = None) -> str:
    if not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        raise InputError(
            "새 비밀번호를 확인해 주세요.",
            f"{PASSWORD_MIN}자 이상 {PASSWORD_MAX}자 이하로 정해 주세요.",
        )
    if current is not None and password == current:
        raise InputError("새 비밀번호를 확인해 주세요.", "지금 비밀번호와 다르게 정해 주세요.")
    return password


def end_sessions(session: Session, staff_key: str) -> int:
    result = session.execute(delete(AccessSession).where(AccessSession.staff_key == staff_key))
    return result.rowcount or 0


def add_account(session: Session, staff_key: str, *, viewer: bool) -> str:
    """계정을 만들고 임시 비밀번호를 돌려준다. 호출자가 출력에 한 번만 보인다."""
    if not re.fullmatch(STAFF_KEY_PATTERN, staff_key or "") or staff_key in RESERVED_KEYS:
        raise InputError(
            "아이디를 확인해 주세요.",
            "영어 소문자·숫자·하이픈 32자 이내로 정해 주세요(viewer는 쓸 수 없음). 예: sales-1",
        )
    if session.get(StaffAccount, staff_key) is not None:
        raise InputError(f"'{staff_key}' 계정이 이미 있습니다.", "다른 아이디를 골라 주세요.")
    password = temporary_password()
    session.add(
        StaffAccount(
            staff_key=staff_key,
            display_name=None,
            role="VIEWER" if viewer else "STAFF",
            password_hash=hash_password(password),
            setup_required=True,
            created_at=utcnow(),
            created_by="system",
        )
    )
    session.flush()
    return password


def reset_account(session: Session, staff_key: str) -> str:
    account = session.get(StaffAccount, staff_key)
    if account is None:
        raise InputError(f"'{staff_key}' 계정이 없습니다.", "`geosan staff-list`로 확인해 주세요.")
    password = temporary_password()
    account.password_hash = hash_password(password)
    account.setup_required = True
    end_sessions(session, staff_key)
    session.flush()
    return password


def set_role(session: Session, staff_key: str, *, viewer: bool) -> bool:
    """계정 종류를 보기 전용 ↔ 담당자로 바꾼다(#862, PM 결정 2026-11-20).

    비밀번호·표시 이름·첫 로그인 설정 여부는 그대로다. 바뀌면 그 계정의 세션을 끊어 다시 로그인할 때
    바뀐 권한으로 화면이 열리게 한다. 이미 그 종류면 아무것도 바꾸지 않고 False를 돌려준다.
    """
    account = session.get(StaffAccount, staff_key)
    if account is None:
        raise InputError(f"'{staff_key}' 계정이 없습니다.", "`geosan staff-list`로 확인해 주세요.")
    role = "VIEWER" if viewer else "STAFF"
    if account.role == role:
        return False
    account.role = role
    end_sessions(session, staff_key)
    session.flush()
    return True


def set_disabled(session: Session, staff_key: str, *, disabled: bool) -> StaffAccount:
    account = session.get(StaffAccount, staff_key)
    if account is None:
        raise InputError(f"'{staff_key}' 계정이 없습니다.", "`geosan staff-list`로 확인해 주세요.")
    account.disabled_at = utcnow() if disabled else None
    if disabled:
        end_sessions(session, staff_key)
    session.flush()
    return account
