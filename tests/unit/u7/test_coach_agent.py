"""#916: 찾아보는 영업 코치(에이전트 2단계) — AI가 도구를 골라 찾아본 뒤 코칭한다.

실제 임시 DB·실제 API로 본다. 외부 AI는 정해 둔 순서대로 답하는 가짜다(도구 부르기 → … → 답).
가상 회사 4곳(A정밀을 이름만 바꾼 사본)만 쓴다(거산 실제 사양 아님).
메모의 이름·전화는 지어낸 것이다.
"""

import json

import pytest

from geosan.api import mcp_tools
from geosan.evidence import assistant_llm
from geosan.evidence.sales_record_gate import ScrubbedRecordText
from tests.unit.u7 import test_coach_similar as cases
from tests.unit.u7 import test_sales_assistant as support

dashboard_env = support.dashboard_env
record = support.record
won = cases.won
name_of = cases.name_of

STAFF = {"X-Staff-Key": "park-lee"}
MEMO = "구매 담당과 통화. 단가를 걱정함"
LOST_REASON = "지금 외주 단가보다 높다는 답"
FINAL = {
    "answers": [],
    "nextSchedule": {"actionId": None, "date": None},
    "feedback": ["비슷한 회사는 단가 때문에 거절했어요. 샘플로 품질 차이를 먼저 보여 주세요."],
    "nextCall": [],
    "summary": "단가 걱정",
    "similarAdvice": [],
}


def tool_call(name, arguments, call_id):
    return {
        "type": "function_call",
        "id": f"fc_{call_id}",
        "call_id": call_id,
        "name": name,
        "arguments": arguments if isinstance(arguments, str) else json.dumps(arguments),
        "status": "completed",
    }


def message(body):
    return {
        "type": "message",
        "status": "completed",
        "content": [{"type": "output_text", "text": json.dumps(body, ensure_ascii=False)}],
    }


class ScriptedAI:
    """정해 둔 응답을 차례로 돌려주고 받은 요청을 붙잡아 둔다. 다 쓰면 마지막 것을 되풀이한다."""

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.payloads = []

    def __call__(self, payload, key, deadline):
        self.payloads.append(payload)
        output = self.outputs[min(len(self.payloads), len(self.outputs)) - 1]
        return {
            "status": "completed",
            "usage": {"input_tokens": 1000, "output_tokens": 200},
            "output": output,
        }

    def sent(self, index):
        payload = self.payloads[index]
        value = payload["input"]
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


@pytest.fixture
def agent_env(dashboard_env, monkeypatch):
    """a: 기록 없음 / b: 통화(이름·전화 든 메모) 뒤 성사 / c: 가격 이유 거절 / d: 기록 없음."""
    client, opp_ids = dashboard_env
    support.use_external_ai()
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    _a, b, c, _d = opp_ids
    won(client, b)
    record(client, c, {"status": "LOST", "lostReasonCode": "PRICE", "reason": LOST_REASON})

    def script(*outputs):
        fake = ScriptedAI(outputs)
        monkeypatch.setattr(assistant_llm, "_post", fake)
        return fake

    return client, opp_ids, script


def coach(client, opp_id):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/assistant/coach",
        json={"memo": MEMO, "method": "CALL"},
        headers=STAFF,
    )


def coach_rows():
    return [row for row in support.logs() if row[1] == "SALES_COACH"]


def test_coach_looks_up_with_tools_then_answers(agent_env):
    """Given 비슷한 거절 회사 c / When AI가 similar_lost → company_records를 고름
    Then 서버가 지운 사본을 돌려주고, 세 번째 호출에서 답을 받아 '찾아본 것' 두 줄을 준다."""
    client, opp_ids, script = agent_env
    a, b, c, _d = opp_ids
    fake = script(
        [
            {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "enc-1"},
            tool_call("similar_lost", {"oppId": a}, "call_1"),
        ],
        [
            {
                "type": "reasoning",
                "id": "rs_2",
                "summary": [],
            },  # 암호화 사본 없음 → 되돌려 보내지 않음
            tool_call("company_records", {"oppId": b}, "call_2"),
        ],
        [message(FINAL)],
    )

    response = coach(client, a)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["feedback"] == FINAL["feedback"]
    assert [item["tool"] for item in data["lookups"]] == ["similar_lost", "company_records"]
    assert data["lookups"][0]["label"] == f"{name_of(a)} 기준, 공정·산업이 겹치는 거절 회사 1곳"
    assert data["lookups"][1]["label"] == f"{name_of(b)}의 영업 기록"

    first, second, third = fake.payloads
    # 첫 호출은 지금 코치와 같은 글 하나 + 도구 5개(한 번에 하나), 지시문에 이 회사 oppId.
    assert isinstance(first["input"], str) and first["input"].startswith("[이번 메모]")
    # #932 기존 고객 도구는 existingCustomers.enabled가 꺼져 있으면(기본) 알리지 않는다.
    assert [tool["name"] for tool in first["tools"]] == [
        "find_companies",
        "company_records",
        "similar_won",
        "similar_lost",
        "past_analyses",
    ]
    assert first["tool_choice"] == "auto" and first["parallel_tool_calls"] is False
    assert first["store"] is False and f"oppId는 {a}" in first["instructions"]
    # 두 번째: 앞 호출의 도구 부르기와 그 결과(거절 이유, 다른 회사 이름은 그대로)를 이어 보낸다.
    sent = fake.sent(1)
    assert '"call_id": "call_1"' in sent and '"encrypted_content": "enc-1"' in sent
    assert name_of(c) in sent and "거절(가격)" in sent and LOST_REASON in sent
    # 세 번째: b의 기록(메모 속 이름·전화는 지운 사본). 생각 기록은 암호화 사본만 되돌린다.
    sent = fake.sent(2)
    assert "품질팀 [이름] 과장 통화" in sent
    for planted in ("이영희", "010-2222-3333"):
        assert planted not in sent
    assert '"rs_2"' not in sent
    assert third["tool_choice"] == "auto"

    # 호출마다 문을 거친다: 이 회사에 호출 3행, 실린 회사(c·b)에는 호출 수 0인 표시 행.
    rows = support.logs()
    assert [row for row in rows if row[0] == a and row[1] == "SALES_COACH"] == [
        (a, "SALES_COACH", "ALLOWED", 1)
    ] * 3
    assert any(row[0] == c and row[3] == 0 for row in rows)
    assert any(row[0] == b and row[3] == 0 for row in rows)
    # 도구 결과는 MCP 전송 기록을 따로 남기지 않는다(MCP 하루 한도에도 안 셈).
    assert not any(row[1] == "MCP_TOOL" for row in rows)


def test_last_call_turns_tools_off_and_rounds_follow_settings(agent_env):
    """Given 찾아보기 1번 / When AI가 계속 도구를 고름 / Then 두 번째 호출은 도구를 끄고,
    그래도 도구를 고르면 답이 없는 것으로 알린다(빈 결과로 넘기지 않음)."""
    client, opp_ids, script = agent_env
    a = opp_ids[0]
    support.change_assistant(coachToolRounds=1)
    fake = script([tool_call("past_analyses", {}, "call_1")])

    response = coach(client, a)

    assert response.status_code == 503, response.text
    assert [payload["tool_choice"] for payload in fake.payloads] == ["auto", "none"]
    assert len(coach_rows()) == 2


def test_bad_arguments_and_unknown_tools_get_a_note_not_values(agent_env):
    """Given 틀린 인자·모르는 도구·못 읽는 인자 / When 도구 / Then 안내 글만 돌려주고 계속."""
    client, opp_ids, script = agent_env
    a = opp_ids[0]
    fake = script(
        [tool_call("company_records", {"oppId": "opp-none"}, "call_1")],
        [tool_call("drop_table", {}, "call_2")],
        [tool_call("find_companies", "{not json", "call_3")],
        [message(FINAL)],
    )

    response = coach(client, a)

    assert response.status_code == 200, response.text
    labels = [item["label"] for item in response.json()["data"]["lookups"]]
    assert labels[0].startswith("회사 기록 보기: 그 oppId의 회사가 없습니다")
    assert labels[1] == "모르는 도구 drop_table" and labels[2] == "인자를 읽지 못함"
    assert fake.payloads[-1]["tool_choice"] == "none"


def test_zero_rounds_is_the_old_coach(agent_env):
    """Given coachToolRounds 0 / When 코치 / Then 도구 없이 한 번만 부르고 lookups는 빈 목록."""
    client, opp_ids, script = agent_env
    support.change_assistant(coachToolRounds=0)
    fake = script([message(FINAL)])

    response = coach(client, opp_ids[0])

    assert response.status_code == 200, response.text
    assert response.json()["data"]["lookups"] == []
    (payload,) = fake.payloads
    assert "tools" not in payload


def test_unscrubbed_tool_result_rejects_the_next_call(agent_env, monkeypatch):
    """Given 지우기를 건너뛴 도구 결과 / When 다음 호출 / Then 문이 다시 검사해 전체 거부."""
    client, opp_ids, script = agent_env
    a, b, _c, _d = opp_ids

    def skip_scrub(texts, keep_words=()):
        return [ScrubbedRecordText(text, 0, 0) for text in texts]

    monkeypatch.setattr(mcp_tools, "scrub_sales_records", skip_scrub)
    fake = script([tool_call("company_records", {"oppId": b}, "call_1")], [message(FINAL)])

    response = coach(client, a)

    assert response.status_code == 422, response.text
    assert len(fake.payloads) == 1  # 두 번째는 보내지 않았다
    assert any(row[2] == "REJECTED" for row in coach_rows())
    assert "010-2222-3333" not in fake.sent(0)


def test_switch_off_sends_nothing(agent_env):
    client, opp_ids, script = agent_env
    support.use_external_ai(salesRecordsEnabled=False)
    fake = script([message(FINAL)])

    response = coach(client, opp_ids[0])

    assert response.status_code == 422, response.text
    assert fake.payloads == []
