"""#927 MCP 서버의 말 주고받기(PM 결정 2026-11-25). 계약 C8 `geosan mcp`.

MCP(Model Context Protocol)는 AI 앱이 바깥 도구를 부르는 공통 규격이다. 여기서는 표준 입출력
(한 줄에 JSON-RPC 2.0 메시지 하나)만 쓴다: 앱이 `geosan mcp`를 띄우고 그 표준 입력으로 요청을
보내면, 우리는 표준 출력으로 답한다. 인터넷 주소는 열지 않는다(배포 서버와 상관없음).

새 꾸러미(MCP SDK)는 넣지 않고 손으로 만든다: 쓰는 메시지가 넷(initialize, ping, tools/list,
tools/call)뿐이고, 런타임 의존성에 HTTP 클라이언트·LLM SDK를 넣지 않는다는 보안 설계 4장
(pyproject.toml)을 지키려고. 도구와 그 문은 `geosan.api.mcp_tools`에 있다.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, TextIO

from geosan.api.mcp_tools import TOOLS_BY_NAME, available_tools, call_tool
from geosan.config.app_settings import read_app_settings
from geosan.storage.session import session_scope

JSONRPC = "2.0"
# 지원하는 규격 판(새 것부터). 앱이 말한 판을 알면 그대로, 모르면 가장 새 것으로 답한다.
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
SERVER_INFO = {"name": "geosan", "title": "거산 영업 기록", "version": "0.1.0"}
INSTRUCTIONS = (
    "거산케미칼 영업지원 프로그램의 영업 기록을 읽는 도구입니다(읽기 전용). "
    "회사를 물으면 먼저 find_companies로 oppId를 찾고, company_records·similar_won·"
    "similar_lost에 넘깁니다. 지난 영업 분석은 past_analyses입니다. 전화·이메일·사람 이름은 "
    "지운 사본이며, '[가상·거산 실제 사양 아님]'이 붙은 회사는 시연용 가상 회사입니다."
)

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

logger = logging.getLogger(__name__)


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC, "id": request_id, "error": {"code": code, "message": message}}


def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC, "id": request_id, "result": result}


class McpServer:
    """메시지 하나를 받아 답 하나(알림이면 None)를 낸다. 입출력과 떼어 시험·코치가 쓴다."""

    def __init__(self, staff_key: str, db_path: Path | str | None = None) -> None:
        self.staff_key = staff_key
        self.db_path = db_path

    def handle(self, message: Any) -> dict[str, Any] | None:
        if not isinstance(message, dict) or message.get("jsonrpc") != JSONRPC:
            return _error(None, INVALID_REQUEST, "JSON-RPC 2.0 요청 객체가 아닙니다.")
        method = message.get("method")
        if "id" not in message:
            return None  # 알림(notifications/initialized 등)은 답하지 않는다.
        request_id = message["id"]
        if not isinstance(method, str):
            return _error(request_id, INVALID_REQUEST, "method가 없습니다.")
        params = message.get("params") or {}
        if not isinstance(params, dict):
            return _error(request_id, INVALID_PARAMS, "params는 객체여야 합니다.")
        if method == "initialize":
            asked = params.get("protocolVersion")
            version = asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
            return _result(
                request_id,
                {
                    "protocolVersion": version,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": SERVER_INFO,
                    "instructions": INSTRUCTIONS,
                },
            )
        if method == "ping":
            return _result(request_id, {})
        if method == "tools/list":
            return _result(request_id, {"tools": [tool.listing() for tool in self._tools()]})
        if method == "tools/call":
            return self._call(request_id, params)
        return _error(request_id, METHOD_NOT_FOUND, f"모르는 요청입니다: {method}")

    def _tools(self) -> list:
        """지금 설정에서 알리는 도구(#932 기존 고객 도구는 켰을 때만). DB를 짧게 읽는다."""
        with session_scope(self.db_path) as session:
            return available_tools(read_app_settings(session))

    def _call(self, request_id: Any, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        if name not in TOOLS_BY_NAME:
            return _error(request_id, INVALID_PARAMS, f"모르는 도구입니다: {name}")
        try:
            outcome = call_tool(name, params.get("arguments"), self.staff_key, self.db_path)
        except Exception:
            # 앱에는 실패만 알리고(값·내부 글 없음), 자세한 것은 표준 오류로 남긴다.
            logger.exception("MCP 도구 %s 실패", name)
            return _error(request_id, INTERNAL_ERROR, "도구를 실행하지 못했습니다.")
        return _result(
            request_id,
            {"content": [{"type": "text", "text": outcome.text}], "isError": outcome.is_error},
        )


def serve_stdio(server: McpServer, reader: TextIO, writer: TextIO) -> None:
    """입력이 끝날 때까지 한 줄씩 읽어 답한다. 표준 출력에는 답 말고 아무것도 쓰지 않는다."""
    for line in reader:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except ValueError:
            reply: dict[str, Any] | None = _error(None, PARSE_ERROR, "JSON을 읽지 못했습니다.")
        else:
            reply = server.handle(message)
        if reply is not None:
            writer.write(json.dumps(reply, ensure_ascii=False) + "\n")
            writer.flush()
