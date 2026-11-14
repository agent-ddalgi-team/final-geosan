"""#737: 통화 때 쓴 한 줄 메모(rec_outcome.memo)가 활동 이력의 그 접촉 줄 끝에 붙어 보인다.

활동 이력은 내부 전용(접속 보호 뒤 화면에서만)이라 메모가 섞여도 밖으로 나가는 곳은 그대로다.
대시보드 최근 기록은 활동 이력 글을 쓰지 않고 따로 만들므로 메모가 섞이지 않는다.
가상 입력·실제 SQLite·실제 API. 메모 글은 가짜 문장이다(거산 실제 기록 아님).
"""

from tests.unit.u1 import test_record_cancel as cancel_helpers
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
post = records.post
activity = cancel_helpers.activity
cancel = cancel_helpers.cancel

MEMO = "샘플 다음 주 회신(가상)"
CALL = {"status": "IN_PROGRESS", "method": "CALL", "result": "REACHED"}


def contact_lines(client, opp_id):
    return [item for item in activity(client, opp_id) if item["kind"] == "CONTACT_ATTEMPT"]


def test_call_memo_is_shown_at_the_end_of_the_contact_line(records_env):
    """Given 한 줄 메모를 쓴 통화 / When 활동 이력 조회 / Then 접촉 줄 끝에 메모가 붙는다."""
    client, opp_id = records_env
    saved = post(client, opp_id, "outcomes", CALL | {"memo": MEMO})
    assert saved.status_code == 200, saved.text
    (line,) = contact_lines(client, opp_id)
    assert line["summary"].endswith(f"전화 연결됨 · 메모: {MEMO}")
    assert line["summary"].count("메모:") == 1


def test_call_without_memo_has_no_memo_part(records_env):
    """Given 메모 없는 통화·빈칸 메모 / When 활동 이력 조회 / Then "메모:"가 붙지 않는다."""
    client, opp_id = records_env
    assert post(client, opp_id, "outcomes", CALL).status_code == 200
    assert post(client, opp_id, "outcomes", CALL | {"memo": "   "}).status_code == 200
    lines = contact_lines(client, opp_id)
    assert len(lines) == 2
    assert all("메모:" not in line["summary"] for line in lines)


def test_memo_follows_schedule_and_reason_parts(records_env):
    """Given 일정까지 적은 통화 / When 활동 이력 조회 / Then 메모는 다음 일정 뒤 맨 끝에 붙는다."""
    client, opp_id = records_env
    body = CALL | {"memo": MEMO, "nextScheduleAt": "2099-01-05", "nextScheduleNote": "샘플 확인"}
    assert post(client, opp_id, "outcomes", body).status_code == 200
    (line,) = contact_lines(client, opp_id)
    assert line["summary"].endswith(f"다음 일정 2099-01-05 샘플 확인 · 메모: {MEMO}")


def test_cancelled_call_does_not_send_its_memo(records_env):
    """Given 메모를 쓴 통화 / When 잘못 입력으로 표시 / Then 그 줄에서 메모 글이 빠진다."""
    client, opp_id = records_env
    assert post(client, opp_id, "outcomes", CALL | {"memo": MEMO}).status_code == 200
    (line,) = contact_lines(client, opp_id)
    assert cancel(client, opp_id, line["recordId"]).status_code == 200
    (after,) = contact_lines(client, opp_id)
    assert after["cancelled"] is True
    assert "메모:" not in after["summary"]
    assert MEMO not in client.get(f"/api/v1/opportunities/{opp_id}/activity").text


def test_dashboard_recent_activity_does_not_carry_the_memo(records_env):
    """Given 메모를 쓴 통화(관심 자동 켜짐) / When 대시보드 / Then 최근 기록에 메모 글이 없다."""
    client, opp_id = records_env
    assert post(client, opp_id, "outcomes", CALL | {"memo": MEMO}).status_code == 200
    response = client.get("/api/v1/dashboard", headers={"X-Staff-Key": "park-lee"})
    assert response.status_code == 200, response.text
    recent = response.json()["data"]["recentActivity"]
    assert recent, "통화 저장이 최근 기록에 보여야 한다"
    assert MEMO not in response.text
