"""#824: 실제 임시 DB·실제 API로 AI 분석 피드백 시나리오를 확인한다. 외부 AI는 가짜 응답이다.

보낸 글은 가짜 어댑터가 붙잡아 "무엇이 나갔는지"를 본다. 모든 자료는 가상이다(거산 실제 사양 아님).
"""

import json

import pytest
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.config.models import AppSetting
from geosan.evidence import assistant_llm
from geosan.evidence.transfer import TransferLog
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_analysis as support
from tests.unit.u7.test_sales_assistant import FakeAI, use_external_ai

dashboard_env = support.dashboard_env
scenarios("u7/sales_feedback.feature")

URL = "/api/v1/sales-analysis/feedback"
STAFF = {"X-Staff-Key": "park-lee"}
MEMO = "피드백에 나가면 안 되는 가상 한 줄 메모 홍길동"
# 끝난 기록(거절·성사·보류)은 오늘 날짜로 저장되므로 기간 없이(전체) 본다. 앞 기간 비교는 단위 시험.
PERIOD = {}

READING = {
    "failure": {
        "where": [
            {"text": "실패 2곳 가운데 1곳은 연결 전에 멈췄다.", "evidence": ["연결 전: 1곳"]}
        ],
        "why": [{"text": "거절 이유는 가격이었다.", "evidence": ["PRICE: 1건"]}],
        "signals": [{"text": "근거 없는 주장", "evidence": []}],
        "vsSuccess": [],
        "next": [{"text": "견적 전에 물량을 확인한다.", "evidence": ["PRICE: 1건"]}],
    },
    "success": {"where": [], "why": [], "signals": []},
    "next": [],
    "heldBack": ["방문 전 접촉 횟수별 칸은 표본 부족이라 판단 보류"],
}


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    ai = FakeAI()
    ai.raw = json.dumps(READING, ensure_ascii=False)
    monkeypatch.setattr(assistant_llm, "_post", ai)
    return ai


@given("평가된 가상 회사에 거절·성사·보류 기록이 있다", target_fixture="context")
def records(dashboard_env, fake):
    client, (a, b, c, _d) = dashboard_env
    support.record(client, a, support.contact("ABSENT", day="2026-10-15", memo=MEMO))
    support.record(client, a, {"status": "LOST", "lostReasonCode": "PRICE"})
    support.record(client, b, support.contact("REACHED", day="2026-10-16"))
    support.record(client, b, support.contact("REACHED", method="VISIT", day="2026-10-21"))
    support.record(client, b, {"status": "WON"})
    support.record(client, c, support.contact("REACHED", day="2026-10-18"))
    support.record(client, c, {"status": "ON_HOLD"})
    with session_scope() as session:
        names = [row.name for row in session.scalars(select(_customer_model()))]
    return {"client": client, "fake": fake, "names": names}


def _customer_model():
    from geosan.opportunity.models import Customer

    return Customer


@given("영업 기록을 외부 AI로 보내는 스위치가 꺼져 있다")
def switch_off(context):
    use_external_ai(salesRecordsEnabled=False)


@given("영업 기록을 외부 AI로 보내는 스위치가 켜져 있다")
def switch_on(context):
    use_external_ai()


@when("담당자가 [분석 받기]를 누른다")
def press(context):
    context["response"] = context["client"].post(URL, json=PERIOD, headers=STAFF)


@when("담당자가 [분석 받기]를 두 번 누르고 보기 전용 계정이 저장본을 연다")
def press_twice(context):
    client = context["client"]
    first = client.post(URL, json=PERIOD, headers=STAFF)
    assert first.status_code == 200, first.text
    context["second"] = client.post(URL, json=PERIOD, headers=STAFF)
    context["state"] = client.get(URL, params=PERIOD, headers=support.VIEWER)


def _logs():
    with session_scope() as session:
        return [
            (row.kind, row.decision, row.call_count)
            for row in session.scalars(select(TransferLog).order_by(TransferLog.occurred_at))
        ]


@then("422 SALES_RECORDS_DISABLED가 오고 AI에 보낸 것이 없으며 거부 기록이 1행 남는다")
def refused(context):
    response = context["response"]
    assert response.status_code == 422, response.text
    assert response.json()["error"]["kind"] == "SALES_RECORDS_DISABLED"
    assert context["fake"].payloads == []
    assert _logs() == [("SALES_ANALYSIS", "REJECTED", 0)]


@then("AI에 보낸 글은 숫자 표이고 표본 부족 칸에 결론 금지가 붙어 있다")
def sent_table(context):
    assert context["response"].status_code == 200, context["response"].text
    sent = context["fake"].payloads[0]["input"]
    assert sent.startswith("숫자 표")
    assert "표본 부족(결론 금지)" in sent
    assert "PRICE: 1건" in sent
    assert context["fake"].payloads[0]["store"] is False
    assert _logs()[-1] == ("SALES_ANALYSIS", "ALLOWED", 1)


@then("보낸 글에 회사 이름·메모 글·담당자 키가 없다")
def nothing_private(context):
    sent = context["fake"].payloads[0]["input"]
    for planted in [*context["names"], MEMO, "홍길동", "park-lee"]:
        assert planted not in sent, planted


@then("실패 피드백이 근거 숫자와 함께 저장되고 판단 보류 목록이 보인다")
def saved(context):
    data = context["response"].json()["data"]
    assert data["reused"] is False
    feedback = data["feedback"]
    assert feedback["failure"]["why"] == [
        {"text": "거절 이유는 가격이었다.", "evidence": ["PRICE: 1건"]}
    ]
    # 근거 숫자가 없는 주장은 버리고 판단 보류에 몇 개를 뺐는지 적는다.
    assert feedback["failure"]["signals"] == []
    assert "방문 전 접촉 횟수별 칸은 표본 부족이라 판단 보류" in feedback["heldBack"]
    assert "근거 숫자가 없어 뺀 주장 1개" in feedback["heldBack"]
    assert feedback["aiGenerated"] is True
    assert feedback["periodFrom"] is None and feedback["comparedToPrevious"] is None


@then("두 번째는 저장본을 다시 준 것이고 AI 호출은 1번뿐이며 저장본이 지금 기록과 같다고 나온다")
def reused(context):
    second = context["second"]
    assert second.status_code == 200 and second.json()["data"]["reused"] is True
    assert len(context["fake"].payloads) == 1
    state = context["state"]
    assert state.status_code == 200, state.text
    data = state.json()["data"]
    assert data["current"] is True and data["switchOn"] is True
    assert data["feedback"]["feedbackId"] == second.json()["data"]["feedback"]["feedbackId"]
    with session_scope() as session:
        assert session.get(AppSetting, "llm").value["salesRecordsEnabled"] is True
