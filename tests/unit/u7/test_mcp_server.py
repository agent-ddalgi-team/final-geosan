"""#927: MCP 서버(geosan mcp) — PC의 AI 앱이 영업 기록을 지운 사본으로 읽는다(PM 결정 2026-11-25).

실제 임시 DB로 본다. AI 앱 대신 시험이 MCP 메시지(JSON-RPC)를 직접 보낸다. 외부 AI는 부르지 않는다.
가상 회사 4곳(A정밀을 이름만 바꾼 사본)만 쓴다(거산 실제 사양 아님).
메모의 이름·전화는 지어낸 것이다.
"""

import io
import json
from datetime import date

import pytest

from geosan.api import mcp_tools
from geosan.api.mcp_server import PROTOCOL_VERSIONS, McpServer, serve_stdio
from geosan.commands.mcp import run_mcp
from geosan.config.app_settings import read_app_settings
from geosan.config.models import AppSetting
from geosan.evidence.sales_record_gate import ScrubbedRecordText
from geosan.evidence.transfer import TransferLog
from geosan.records.models import AnalysisFeedback
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from tests.unit.u7 import test_coach_similar as cases
from tests.unit.u7 import test_sales_assistant as support

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
record = support.record
won = cases.won
name_of = cases.name_of

STAFF = "park-lee"
PLANTED = ("이영희", "영희", "010-2222-3333")


@pytest.fixture
def mcp_env(assistant_env):
    """a: 기록 없음 / b: 통화(이름·전화 든 메모) 뒤 성사 / c: 가격 이유 거절 / d: 기록 없음."""
    client, opp_ids, _fake = assistant_env
    _a, b, c, _d = opp_ids
    won(client, b)
    record(
        client,
        c,
        {"status": "LOST", "lostReasonCode": "PRICE", "reason": "지금 외주 단가보다 높다는 답"},
    )
    return McpServer(STAFF), opp_ids


def call(server, name, arguments=None, request_id=1):
    reply = server.handle(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        }
    )
    return reply


def text_of(reply):
    result = reply["result"]
    return result["content"][0]["text"], result["isError"]


def mcp_logs():
    return [row for row in support.logs() if row[1] == "MCP_TOOL"]


# ---------------------------------------------------------------------------
# 말 주고받기(MCP 규격)
# ---------------------------------------------------------------------------


def test_initialize_list_and_protocol_errors(mcp_env):
    """Given AI 앱 / When 시작·도구 목록·틀린 요청 / Then 규격대로 답한다(도구 5개, 읽기 전용)."""
    server, _ = mcp_env
    hello = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2025-06-18"},
        }
    )["result"]
    assert hello["protocolVersion"] == "2025-06-18"
    assert hello["capabilities"] == {"tools": {"listChanged": False}}
    assert hello["serverInfo"]["name"] == "geosan"
    unknown = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "initialize",
            "params": {"protocolVersion": "1999-01-01"},
        }
    )["result"]
    assert unknown["protocolVersion"] == PROTOCOL_VERSIONS[0]
    # 알림에는 답하지 않는다.
    assert server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    assert server.handle({"jsonrpc": "2.0", "id": 3, "method": "ping"})["result"] == {}

    tools = server.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/list"})["result"]["tools"]
    assert [tool["name"] for tool in tools] == [
        "find_companies",
        "company_records",
        "similar_won",
        "similar_lost",
        "past_analyses",
    ]
    assert all(tool["annotations"]["readOnlyHint"] for tool in tools)
    assert all(tool["inputSchema"]["additionalProperties"] is False for tool in tools)

    assert (
        server.handle({"jsonrpc": "2.0", "id": 5, "method": "resources/list"})["error"]["code"]
        == -32601
    )
    assert call(server, "drop_table")["error"]["code"] == -32602
    assert server.handle(["not", "an", "object"])["error"]["code"] == -32600
    assert mcp_logs() == []


def test_stdio_reads_one_line_per_message_and_reports_bad_json(mcp_env):
    """Given 한 줄에 메시지 하나 / When 읽기 / Then 답만 한 줄씩, 못 읽은 줄은 오류로 답한다."""
    server, _ = mcp_env
    reader = io.StringIO(
        '{"jsonrpc":"2.0","id":1,"method":"ping"}\n'
        "\n"
        '{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
        "{not json\n"
    )
    writer = io.StringIO()
    serve_stdio(server, reader, writer)
    replies = [json.loads(line) for line in writer.getvalue().splitlines()]
    assert replies[0] == {"jsonrpc": "2.0", "id": 1, "result": {}}
    assert replies[1]["error"]["code"] == -32700
    assert len(replies) == 2


# ---------------------------------------------------------------------------
# 도구: 지운 사본과 전송 기록
# ---------------------------------------------------------------------------


def test_company_records_returns_scrubbed_copy_and_logs_one_row(mcp_env):
    """Given 이름·전화가 든 메모 / When 회사 기록 / Then 지운 사본만, 기록 1행, DB는 그대로."""
    server, opp_ids = mcp_env
    b = opp_ids[1]
    before = support.row_counts()

    text, is_error = text_of(call(server, "company_records", {"oppId": b}))

    assert not is_error, text
    assert name_of(b) in text and f"oppId {b}" in text
    assert "상태: 성사" in text and "흐름: 10/10 전화 연결됨" in text
    assert "품질팀 [이름] 과장 통화. 샘플 보내 달라함" in text
    assert cases.WON_REASON in text
    assert "[가상·거산 실제 사양 아님]" in text
    for planted in PLANTED:
        assert planted not in text, planted
    assert support.row_counts() == before
    assert mcp_logs() == [(b, "MCP_TOOL", "ALLOWED", 1)]
    with session_scope() as session:
        row = session.query(TransferLog).filter_by(kind="MCP_TOOL").one()
        assert (row.purpose, row.requested_by, float(row.cost_usd)) == ("MCP_TOOL", STAFF, 0.0)


def test_find_companies_filters_and_marks_every_company(mcp_env):
    """Given 성사 1·거절 1·기록 없음 2 / When 회사 찾기 / Then 거른 회사만, 회사마다 기록."""
    server, opp_ids = mcp_env
    a, b, c, d = opp_ids

    text, is_error = text_of(call(server, "find_companies", {"status": "WON"}))
    assert not is_error, text
    assert text.startswith("찾은 회사 1곳") and name_of(b) in text and name_of(c) not in text

    text, _ = text_of(call(server, "find_companies", {"status": "LOST"}, request_id=2))
    assert "상태: 거절(가격)" in text

    text, _ = text_of(call(server, "find_companies", {"name": "B금속"}, request_id=3))
    assert name_of(b) in text and name_of(a) not in text

    text, _ = text_of(call(server, "find_companies", {"limit": 2}, request_id=4))
    assert "찾은 회사 4곳(앞 2곳만 보임)" in text
    # 최근에 접촉한 회사가 먼저다(b는 10/10에 통화했다).
    assert text.splitlines()[1].startswith(f"- {name_of(b)}")

    rows = mcp_logs()
    assert sum(row[3] for row in rows) == 4  # 호출 4번
    assert {row[0] for row in rows} <= {a, b, c, d}


def test_bad_arguments_are_tool_errors_without_logs(mcp_env):
    """Given 틀린 인자 / When 도구 / Then 도구 오류 글로 알리고 전송 기록은 남기지 않는다."""
    server, _ = mcp_env
    for name, arguments in (
        ("find_companies", {"status": "DONE"}),
        ("find_companies", {"limit": 0}),
        ("find_companies", {"limit": True}),
        ("company_records", {}),
        ("company_records", {"oppId": "opp-none"}),
        ("past_analyses", {"feedbackId": "feedback-none"}),
    ):
        text, is_error = text_of(call(server, name, arguments))
        assert is_error, (name, arguments, text)
    assert mcp_logs() == []


def test_similar_won_and_lost_use_the_coach_rule(mcp_env):
    """Given 같은 공정의 성사 b·거절 c / When a 기준 / Then 성사엔 b만, 거절엔 c만(이유 포함)."""
    server, opp_ids = mcp_env
    a, b, c, _d = opp_ids

    text, is_error = text_of(call(server, "similar_won", {"oppId": a}))
    assert not is_error, text
    assert "성사 회사 1곳" in text and name_of(b) in text and name_of(c) not in text
    assert f"겹치는 것({name_of(a)} 기준): 공정" in text
    for planted in PLANTED:
        assert planted not in text, planted

    text, _ = text_of(call(server, "similar_lost", {"oppId": a}, request_id=2))
    assert "거절 회사 1곳" in text and name_of(c) in text and "거절(가격)" in text
    assert "지금 외주 단가보다 높다는 답" in text

    assert mcp_logs() == [(b, "MCP_TOOL", "ALLOWED", 1), (c, "MCP_TOOL", "ALLOWED", 1)]


def test_similar_tools_are_off_when_limit_is_zero(mcp_env):
    server, opp_ids = mcp_env
    support.change_assistant(coachSimilarWonLimit=0)
    text, is_error = text_of(call(server, "similar_won", {"oppId": opp_ids[0]}))
    assert is_error and "꺼져" in text


# ---------------------------------------------------------------------------
# 문: 스위치·하루 한도·지우기 재검사
# ---------------------------------------------------------------------------


def test_switch_off_returns_nothing_and_logs_a_rejection(mcp_env):
    """Given 영업 기록 스위치 꺼짐 / When 회사 기록 보기 / Then 아무것도 돌려주지 않고 거부 1행."""
    server, opp_ids = mcp_env
    b = opp_ids[1]
    support.use_external_ai(salesRecordsEnabled=False)

    text, is_error = text_of(call(server, "company_records", {"oppId": b}))

    assert is_error and "꺼져" in text and name_of(b) not in text
    assert mcp_logs() == [(b, "MCP_TOOL", "REJECTED", 0)]


def test_daily_limit_counts_only_mcp_calls(mcp_env):
    """Given 하루 한도 1 / When 두 번째 호출 / Then 거부 1행. 영업 비서·코치 한도와 따로 센다."""
    server, opp_ids = mcp_env
    b = opp_ids[1]
    support.change_assistant(mcpDailyLimit=1)

    first, first_error = text_of(call(server, "company_records", {"oppId": b}))
    second, second_error = text_of(call(server, "company_records", {"oppId": b}, request_id=2))

    assert not first_error, first
    assert second_error and "한도" in second
    assert mcp_logs() == [(b, "MCP_TOOL", "ALLOWED", 1), (b, "MCP_TOOL", "REJECTED", 0)]
    with session_scope() as session:
        assert mcp_tools.mcp_calls_today(session) == 1
    # 영업 비서(SALES_RECORD) 하루 횟수에는 세지 않는다.
    from geosan.evidence.sales_record_gate import sales_record_calls_today

    assert sales_record_calls_today() == 0


def test_text_left_unscrubbed_rejects_the_whole_call(mcp_env, monkeypatch):
    """Given 지우기를 건너뛴 글 / When 도구 / Then 문이 다시 검사해 전체 거부하고 거부 1행."""
    server, opp_ids = mcp_env
    b = opp_ids[1]

    def skip_scrub(texts, keep_words=()):
        return [ScrubbedRecordText(text, 0, 0) for text in texts]

    monkeypatch.setattr(mcp_tools, "scrub_sales_records", skip_scrub)

    text, is_error = text_of(call(server, "company_records", {"oppId": b}))

    assert is_error and "010-2222-3333" not in text
    assert mcp_logs() == [(b, "MCP_TOOL", "REJECTED", 0)]


# ---------------------------------------------------------------------------
# 지난 영업 분석
# ---------------------------------------------------------------------------


def saved_analysis(anchor, *, with_log=True):
    """[AI 분석 받기]가 저장해 둔 것과 같은 모양의 행 하나."""
    with session_scope() as session:
        log_id = None
        if with_log:
            log_id = new_id("transfer")
            session.add(
                TransferLog(
                    transfer_log_id=log_id,
                    occurred_at=utcnow(),
                    opp_id=anchor,
                    purpose="EXTERNAL_AI",
                    kind="SALES_ANALYSIS",
                    mode="EXTERNAL",
                    security_grade="EXTERNAL_AI_OK",
                    decision="ALLOWED",
                    requested_by=STAFF,
                    call_count=1,
                )
            )
        feedback_id = new_id("feedback")
        session.add(
            AnalysisFeedback(
                feedback_id=feedback_id,
                period_from=date(2026, 11, 1),
                period_to=date(2026, 11, 20),
                input_hash="0" * 64,
                prompt_version="test",
                response={
                    "failure": {"why": [{"text": "견적 뒤 답이 끊김", "evidence": ["거절 1곳"]}]},
                    "success": {"why": [{"text": "샘플을 먼저 보냄", "evidence": []}]},
                    "next": [{"text": "견적 뒤 3일 안에 다시 전화", "evidence": []}],
                    "heldBack": [],
                    "comparedToPrevious": None,
                },
                transfer_log_id=log_id,
                created_by=STAFF,
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
        return feedback_id


def test_past_analyses_list_and_one(mcp_env):
    """Given 저장된 분석 2건(하나는 전송 기록 없음) / When 목록·한 건 / Then 기록 있는 것만."""
    server, opp_ids = mcp_env
    a = opp_ids[0]
    kept = saved_analysis(a)
    saved_analysis(a, with_log=False)

    text, is_error = text_of(call(server, "past_analyses"))
    assert not is_error, text
    assert text.startswith("지난 영업 분석 1건") and kept in text
    assert "첫 줄: 견적 뒤 3일 안에 다시 전화" in text

    text, is_error = text_of(call(server, "past_analyses", {"feedbackId": kept}, request_id=2))
    assert not is_error, text
    assert "기간 2026-11-01 ~ 2026-11-20" in text
    assert "[실패 · 왜]\n- 견적 뒤 답이 끊김 (근거: 거절 1곳)" in text
    assert "[다음 할 일]\n- 견적 뒤 3일 안에 다시 전화" in text
    assert [row[0] for row in mcp_logs()] == [a, a]


# ---------------------------------------------------------------------------
# 설정·명령
# ---------------------------------------------------------------------------


def test_old_db_copy_reads_mcp_daily_limit_from_example(mcp_env):
    """Given 칸이 없는 옛 DB 사본 / When 설정 읽기 / Then 예시 파일 값(200)."""
    with session_scope() as session:
        row = session.get(AppSetting, "assistant")
        row.value = {k: v for k, v in row.value.items() if k != "mcpDailyLimit"}
    with session_scope() as session:
        assert read_app_settings(session).assistant.mcp_daily_limit == 200


def test_command_refuses_viewer_and_serves_stdio(mcp_env, monkeypatch, capsys):
    """Given 보기 전용 키 / When geosan mcp / Then 종료 1. 기록 담당자면 표준 출력에 답만 쓴다."""
    assert run_mcp("viewer") == 1
    assert "보기 전용" in capsys.readouterr().err

    monkeypatch.setattr("sys.stdin", io.StringIO('{"jsonrpc":"2.0","id":7,"method":"ping"}\n'))
    assert run_mcp(STAFF) == 0
    captured = capsys.readouterr()
    assert captured.out == '{"jsonrpc": "2.0", "id": 7, "result": {}}\n'
    assert "MCP 서버 시작" in captured.err
