"""#927 `geosan mcp --by <담당자 키>`: PC의 AI 앱에 붙는 MCP 서버(표준 입출력, 읽기 전용). 계약 C8.

AI 앱(Claude 앱 등)의 설정에 이 명령을 적어 두면 앱이 필요할 때 띄운다. 표준 출력은 MCP 메시지
전용이라, 안내 글은 모두 표준 오류로 낸다. DB는 GEOSAN_DB_PATH(다른 명령과 같음)를 읽는다.
"""

import logging
import sys

from sqlalchemy.exc import SQLAlchemyError

from geosan.api.deps import runtime_for, with_account_staff
from geosan.api.staff_accounts import accounts_mode, active_accounts
from geosan.config.app_settings import read_app_settings
from geosan.storage.session import session_scope

EXIT_OK = 0
EXIT_INPUT = 1
EXIT_RUN_FAILED = 2


def _say(text: str) -> None:
    print(text, file=sys.stderr, flush=True)


def recording_staff(session, staff_key: str) -> bool:
    """화면과 같은 기준: 계정 방식이면 막지 않은 담당자 계정, 아니면 설정의 기록 담당자."""
    runtime = runtime_for(session)
    if accounts_mode(session, runtime.app_settings.access_protection.enabled):
        runtime = with_account_staff(runtime, active_accounts(session))
    return runtime.app_settings.is_recording_staff(staff_key)


def run_mcp(staff_key: str) -> int:
    try:
        with session_scope() as session:
            if read_app_settings(session) is None:
                _say("앱 설정을 먼저 등록해 주세요(check-config).")
                return EXIT_INPUT
            allowed = recording_staff(session, staff_key)
    except SQLAlchemyError:
        _say("DB를 열지 못했습니다. GEOSAN_DB_PATH와 init-db 여부를 확인해 주세요.")
        return EXIT_RUN_FAILED
    if not allowed:
        _say("기록 담당자 키(계정이 있으면 막지 않은 담당자 계정 아이디)로 실행해 주세요.")
        _say("보기 전용 계정은 쓸 수 없습니다.")
        return EXIT_INPUT
    from geosan.api.mcp_server import McpServer, serve_stdio

    # 표준 출력을 더럽히지 않게 로그는 표준 오류로만 보낸다.
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    _say(f"거산 MCP 서버 시작(담당자 {staff_key}). AI 앱이 연결을 끊으면 끝납니다.")
    serve_stdio(McpServer(staff_key), sys.stdin, sys.stdout)
    _say("거산 MCP 서버를 마쳤습니다.")
    return EXIT_OK
