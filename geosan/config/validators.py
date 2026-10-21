"""공용 검사기 (계약 C7, BR2.1·BR2.2, 보안 설계 1겹).

- 연락처 패턴 검사기 한 곳: 이메일, 국내 전화(02-, 0xx-, 010-, 공백·점·괄호 변형), +82.
  파일 검사(check-case·import-*)와 API 경계(의견 메모·사유)가 같은 함수를 쓴다.
- pydantic 검증 오류를 "N번째 줄 <경로>: <이유>"로 바꾸는 변환기.
  허용 값 오류 문구는 정확히
  `<줄>번째 줄 <경로>: <허용 값> 중 하나여야 하는데 '<값>'이 적혀 있습니다` 꼴이다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from pydantic import ValidationError

from geosan.config.errors import FieldError
from geosan.config.loader import LoadedDocument, join_path

# ---------------------------------------------------------------------------
# 연락처 패턴 (BR2.1, CON-11)
# ---------------------------------------------------------------------------

CONTACT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("이메일", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    # 국내 전화: 02-123-4567, 041-123-4567, 010-1234-5678, (02) 1234-5678,
    # 02.1234.5678, 02 1234 5678
    (
        "전화번호",
        re.compile(r"(?<![\d\-])\(?0\d{1,2}\)?[\s.\-]{0,3}\d{3,4}[\s.\-]{1,3}\d{4}(?![\d\-])"),
    ),
    # 구분 기호 없는 휴대전화: 01012345678
    ("전화번호", re.compile(r"(?<!\d)01[016789]\d{7,8}(?!\d)")),
    # 국제 표기: +82-10-1234-5678, +82 2 123 4567, +82(0)10-1234-5678
    (
        "전화번호",
        re.compile(r"\+\s?82[\s.\-]?\(?0?\)?\s?\d{1,2}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{4}"),
    ),
)

CONTACT_MESSAGE = "연락처는 저장하지 않습니다"
"""오류 문구 머리. 뒤에 '(이메일 패턴 발견)'처럼 종류를 붙인다."""

CONTACT_SKIP_KEYS: frozenset[str] = frozenset({"bizNumber"})
"""연락처 검사를 건너뛰는 키. 사업자번호는 숫자 10자리라 전화 패턴과 혼동될 수 있어 제외한다."""


def find_contact(text: str) -> str | None:
    """문장에 연락처 패턴이 있으면 종류('이메일'/'전화번호')를, 없으면 None을 돌려준다."""
    for kind, pattern in CONTACT_PATTERNS:
        if pattern.search(text):
            return kind
    return None


def contact_field_error(path: str, kind: str, line: int | None = None) -> FieldError:
    return FieldError(path=path, message=f"{CONTACT_MESSAGE} ({kind} 패턴 발견)", line=line)


def scan_contacts(
    value: Any, base_path: str = "", document: LoadedDocument | None = None
) -> list[FieldError]:
    """순수 데이터(dict/list/str)를 끝까지 훑어 연락처 패턴이 있는 칸을 모두 찾는다."""
    found: list[FieldError] = []
    _scan(value, base_path, document, found, skip=False)
    return found


def _scan(
    value: Any, path: str, document: LoadedDocument | None, found: list[FieldError], skip: bool
) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key)
            _scan(
                child,
                join_path(path, key_text),
                document,
                found,
                skip=key_text in CONTACT_SKIP_KEYS,
            )
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _scan(child, join_path(path, index), document, found, skip)
    elif isinstance(value, str) and not skip:
        kind = find_contact(value)
        if kind:
            line = document.line_of(path) if document else None
            found.append(contact_field_error(path, kind, line))


# ---------------------------------------------------------------------------
# pydantic 오류 → 칸별 오류 (BR2.2)
# ---------------------------------------------------------------------------

_PATTERN_HINTS: dict[str, str] = {
    r"^[0-9]{10}$": "사업자번호는 숫자 10자리여야 합니다",
    r"^[a-z0-9][a-z0-9-]*$": (
        "영문 소문자·숫자·하이픈(-)만 쓸 수 있고 첫 글자는 영문·숫자여야 합니다"
    ),
    r"^[a-z0-9-]{1,32}$": "담당자 키는 영문 소문자·숫자·하이픈 1~32자여야 합니다",
    r"^#[0-9A-Fa-f]{6}$": "색은 '#RRGGBB' 형식(예: #1F5FBF)이어야 합니다",
    r"^[A-Z][A-Z_]+$": "항목 코드는 영문 대문자와 밑줄만 쓸 수 있습니다",
}

_TYPE_MESSAGES: dict[str, str] = {
    "string_type": "글자(문자열)여야 하는데 {value}이 적혀 있습니다",
    "int_type": "정수여야 하는데 {value}이 적혀 있습니다",
    "int_parsing": "정수여야 하는데 {value}이 적혀 있습니다",
    "int_from_float": "정수여야 하는데 소수 {value}이 적혀 있습니다",
    "float_type": "숫자여야 하는데 {value}이 적혀 있습니다",
    "float_parsing": "숫자여야 하는데 {value}이 적혀 있습니다",
    "bool_type": "true 또는 false여야 하는데 {value}이 적혀 있습니다",
    "bool_parsing": "true 또는 false여야 하는데 {value}이 적혀 있습니다",
    "list_type": "목록([ ])이어야 하는데 {value}이 적혀 있습니다",
    "dict_type": "객체({ })여야 하는데 {value}이 적혀 있습니다",
    "model_type": "객체({ })여야 하는데 {value}이 적혀 있습니다",
    "model_attributes_type": "객체({ })여야 하는데 {value}이 적혀 있습니다",
    "date_type": "날짜(YYYY-MM-DD)여야 하는데 {value}이 적혀 있습니다",
    "date_parsing": "날짜(YYYY-MM-DD)여야 하는데 {value}이 적혀 있습니다",
    "date_from_datetime_parsing": "날짜(YYYY-MM-DD)여야 하는데 {value}이 적혀 있습니다",
    "date_from_datetime_inexact": "날짜(YYYY-MM-DD)여야 하는데 시각 {value}이 적혀 있습니다",
    "datetime_type": "시각(YYYY-MM-DDTHH:MM:SS+09:00)이어야 하는데 {value}이 적혀 있습니다",
    "datetime_parsing": "시각(YYYY-MM-DDTHH:MM:SS+09:00)이어야 하는데 {value}이 적혀 있습니다",
    "datetime_from_date_parsing": (
        "시각(YYYY-MM-DDTHH:MM:SS+09:00)이어야 하는데 {value}이 적혀 있습니다"
    ),
    "none_required": "비워 두어야(null) 하는데 {value}이 적혀 있습니다",
}

_PRIORITY = ("enum", "literal_error", "extra_forbidden", "missing", "value_error")


def _quote(value: Any) -> str:
    if isinstance(value, dict):
        return "객체({ })"
    if isinstance(value, list):
        return "목록([ ])"
    if value is None:
        return "'null'"
    if isinstance(value, bool):
        return f"'{str(value).lower()}'"
    return f"'{value}'"


def _value_at(data: Any, loc: tuple[Any, ...]) -> tuple[str, Any, bool]:
    """loc를 실제 데이터 경로로 바꾼다. (경로, 그 자리의 값, 경로가 데이터에 실제로 있는가)"""
    current = data
    path = ""
    exists = True
    for part in loc:
        if isinstance(current, dict) and isinstance(part, str) and part in current:
            current = current[part]
            path = join_path(path, part)
        elif isinstance(current, list) and isinstance(part, int) and 0 <= part < len(current):
            current = current[part]
            path = join_path(path, part)
        else:
            # union 꼬리표('str', 'float', 'function-after[...]')나 없는 키는 경로에 넣지 않는다.
            if isinstance(part, str) and isinstance(current, dict) and part not in current:
                # 'missing'·'extra_forbidden'은 없는 키 이름이 경로가 된다.
                return join_path(path, part), None, False
            break
    return path, current, exists


def _allowed_text(ctx: dict[str, Any] | None) -> str:
    expected = str((ctx or {}).get("expected", ""))
    return expected.replace(" or ", ", ")


def _message_for(err: dict[str, Any], value: Any, path: str) -> str:
    kind = err["type"]
    ctx = err.get("ctx") or {}
    if kind in ("enum", "literal_error"):
        return f"{_allowed_text(ctx)} 중 하나여야 하는데 {_quote(value)}이 적혀 있습니다"
    if kind == "extra_forbidden":
        key = path.rsplit(".", 1)[-1] if "." in path else path
        return f"모르는 키 '{key}'입니다 (오타인지 확인해 주세요. 설명은 `_설명` 키에 적습니다)"
    if kind == "missing":
        return "꼭 적어야 하는 칸인데 없습니다"
    if kind == "string_too_short":
        return "비워 둘 수 없습니다"
    if kind == "string_too_long":
        return f"{ctx.get('max_length')}자 이내여야 합니다"
    if kind == "string_pattern_mismatch":
        hint = _PATTERN_HINTS.get(
            str(ctx.get("pattern")), f"허용 형식({ctx.get('pattern')})이 아닙니다"
        )
        return f"{hint}: {_quote(value)}"
    if kind in ("greater_than_equal", "greater_than"):
        bound = ctx.get("ge", ctx.get("gt"))
        return f"{bound} 이상이어야 하는데 {_quote(value)}이 적혀 있습니다"
    if kind in ("less_than_equal", "less_than"):
        bound = ctx.get("le", ctx.get("lt"))
        return f"{bound} 이하여야 하는데 {_quote(value)}이 적혀 있습니다"
    if kind == "too_short":
        return f"항목이 {ctx.get('min_length')}개 이상이어야 합니다"
    if kind == "too_long":
        return f"항목이 {ctx.get('max_length')}개 이하여야 합니다"
    if kind == "value_error":
        return str(err.get("msg", "")).replace("Value error, ", "", 1)
    template = _TYPE_MESSAGES.get(kind)
    if template:
        return template.format(value=_quote(value))
    return str(err.get("msg", kind))


def pydantic_errors_to_fields(
    exc: ValidationError, data: Any, document: LoadedDocument | None = None
) -> list[FieldError]:
    """ValidationError를 칸별 오류 목록으로 바꾼다.

    같은 칸의 여러 오류(union 꼬리표 등)는 가장 뜻이 분명한 것 하나로 줄인다.
    """
    chosen: dict[str, tuple[int, FieldError]] = {}
    for err in exc.errors():
        path, value, _exists = _value_at(data, tuple(err["loc"]))
        message = _message_for(err, value, path)
        line = document.line_of(path) if document else None
        rank = _PRIORITY.index(err["type"]) if err["type"] in _PRIORITY else len(_PRIORITY)
        candidate = FieldError(path=path, message=message, line=line)
        previous = chosen.get(path)
        if previous is None or rank < previous[0]:
            chosen[path] = (rank, candidate)
    return [
        item[1] for item in sorted(chosen.values(), key=lambda it: (it[1].line or 0, it[1].path))
    ]


def format_field_error(error: FieldError) -> str:
    """'N번째 줄 <경로>: <이유>' 한 줄. 경로가 비어 있으면 '(파일 전체)'."""
    path = error.path or "(파일 전체)"
    if error.line is not None:
        return f"{error.line}번째 줄 {path}: {error.message}"
    return f"{path}: {error.message}"


def allowed_value_error(
    path: str, allowed: Iterable[str], value: Any, line: int | None = None
) -> FieldError:
    """허용 값 밖 오류를 계약 문구로 만든다(검사기 공통)."""
    allowed_text = ", ".join(f"'{item}'" for item in allowed)
    return FieldError(
        path=path,
        message=f"{allowed_text} 중 하나여야 하는데 {_quote(value)}이 적혀 있습니다",
        line=line,
    )
