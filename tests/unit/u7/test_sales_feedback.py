"""#824 AI 분석 피드백: 순수 계산과 창구의 오류·한도·저장본 규칙. 외부 AI는 가짜 응답이다.

모든 자료는 가상이다(거산 실제 사양 아님).
"""

import json
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from geosan.api import analysis_feedback as feedback
from geosan.api.operations import SALES_KINDS
from geosan.evidence import assistant_llm
from geosan.evidence.transfer import KST
from geosan.records.models import AnalysisFeedback
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_analysis as support
from tests.unit.u7.test_sales_assistant import FakeAI, change_assistant, use_external_ai

dashboard_env = support.dashboard_env
URL = "/api/v1/sales-analysis/feedback"
STAFF = {"X-Staff-Key": "park-lee"}

GOOD = {
    "failure": {
        "where": [{"text": "연결 전에 멈춘 곳이 있다.", "evidence": ["연결 전: 1곳"]}],
        "why": [],
        "signals": [],
        "vsSuccess": [],
        "next": [],
    },
    "success": {"where": [], "why": [], "signals": []},
    "next": [{"text": "다음 통화 전에 담당 부서를 확인한다.", "evidence": ["실패 2곳"]}],
    "heldBack": [],
}


@pytest.fixture
def env(dashboard_env, monkeypatch):
    client, opp_ids = dashboard_env
    use_external_ai()
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    ai = FakeAI()
    ai.raw = json.dumps(GOOD, ensure_ascii=False)
    monkeypatch.setattr(assistant_llm, "_post", ai)
    a, b, *_ = opp_ids
    today = utcnow().astimezone(KST).date()
    support.record(client, a, support.contact("REACHED", day=today.isoformat()))
    support.record(client, a, {"status": "LOST", "lostReasonCode": "PRICE"})
    support.record(client, b, support.contact("REACHED", day=today.isoformat()))
    return client, opp_ids, ai


def saved_rows():
    with session_scope() as session:
        return session.scalar(select(func.count()).select_from(AnalysisFeedback))


# ---------------------------------------------------------------------------
# 순수 계산
# ---------------------------------------------------------------------------


def test_previous_period_is_the_same_length_right_before():
    assert feedback.previous_period(date(2026, 10, 1), date(2026, 10, 31)) == (
        date(2026, 8, 31),
        date(2026, 9, 30),
    )
    assert feedback.previous_period(date(2026, 11, 17), date(2026, 11, 17)) == (
        date(2026, 11, 16),
        date(2026, 11, 16),
    )
    # 한쪽만 있거나 전체면 비교하지 않는다.
    assert feedback.previous_period(None, date(2026, 11, 17)) is None
    assert feedback.previous_period(date(2026, 11, 1), None) is None


def test_clean_reading_drops_claims_without_numbers_and_scrubs_contacts():
    reading = feedback.FeedbackReading.model_validate(
        {
            **GOOD,
            "failure": {
                **GOOD["failure"],
                "why": [
                    {"text": "가격 때문이다. 010-1234-5678로 연락", "evidence": ["PRICE: 2건"]},
                    {"text": "느낌상 그렇다", "evidence": ["많음"]},
                    {"text": "", "evidence": ["3곳"]},
                ],
            },
        }
    )
    cleaned = feedback.clean_reading(reading)
    why = cleaned["failure"]["why"]
    assert len(why) == 1 and "010-1234-5678" not in why[0]["text"]
    assert why[0]["evidence"] == ["PRICE: 2건"]
    assert cleaned["heldBack"] == ["근거 숫자가 없어 뺀 주장 2개"]
    assert set(cleaned["failure"]) == {"where", "why", "signals", "vsSuccess", "next"}


def test_prompt_file_has_a_version_line_and_the_rules():
    text, version = feedback.load_prompt()
    assert version.startswith("[지시문 버전] analysis-v1")
    for rule in ("표본 부족(결론 금지)", "근거", "실패를 먼저", "사람 이름"):
        assert rule in text, rule


def test_input_hash_changes_with_the_prompt_version():
    assert feedback.input_hash("표", "v1") != feedback.input_hash("표", "v2")
    assert feedback.input_hash("표", "v1") == feedback.input_hash("표", "v1")


def test_operations_counts_sales_analysis_with_sales_records():
    assert "SALES_ANALYSIS" in SALES_KINDS


# ---------------------------------------------------------------------------
# 창구
# ---------------------------------------------------------------------------


def test_viewer_cannot_request_feedback(env):
    client, _ids, ai = env
    response = client.post(URL, json={}, headers=support.VIEWER)
    assert response.status_code == 403
    assert ai.payloads == [] and saved_rows() == 0


def test_no_records_in_the_period_is_refused_without_sending(env):
    client, _ids, ai = env
    response = client.post(URL, json={"from": "2020-01-01", "to": "2020-01-31"}, headers=STAFF)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["kind"] == "ASSISTANT_NO_RECORDS"
    assert ai.payloads == []


def test_bad_shape_from_ai_is_a_plain_error_and_nothing_is_saved(env):
    client, _ids, ai = env
    ai.raw = json.dumps({"answer": "형식이 다른 답"}, ensure_ascii=False)
    response = client.post(URL, json={}, headers=STAFF)
    assert response.status_code == 503, response.text
    assert response.json()["error"]["kind"] == "LLM_FAILED"
    assert saved_rows() == 0


def test_contact_shape_in_the_input_is_refused_before_sending(env, monkeypatch):
    client, _ids, ai = env
    original = feedback.build_input_text
    monkeypatch.setattr(
        feedback,
        "build_input_text",
        lambda **kwargs: original(**kwargs) + "\n문의 010-1234-5678",
    )
    response = client.post(URL, json={}, headers=STAFF)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["kind"] == "CONTACT_IN_INPUT"
    assert ai.payloads == [] and saved_rows() == 0


def test_daily_limit_counts_only_analysis_calls(env):
    client, _ids, ai = env
    change_assistant(dailyQuestionLimit=1)
    assert client.post(URL, json={}, headers=STAFF).status_code == 200
    again = client.post(URL, json={"refresh": True}, headers=STAFF)
    assert again.status_code == 503, again.text
    assert again.json()["error"]["kind"] == "ASSISTANT_LIMIT"
    assert len(ai.payloads) == 1 and saved_rows() == 1


def test_refresh_calls_again_and_keeps_both_rows(env):
    client, _ids, ai = env
    first = client.post(URL, json={}, headers=STAFF).json()["data"]["feedback"]
    second = client.post(URL, json={"refresh": True}, headers=STAFF).json()["data"]
    assert second["reused"] is False and second["feedback"]["feedbackId"] != first["feedbackId"]
    assert len(ai.payloads) == 2 and saved_rows() == 2


def test_period_compares_with_the_same_length_before_counted_by_the_program(env):
    client, _ids, ai = env
    today = utcnow().astimezone(KST).date()
    period = {"from": (today - timedelta(days=6)).isoformat(), "to": today.isoformat()}
    data = client.post(URL, json=period, headers=STAFF).json()["data"]["feedback"]
    compared = data["comparedToPrevious"]
    assert compared["previousTo"] == (today - timedelta(days=7)).isoformat()
    assert compared["previousFrom"] == (today - timedelta(days=13)).isoformat()
    rows = {row["key"]: (row["current"], row["previous"]) for row in compared["rows"]}
    assert rows["CONTACTED"] == (2, 0) and rows["LOST"] == (1, 0)
    assert "앞 기간(" in ai.payloads[0]["input"]


def test_saved_copy_is_marked_stale_after_new_records(env):
    client, (a, b, c, _d), _ai = env
    assert client.post(URL, json={}, headers=STAFF).status_code == 200
    assert client.get(URL, headers=support.VIEWER).json()["data"]["current"] is True
    support.record(client, c, support.contact("REACHED"))
    state = client.get(URL, headers=support.VIEWER).json()["data"]
    assert state["current"] is False and state["feedback"] is not None


def test_get_without_saved_copy_says_so_and_shows_the_switch(env):
    client, _ids, ai = env
    use_external_ai(salesRecordsEnabled=False)
    state = client.get(URL, headers=support.VIEWER).json()["data"]
    assert state == {"feedback": None, "current": False, "switchOn": False}
    assert ai.payloads == []
