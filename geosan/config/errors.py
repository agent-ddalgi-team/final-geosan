"""경계 파일: 고치려면 PM에게 먼저 말한다(계약 3장 오류 규칙).

앱 전체가 쓰는 오류 형식 하나.
HTTP 응답은 `{ "error": { message, nextAction, ref, kind?, fields? } }`,
명령은 message·nextAction을 출력하고 종료 코드로 끝낸다. 오류 코드·스택은 로그에만 남긴다(NFR10).
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class FieldError:
    """칸별 오류 한 줄. path는 `requirements[1].reqLevel` 같은 경로, message는 쉬운 한국어."""

    path: str
    message: str
    line: int | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"path": self.path, "message": self.message}
        if self.line is not None:
            data["line"] = self.line
        return data


def new_ref() -> str:
    """로그 대조용 짧은 식별자(8자). 오류 응답·로그에 같이 실린다."""
    return secrets.token_hex(4)


@dataclass
class AppError(Exception):
    """쉬운 말 오류. status는 HTTP 상태(명령에서는 종료 코드 변환에만 쓴다)."""

    message: str
    next_action: str
    status: int = 400
    kind: str | None = None
    fields: list[FieldError] = field(default_factory=list)
    ref: str = field(default_factory=new_ref)

    def __post_init__(self) -> None:
        super().__init__(self.message)

    def to_error_body(self) -> dict[str, Any]:
        """계약 3장 오류 응답 본문."""
        error: dict[str, Any] = {
            "message": self.message,
            "nextAction": self.next_action,
            "ref": self.ref,
        }
        if self.kind:
            error["kind"] = self.kind
        if self.fields:
            error["fields"] = [item.to_dict() for item in self.fields]
        return {"error": error}


class InputError(AppError):
    """입력 검증 실패(파일·요청 본문). HTTP 400, 명령 종료 코드 1."""

    def __init__(
        self,
        message: str,
        next_action: str = "표시된 칸을 고친 뒤 다시 실행해 주세요.",
        fields: list[FieldError] | None = None,
        kind: str | None = None,
    ) -> None:
        super().__init__(
            message=message, next_action=next_action, status=400, kind=kind, fields=fields or []
        )


class ForbiddenError(AppError):
    """담당자 키 없음·목록 밖·viewer (BR9.3). HTTP 403."""

    def __init__(
        self,
        message: str = "담당자를 확인해 주세요",
        next_action: str = "상단에서 담당자를 고르세요",
    ) -> None:
        super().__init__(message=message, next_action=next_action, status=403)


class NotFoundError(AppError):
    """없는 ID. HTTP 404."""

    def __init__(
        self, message: str, next_action: str = "목록으로 돌아가 다시 골라 주세요."
    ) -> None:
        super().__init__(message=message, next_action=next_action, status=404)


class RunFailedError(AppError):
    """저장·흐름 실패(되돌림 뒤). HTTP 500, 명령 종료 코드 2."""

    def __init__(
        self,
        message: str = "저장하지 못했습니다.",
        next_action: str = "다시 시도해 주세요. 계속되면 아래 번호와 함께 문의하세요.",
        kind: str | None = None,
    ) -> None:
        super().__init__(message=message, next_action=next_action, status=500, kind=kind)


def exit_code_for(error: AppError) -> int:
    """명령 종료 코드 변환(C8): 입력 오류 1, 실행 실패 2."""
    return 1 if error.status < 500 else 2
