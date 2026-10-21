"""위치 정보를 주는 로더 (계약 C7, BR2.2).

JSON·YAML을 ruamel.yaml 하나로 읽는다. JSON은 YAML 1.2의 부분집합이라 같은 파서가 읽으며,
읽은 뒤에도 "어느 값이 몇 번째 줄에 있었는지"를 돌려준다. 오류를
"N번째 줄 <항목>: <이유>"로 보이기 위한 바탕이다.

- `_설명` 키는 어느 깊이에 있든 무시한다(검사·저장 대상에서 뺀다).
- UTF-8(BOM 허용)만 받는다. 다른 인코딩은 쉬운 말 오류.
- 같은 키가 두 번 나오면 오류(줄 번호 포함).
- 파일 맨 바깥은 객체(`{ }` 또는 YAML 매핑)여야 한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.constructor import DuplicateKeyError
from ruamel.yaml.error import YAMLError

from geosan.config.errors import FieldError, InputError

DESCRIPTION_KEY = "_설명"
"""어느 객체에든 쓸 수 있는 설명 키. 검사기는 이 키를 무시한다(C7 공통 규칙)."""


def join_path(parent: str, key: str | int) -> str:
    """경로 문자열을 만든다. 예: ('requirements', 1) → 'requirements[1]', ('a', 'b') → 'a.b'."""
    if isinstance(key, int):
        return f"{parent}[{key}]"
    return f"{parent}.{key}" if parent else str(key)


@dataclass
class LoadedDocument:
    """읽은 파일 한 개: 설명 키를 뺀 순수 데이터와 경로별 줄 번호."""

    path: Path
    data: Any
    lines: dict[str, int] = field(default_factory=dict)
    """경로('' = 파일 전체, 'a.b[1].c') → 1부터 세는 줄 번호."""

    def line_of(self, path: str) -> int | None:
        """그 경로의 줄 번호. 없으면 가장 가까운 상위 경로의 줄 번호를 돌려준다."""
        current = path
        while True:
            if current in self.lines:
                return self.lines[current]
            if not current:
                return None
            current = _parent_path(current)


def _parent_path(path: str) -> str:
    if path.endswith("]"):
        return path[: path.rindex("[")]
    if "." in path:
        return path[: path.rindex(".")]
    return ""


def _read_text(path: Path) -> str:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raise InputError(
            message=f"파일을 찾을 수 없습니다: {path}",
            next_action="경로와 파일 이름을 확인해 주세요.",
            fields=[FieldError(path="", message=f"파일을 찾을 수 없습니다: {path}")],
        ) from None
    except OSError as exc:
        raise InputError(
            message=f"파일을 읽을 수 없습니다: {path} ({exc.strerror})",
            next_action="파일 권한과 경로를 확인해 주세요.",
        ) from exc
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise InputError(
            message="UTF-8로 저장해 주세요 (다른 인코딩으로 보입니다).",
            next_action="편집기에서 '다른 이름으로 저장 → 인코딩 UTF-8'로 다시 저장해 주세요.",
            fields=[
                FieldError(path="", message="UTF-8로 저장해 주세요 (다른 인코딩으로 보입니다)")
            ],
        ) from None


def _parse(text: str, path: Path) -> Any:
    yaml = YAML(typ="rt")
    yaml.allow_duplicate_keys = False
    try:
        return yaml.load(text)
    except DuplicateKeyError as exc:
        line = _mark_line(exc)
        key = _duplicate_key_name(exc)
        message = (
            f"같은 키 '{key}'가 두 번 나옵니다. 하나만 남겨 주세요."
            if key
            else ("같은 키가 두 번 나옵니다. 하나만 남겨 주세요.")
        )
        raise InputError(
            message=f"{path.name}: {message}",
            next_action="중복된 항목 중 하나를 지우고 다시 실행해 주세요.",
            fields=[FieldError(path="", message=message, line=line)],
        ) from None
    except YAMLError as exc:
        line = _mark_line(exc)
        hint = " 탭 대신 공백으로 들여써 주세요." if "\t" in text else ""
        message = f"파일 형식을 읽을 수 없습니다 (JSON/YAML 문법 오류).{hint}"
        raise InputError(
            message=f"{path.name}: {message}",
            next_action="괄호·쉼표·따옴표가 맞는지 확인해 주세요. 줄 번호 근처를 보면 됩니다.",
            fields=[FieldError(path="", message=message, line=line)],
        ) from None


def _mark_line(exc: Exception) -> int | None:
    for attr in ("problem_mark", "context_mark"):
        mark = getattr(exc, attr, None)
        if mark is not None and getattr(mark, "line", None) is not None:
            return int(mark.line) + 1
    return None


def _duplicate_key_name(exc: DuplicateKeyError) -> str | None:
    text = str(exc)
    marker = 'found duplicate key "'
    if marker in text:
        rest = text.split(marker, 1)[1]
        return rest.split('"', 1)[0]
    return None


def _convert(node: Any, path: str, lines: dict[str, int]) -> Any:
    """ruamel 노드를 순수 파이썬 값으로 바꾸면서 경로별 줄 번호를 모은다. `_설명` 키는 뺀다."""
    if isinstance(node, CommentedMap):
        result: dict[str, Any] = {}
        for key, value in node.items():
            key_text = str(key)
            if key_text == DESCRIPTION_KEY:
                continue
            child_path = join_path(path, key_text)
            try:
                lines[child_path] = int(node.lc.key(key)[0]) + 1
            except (KeyError, AttributeError, TypeError):
                pass
            result[key_text] = _convert(value, child_path, lines)
        return result
    if isinstance(node, CommentedSeq):
        items: list[Any] = []
        for index, value in enumerate(node):
            child_path = join_path(path, index)
            try:
                lines[child_path] = int(node.lc.item(index)[0]) + 1
            except (KeyError, AttributeError, TypeError, IndexError):
                pass
            items.append(_convert(value, child_path, lines))
        return items
    return _scalar(node)


def _scalar(value: Any) -> Any:
    """ruamel의 특수 스칼라 타입을 기본 타입으로 바꾼다. 날짜는 그대로 둔다(pydantic이 받는다)."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, datetime | date):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, str):
        return str(value)
    return value


def load_document(path: Path | str) -> LoadedDocument:
    """파일 하나를 읽어 LoadedDocument로 돌려준다. 읽기·형식 오류는 InputError(줄 번호 포함)."""
    file_path = Path(path)
    text = _read_text(file_path)
    node = _parse(text, file_path)
    if not isinstance(node, CommentedMap):
        message = "파일 맨 바깥은 { }로 감싼 객체(항목 이름: 값)여야 합니다."
        raise InputError(
            message=f"{file_path.name}: {message}",
            next_action="예시 파일(examples/)과 같은 모양으로 맞춰 주세요.",
            fields=[FieldError(path="", message=message, line=1)],
        )
    lines: dict[str, int] = {"": 1}
    data = _convert(node, "", lines)
    return LoadedDocument(path=file_path, data=data, lines=lines)


def strip_descriptions(value: Any) -> Any:
    """이미 읽은 순수 데이터(dict/list)에서 `_설명` 키를 어느 깊이든 뺀 새 값을 돌려준다."""
    if isinstance(value, dict):
        return {
            str(k): strip_descriptions(v) for k, v in value.items() if str(k) != DESCRIPTION_KEY
        }
    if isinstance(value, list):
        return [strip_descriptions(v) for v in value]
    return value
