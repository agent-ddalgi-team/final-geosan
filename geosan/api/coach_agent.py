"""#916 찾아보는 영업 코치(에이전트 2단계, PM 결정 2026-11-25·26). 계약 C1 lookups·C4·C7.

1단계(#915)는 코드가 정한 조건으로 비슷한 성사 회사를 골라 함께 보냈다(RAG). 여기서는 AI가 무엇을
더 찾아볼지 스스로 고르고, 서버가 그 도구만 실행해 지운 사본을 돌려준 뒤 다시 부른다.

도구는 MCP 서버(#927)와 같은 목록(`mcp_tools.TOOLS`)을 그대로 쓴다. 도구를 더하려면 그 목록에
더하면 코치와 PC의 AI 앱에 함께 생긴다(#932 기존 고객 도구도 같은 자리). 여기서는 전송 기록을
남기지 않는다 — 도구 결과는 코치 호출(kind SALES_COACH)의 문과 전송 기록으로 나간다
(`assistant_llm.coach_with_lookups`).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from geosan.api.mcp_tools import TOOLS, TOOLS_BY_NAME, ToolInputError, run_tool
from geosan.config.app_settings import read_app_settings
from geosan.evidence.assistant_llm import LookupResult
from geosan.storage.session import session_scope


def openai_tools() -> list[dict[str, Any]]:
    """외부 AI에 알리는 도구 목록(Responses API function 도구). MCP tools/list와 같은 내용."""
    return [
        {
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
            # 선택 인자가 있어 엄격 모드를 쓰지 않는다. 인자 검사는 서버(run_tool)가 한다.
            "strict": False,
        }
        for tool in TOOLS
    ]


def lookup_instructions(opp_id: str, rounds: int) -> str:
    """코치 지시문 끝에 붙이는 도구 안내. 이 회사의 oppId를 알려 도구에 넘기게 한다."""
    return (
        "\n[찾아보기]\n"
        f"이 회사의 oppId는 {opp_id}이다. 이번 메모와 보낸 기록만으로 부족할 때만 "
        f"도구로 더 찾아본다(한 번에 하나, 최대 {rounds}번). "
        "예: 비슷한 회사가 왜 거절했는지(similar_lost), 지난 "
        "영업 분석의 제안(past_analyses), 다른 회사의 기록(find_companies → company_records). "
        "찾아본 것에서 근거가 된 내용은 피드백에 회사 이름과 함께 짧게 쓴다. 찾은 기록에 없는 "
        "사실은 지어내지 않는다. 다 찾았으면 정해진 모양의 답만 낸다."
    )


def make_lookup(db_path: Path | str | None = None) -> Callable[[str, dict], LookupResult]:
    """AI가 고른 도구를 실행하는 함수. 부를 때마다 DB를 짧게 열고 닫는다(AI 호출 중 안 붙듦)."""

    def lookup(name: str, arguments: dict) -> LookupResult:
        tool = TOOLS_BY_NAME.get(name)
        if tool is None:
            return LookupResult((), (), f"모르는 도구입니다: {name}", f"모르는 도구 {name}")
        with session_scope(db_path) as session:
            settings = read_app_settings(session)
            try:
                output = run_tool(session, settings, name, arguments)
            except ToolInputError as error:
                return LookupResult((), (), str(error), f"{tool.title}: {error}")
        return LookupResult(output.items, output.opp_ids, output.text, output.head)

    return lookup
