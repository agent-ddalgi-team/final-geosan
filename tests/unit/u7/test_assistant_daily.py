"""#743: 영업 비서가 "같이 들를 곳"을 알고, 대시보드에 하루 한 번 "오늘 정리"를 쓴다.

실제 임시 DB·실제 API, 외부 AI는 가짜 응답이다(소켓도 막혀 있다). 가짜 어댑터가 받은 글을 붙잡아
"무엇이 나갔는지"를 본다. 같이 들를 곳은 대시보드 지도(#673)와 같은 계산이다: 반경은 설정
`visitGroupRadiusKm`, 근처 회사는 관심 기업만. 거리는 프로그램이 재고 AI는 문장만 쓴다.
모든 자료는 가상이다(거산 실제 사양 아님). 주소·전화·이름은 지어낸 것이다.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.evidence import assistant_llm
from geosan.evidence.transfer import KST
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u7.test_bookmark import set_bookmark
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_dashboard_breakdown import add_company
from tests.unit.u7.test_dashboard_breakdown import brochure_env as brochure_env
from tests.unit.u7.test_peers import note
from tests.unit.u7.test_sales_assistant import (
    STAFF,
    VIEWER,
    FakeAI,
    ask,
    change_assistant,
    logs,
    use_external_ai,
)

DAILY_URL = "/api/v1/assistant/daily"

# 위도 0.01도 ≈ 1.1km. 중심 회사는 (38, 127.5). mid는 가깝지만 관심 기업이 아니다.
PLACES = {
    "anchor": (38.0, 127.5),
    "near": (38.01, 127.5),
    "far": (38.1, 127.5),
    "mid": (38.02, 127.5),
    "hold": (38.3, 127.5),
}
BOOKMARKED = ("anchor", "near", "far", "hold")

ADDRESS = "충청남도 천안시 서북구 성거읍 시험로 10"
MAIN_PHONE = "041-000-0000"
SCHEDULE_NOTE = "윤서연 매니저에게 견적 회신 전화"
CONTACT_MEMO = "홍길동이 검토 중이라고만 함"
NOTE_TEXT = "철수 씨가 실무. 직통 010-0000-0000, kim@example.com"
# 보내는 글에 하나라도 있으면 안 되는 것: 주소·좌표·대표번호·메모·일정 글·사람 이름·담당자 키.
FORBIDDEN = [
    ADDRESS,
    "성거읍",
    "38.01",
    "38.1,",
    "127.5",
    MAIN_PHONE,
    "윤서연",
    "견적 회신 전화",
    "홍길동",
    "검토 중이라고만",
    "철수 씨",
    "010-0000-0000",
    "kim@example.com",
    "park-lee",
]


def today():
    return utcnow().astimezone(KST).date()


@pytest.fixture
def daily_env(brochure_env, monkeypatch):
    """관심 기업 4곳(anchor·near·far·hold)과 목록에만 있는 가까운 회사 1곳(mid)."""
    ids = {name: add_company(brochure_env, f"daily-{name}") for name in PLACES}
    assert run_evaluation().ok
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geosan.lat, settings.geosan.lng = 37.9, 127.5
        settings.geocoding.enabled = False
        sync_app_settings(session, settings)
        for name, (lat, lng) in PLACES.items():
            customer = session.get(Customer, session.get(Opportunity, ids[name]).customer_id)
            customer.name = f"가상 {name}"
            customer.lat, customer.lng, customer.geocode_source = lat, lng, "CSV"
            customer.address = ADDRESS
            customer.main_phone = MAIN_PHONE
    use_external_ai()
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    fake = FakeAI()
    monkeypatch.setattr(assistant_llm, "_post", fake)
    with TestClient(create_app()) as client:
        for name in BOOKMARKED:
            assert set_bookmark(client, ids[name], True).status_code == 200
        yield client, ids, fake


def seed(client, ids):
    """anchor: 오늘 방문해 접촉으로 옮기고 내일 다시 방문 / hold: 보류 / near: 메모만."""
    record(
        client,
        ids["anchor"],
        {
            "status": "IN_PROGRESS",
            "method": "VISIT",
            "result": "REACHED",
            "attemptedAt": today().isoformat(),
            "memo": CONTACT_MEMO,
            "nextScheduleAt": (today() + timedelta(days=1)).isoformat(),
            "nextScheduleNote": SCHEDULE_NOTE,
        },
    )
    record(client, ids["hold"], {"status": "ON_HOLD"})
    note(client, ids["near"], NOTE_TEXT)


def daily(client, headers=STAFF):
    return client.get(DAILY_URL, headers=headers)


def calls():
    return sum(row[3] for row in logs())


# ---------------------------------------------------------------------------
# [묻기]가 같이 들를 곳을 안다
# ---------------------------------------------------------------------------


def test_ask_context_carries_visit_groups_with_names_distance_stage_and_date(daily_env):
    """Given 내일 방문할 회사 근처 1.1km에 관심 기업 / When "오늘 방문 어디야?" / Then 그 줄."""
    client, ids, fake = daily_env
    seed(client, ids)
    response = ask(client, "오늘 방문 어디야?")
    assert response.status_code == 200, response.text
    sent = fake.payloads[0]["input"]
    assert "같이 들를 곳" in sent and "5km" in sent
    tomorrow = today() + timedelta(days=1)
    line = next(row for row in sent.splitlines() if row.startswith(f"- {tomorrow.isoformat()}("))
    assert "가상 anchor(진행 중)" in line and "가상 near 1.1km(관심)" in line
    # 반경 밖(far 11km)·관심 아닌 가까운 회사(mid)는 같이 들를 곳이 아니다.
    assert "가상 far" not in line and "가상 mid" not in sent
    # 일정 줄 묶음은 그대로다(usedQueries 그대로).
    assert response.json()["data"]["usedQueries"][3] == "SCHEDULE"


def test_ask_context_never_carries_address_coordinates_phone_or_memo(daily_env):
    client, ids, fake = daily_env
    seed(client, ids)
    assert ask(client, "오늘 방문 어디야?").status_code == 200
    for planted in FORBIDDEN:
        assert planted not in fake.sent, planted


def test_visit_radius_comes_from_settings(daily_env):
    """Given 반경 설정 15km / When 질문 / Then 11km 떨어진 관심 기업도 같이 들를 곳에 든다."""
    client, ids, fake = daily_env
    seed(client, ids)
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.visit_group_radius_km = 15
        sync_app_settings(session, settings)
    assert ask(client, "오늘 방문 어디야?").status_code == 200
    assert "15km" in fake.sent and "가상 far 11.1km(관심)" in fake.sent


# ---------------------------------------------------------------------------
# 아침 정리: 하루 한 번
# ---------------------------------------------------------------------------


def test_daily_brief_is_written_once_and_reused_the_same_day(daily_env):
    """Given 일정·단계 이동·보류 / When 오늘 정리 두 번 / Then 호출 한 번, 두 번째는 다시 쓴다."""
    client, ids, fake = daily_env
    seed(client, ids)
    fake.answer = "- 내일 가상 anchor 방문, 근처 1.1km 가상 near도 들르세요."
    first = daily(client)
    assert first.status_code == 200, first.text
    data = first.json()["data"]
    assert data["summary"] == fake.answer and data["aiGenerated"] is True
    assert data["reused"] is False and data["day"] == today().isoformat()
    assert {item["name"] for item in data["sources"]} == {"가상 anchor", "가상 near"}
    second = daily(client)
    assert second.status_code == 200
    again = second.json()["data"]
    assert again["reused"] is True and again["summary"] == data["summary"]
    assert again["generatedAt"] == data["generatedAt"]
    assert len(fake.payloads) == 1 and calls() == 1


def test_daily_brief_sends_schedule_visits_moves_and_held_companies_only(daily_env):
    client, ids, fake = daily_env
    seed(client, ids)
    assert daily(client).status_code == 200
    sent = fake.payloads[0]["input"]
    tomorrow = today() + timedelta(days=1)
    for expected in (
        f"오늘: {today().isoformat()}",
        "놓친 일정",
        f"{tomorrow.isoformat()}",
        "가상 anchor(진행 중) → 가상 near 1.1km(관심)",
        f"{today().isoformat()} | 가상 anchor | 미접촉 → 접촉",
        "가상 hold",
    ):
        assert expected in sent, expected
    for planted in FORBIDDEN:
        assert planted not in fake.sent, planted
    assert fake.payloads[0]["store"] is False


def test_daily_brief_with_switch_off_calls_nothing(daily_env):
    """Given 영업 기록 스위치 꺼짐 / When 오늘 정리 / Then 422, 외부 호출 0."""
    client, ids, fake = daily_env
    seed(client, ids)
    use_external_ai(salesRecordsEnabled=False)
    response = daily(client)
    assert response.status_code == 422
    assert response.json()["error"]["kind"] == "SALES_RECORDS_DISABLED"
    assert fake.payloads == [] and calls() == 0


def test_switch_off_after_writing_does_not_hand_back_the_saved_brief(daily_env):
    client, ids, fake = daily_env
    seed(client, ids)
    assert daily(client).status_code == 200
    use_external_ai(salesRecordsEnabled=False)
    assert daily(client).status_code == 422
    assert len(fake.payloads) == 1


def test_daily_brief_over_the_daily_question_limit_calls_nothing(daily_env):
    """Given 하루 한도 1, [묻기] 1번 / When 오늘 정리 / Then 503 ASSISTANT_LIMIT, 호출 더 없음."""
    client, ids, fake = daily_env
    seed(client, ids)
    change_assistant(dailyQuestionLimit=1)
    assert ask(client, "오늘 방문 어디야?").status_code == 200
    response = daily(client)
    assert response.status_code == 503
    assert response.json()["error"]["kind"] == "ASSISTANT_LIMIT"
    assert len(fake.payloads) == 1 and calls() == 1


def test_daily_brief_over_the_monthly_limit_calls_nothing(daily_env):
    client, ids, fake = daily_env
    seed(client, ids)
    use_external_ai(monthlyCallLimit=0)
    response = daily(client)
    assert response.status_code == 503
    assert response.json()["error"]["kind"] == "LLM_LIMIT"
    assert fake.payloads == [] and calls() == 0


def test_saved_brief_is_handed_back_even_when_the_limit_is_now_full(daily_env):
    """한도는 부를 때만 센다. 이미 쓴 오늘 정리는 한도가 차도 다시 보인다(호출이 없다)."""
    client, ids, fake = daily_env
    seed(client, ids)
    assert daily(client).status_code == 200
    change_assistant(dailyQuestionLimit=1)
    response = daily(client)
    assert response.status_code == 200 and response.json()["data"]["reused"] is True
    assert len(fake.payloads) == 1


def test_next_day_writes_a_new_brief(daily_env, monkeypatch):
    client, ids, fake = daily_env
    seed(client, ids)
    assert daily(client).status_code == 200
    later = utcnow() + timedelta(days=1)
    monkeypatch.setattr("geosan.api.routes.assistant.utcnow", lambda: later)
    response = daily(client)
    assert response.status_code == 200 and response.json()["data"]["reused"] is False
    assert len(fake.payloads) == 2


def test_failed_reply_is_not_saved_and_is_an_error(daily_env):
    """Given AI가 답을 끝까지 못 줌 / When 오늘 정리 / Then 503, 기억하지 않아 다음에 다시 부름."""
    client, ids, fake = daily_env
    seed(client, ids)
    fake.status = "incomplete"
    response = daily(client)
    assert response.status_code == 503 and response.json()["error"]["kind"] == "LLM_FAILED"
    fake.status = "completed"
    assert daily(client).json()["data"]["reused"] is False
    assert len(fake.payloads) == 2


@pytest.mark.parametrize("headers", [VIEWER, {}])
def test_viewer_and_missing_staff_key_are_forbidden(daily_env, headers):
    client, ids, fake = daily_env
    seed(client, ids)
    assert daily(client, headers=headers).status_code == 403
    assert fake.payloads == [] and logs() == []


def test_nothing_to_summarise_sends_nothing(daily_env):
    """Given 일정·단계 이동·보류가 하나도 없음 / When 오늘 정리 / Then 422, 나간 것 없음."""
    client, _ids, fake = daily_env
    response = daily(client)
    assert response.status_code == 422
    assert response.json()["error"]["kind"] == "ASSISTANT_NO_RECORDS"
    assert fake.payloads == [] and logs() == []


def test_daily_brief_changes_nothing_but_transfer_log(daily_env):
    from tests.unit.u7.test_sales_assistant import row_counts

    client, ids, _fake = daily_env
    seed(client, ids)
    before = row_counts()
    assert daily(client).status_code == 200
    assert row_counts() == before
