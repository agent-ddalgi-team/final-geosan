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
    assert version.startswith("[지시문 버전] analysis-v2")
    for rule in (
        "표본 부족(결론 금지)",
        "근거",
        "실패를 먼저",
        "사람 이름",
        "회사별 기록",
        "회사 A1",
    ):
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


# ---------------------------------------------------------------------------
# #802(PM 결정 2026-11-20): 회사별 기록(메모·사유·답)을 지워서 함께 보내고, 회사 이름은 되돌린다
# ---------------------------------------------------------------------------


def _note(opp_id, text, note_id="note-ctx"):
    from geosan.records.models import Note

    with session_scope() as session:
        session.add(
            Note(
                note_id=note_id,
                opp_id=opp_id,
                staff_key="park-lee",
                kind="MEMO",
                text=text,
                version=1,
                created_by="park-lee",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )


def _company_name(opp_id):
    from geosan.opportunity.models import Customer, Opportunity

    with session_scope() as session:
        return session.get(Customer, session.get(Opportunity, opp_id).customer_id).name


def test_company_records_go_with_names_swapped_and_contacts_removed(env):
    """Given 거절한 회사의 메모에 전화·직함 붙은 이름·회사 이름 / When [AI 분석 받기]
    / Then 회사별 기록이 함께 가고 회사 이름은 "회사 A1", 전화·이름은 지워져 있다."""
    client, (a, b, *_), ai = env
    name = _company_name(a)
    support.record(client, b, support.contact("REACHED", memo="기존 거래처와 연간 단가 계약"))
    # 영업 메모(rec_note)에는 담당자가 상대 연락처를 적을 수 있다(PM 결정 11/03). 보낼 때 지운다.
    _note(a, f"{name} 김민수 과장 010-1234-5678 다음 달 계약 끝나면 다시 연락 달라고 함")
    assert client.post(URL, json={}, headers=STAFF).status_code == 200
    sent = ai.payloads[0]["input"]
    assert feedback.CONTEXT_HEAD in sent and "[회사 A1]" in sent and "[회사 A2]" in sent
    assert "기존 거래처와 연간 단가 계약" in sent and "결과: 거절(가격)" in sent
    assert "다음 달 계약 끝나면 다시 연락" in sent
    # 세부 단계는 질문 파일의 쉬운 말, 끝난 회사는 "끝남"(코드나 "없음"이 아니다).
    assert "결과: 거절(가격) · 세부 단계: 끝남" in sent and "세부 단계: 연결됨" in sent
    assert name not in sent and _company_name(b) not in sent
    assert "010-1234-5678" not in sent and "김민수" not in sent
    # 끝난 회사(거절)가 먼저 온다.
    assert sent.index("[회사 A1]") < sent.index("결과: 거절(가격)") < sent.index("[회사 A2]")


def test_answer_names_are_restored_on_screen(env):
    """AI 답의 "회사 A1"은 저장·화면에서 원래 회사 이름으로 보인다."""
    client, (a, *_), ai = env
    reply = json.loads(json.dumps(GOOD, ensure_ascii=False))
    reply["next"] = [
        {"text": "회사 A1은 기존 거래처 계약 끝나는 때를 물어본다.", "evidence": ["회사 A1 · 거절"]}
    ]
    ai.raw = json.dumps(reply, ensure_ascii=False)
    data = client.post(URL, json={}, headers=STAFF).json()["data"]["feedback"]
    name = _company_name(a)
    assert data["next"][0]["text"].startswith(name)
    assert data["next"][0]["evidence"] == [f"{name} · 거절"]


def test_every_sent_company_is_marked_in_the_transfer_log(env):
    """보낸 회사마다 전송 기록이 남는다(회사별 기록을 보냈으므로)."""
    from geosan.evidence.transfer import TransferLog

    client, (a, b, *_), _ai = env
    assert client.post(URL, json={}, headers=STAFF).status_code == 200
    with session_scope() as session:
        marked = set(session.scalars(select(TransferLog.opp_id)))
    assert {a, b} <= marked


def test_context_text_changes_the_saved_copy_to_stale(env):
    """메모만 새로 적어도(숫자 표는 그대로) 저장본이 '지금 기록과 다름'이 된다."""
    client, (a, *_), _ai = env
    assert client.post(URL, json={}, headers=STAFF).status_code == 200
    _note(a, "시험 메모: 샘플을 다음 달에 다시 보자고 함")
    assert client.get(URL, headers=support.VIEWER).json()["data"]["current"] is False
