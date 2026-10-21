"""경계 파일: 고치려면 PM에게 먼저 말한다(계약 C2).

흐름 함수의 공통 반환값. 한 흐름 = 한 트랜잭션이며 실패하면 되돌리고 error를 채워 돌려준다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from geosan.config.errors import AppError


@dataclass
class FlowResult:
    """C2 FlowResult: ok, affectedOppIds, newEvalIds, error."""

    ok: bool
    affected_opp_ids: list[str] = field(default_factory=list)
    new_eval_ids: list[str] = field(default_factory=list)
    error: AppError | None = None
    summary: str = ""
    """명령 출력 마지막 줄의 쉬운 한국어 요약. 예: '묶음 b-01, 기회 1건, 지금 바로 연락 검토 1'."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "affectedOppIds": list(self.affected_opp_ids),
            "newEvalIds": list(self.new_eval_ids),
            "error": self.error.to_error_body()["error"] if self.error else None,
        }

    @classmethod
    def failed(cls, error: AppError) -> FlowResult:
        return cls(ok=False, error=error, summary=error.message)
