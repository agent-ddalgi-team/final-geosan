"""#253: 잘못 저장한 기록을 지우지 않고 "잘못 입력"으로 표시한다. 가상 입력·실제 SQLite·실제 API."""

from sqlalchemy import select

from geosan.config.models import AppSetting
from geosan.records.models import Note, Outcome
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_questions as questions
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
post = records.post


def detail(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]


def activity(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]


def cancel(client, opp_id, record_id, body=None, staff="park-lee"):
    return post(client, opp_id, f"records/{record_id}/cancel", body or {}, staff=staff)


def record_id_of(client, opp_id, kind):
    return next(item["recordId"] for item in activity(client, opp_id) if item["kind"] == kind)


def test_cancelled_note_hides_text_and_keeps_the_row(records_env):
    """Given 가상 메모 / When 잘못 입력 표시 / Then 행은 남고 본문은 안 나가며 취소 줄이 생긴다."""
    client, opp_id = records_env
    assert post(client, opp_id, "notes", {"text": "다른 회사에 적을 메모(가상)"}).status_code == 200
    note_id = record_id_of(client, opp_id, "NOTE")
    response = cancel(client, opp_id, note_id, {"reason": "회사를 잘못 고름"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["recordId"] == note_id and data["recordKind"] == "NOTE"
    assert data["cancelledBy"] == "park-lee" and data["cancelledAt"]
    items = activity(client, opp_id)
    line = next(item for item in items if item["recordId"] == note_id)
    assert line["cancelled"] is True and line["summary"] == "(취소된 메모)"
    assert line["cancelledBy"] == "park-lee" and line["cancelledAt"] == data["cancelledAt"]
    cancelled_line = next(item for item in items if item["kind"] == "RECORD_CANCELLED")
    assert cancelled_line["actor"] == "park-lee" and cancelled_line["recordId"] is None
    assert cancelled_line["summary"] == "취소 · 회사를 잘못 고름"
    assert (
        "다른 회사에 적을 메모" not in client.get(f"/api/v1/opportunities/{opp_id}/activity").text
    )
    with session_scope() as session:
        row = session.get(Note, note_id)
        assert row.text == "다른 회사에 적을 메모(가상)" and row.cancel_reason == "회사를 잘못 고름"


def test_cancel_rejects_twice_other_staff_viewer_and_unknown(records_env):
    """Given 박 담당의 기록 / When 다시·남이·보기 전용이·없는 번호로 표시 / Then 409·403·403·404."""
    client, opp_id = records_env
    assert post(client, opp_id, "notes", {"text": "가상 메모"}).status_code == 200
    note_id = record_id_of(client, opp_id, "NOTE")
    other = cancel(client, opp_id, note_id, staff="kim-gwajang")
    assert other.status_code == 403
    assert other.json()["error"]["message"] == "다른 담당자의 기록은 표시할 수 없습니다."
    assert cancel(client, opp_id, note_id, staff="viewer").status_code == 403
    assert cancel(client, opp_id, "note-none").status_code == 404
    assert cancel(client, opp_id, "opinion-1").status_code == 404
    assert cancel(client, "opp-none", note_id).status_code == 404
    too_long = cancel(client, opp_id, note_id, {"reason": "가" * 201})
    assert too_long.status_code == 400
    assert cancel(client, opp_id, note_id).status_code == 200
    again = cancel(client, opp_id, note_id)
    assert again.status_code == 409
    assert again.json()["error"]["message"] == "이미 잘못 입력으로 표시된 기록입니다"
    with session_scope() as session:
        assert session.get(Note, note_id).cancelled_by == "park-lee"


def test_any_staff_can_cancel_only_when_setting_allows(records_env):
    """Given 누구나 표시 설정 / When 다른 담당자가 표시 / Then 허용되고 화면 설정에도 보인다."""
    client, opp_id = records_env
    assert post(client, opp_id, "notes", {"text": "가상 메모"}).status_code == 200
    note_id = record_id_of(client, opp_id, "NOTE")
    assert client.get("/api/v1/config/ui").json()["data"]["records"]["cancelByAnyStaff"] is False
    with session_scope() as session:
        session.get(AppSetting, "records").value = {"cancelByAnyStaff": True}
    assert client.get("/api/v1/config/ui").json()["data"]["records"]["cancelByAnyStaff"] is True
    assert cancel(client, opp_id, note_id, staff="kim-gwajang").status_code == 200


def test_cancelled_contact_drops_count_answers_and_schedule(records_env):
    """Given 전화 두 번(둘째에 답·일정) / When 둘째를 표시 / Then 횟수·단계·일정이 첫째 기준이다."""
    client, opp_id = records_env
    before = detail(client, opp_id)
    questions.save(client, opp_id, questions.contact(result="ABSENT", attemptedAt="2026-10-15"))
    questions.save(
        client,
        opp_id,
        {
            **questions.contact(answers=[("QUOTE_REQUEST", "QUOTE")]),
            "nextScheduleAt": "2026-12-01",
            "nextScheduleNote": "견적서 보내기(가상)",
        },
    )
    middle = detail(client, opp_id)["records"]
    assert middle["contactCount"]["call"] == 2
    assert middle["outcome"]["status"] == "SAMPLE_OR_REGISTRATION_APPROVED"
    assert middle["outcome"]["nextScheduleAt"] == "2026-12-01"
    with session_scope() as session:
        newest = session.scalar(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
        )
        newest_id, newest_version = newest.outcome_id, newest.version
    assert cancel(client, opp_id, newest_id).status_code == 200
    after = detail(client, opp_id)
    assert after["records"]["contactCount"]["call"] == 1
    assert after["records"]["outcome"]["status"] == "IN_PROGRESS"
    assert after["records"]["outcome"]["nextScheduleAt"] is None
    assert after["records"]["salesStep"]["code"] == "NOT_REACHED"
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]
    card = questions.card_of(client, opp_id)
    assert card["records"]["outcome"]["status"] == "IN_PROGRESS"
    assert card["contactCount"] == 1
    # 새 기록의 번호는 취소한 행 다음으로 이어진다(행과 번호는 남는다).
    saved = questions.save(client, opp_id, questions.contact(result="ABSENT"))
    assert saved["version"] == newest_version + 1


def test_cancelling_every_record_leaves_no_outcome_and_frees_bookmark(records_env):
    """Given 기록 하나뿐인 회사 / When 그 기록을 표시 / Then 단계가 비고 관심에서 뺄 수 있다."""
    client, opp_id = records_env
    assert post(client, opp_id, "outcomes", {"status": "IN_PROGRESS"}).status_code == 200
    outcome_id = record_id_of(client, opp_id, "OUTCOME")
    blocked = client.put(
        f"/api/v1/opportunities/{opp_id}/bookmark",
        json={"active": False},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert blocked.status_code == 422
    assert cancel(client, opp_id, outcome_id).status_code == 200
    assert detail(client, opp_id)["records"]["outcome"] is None
    assert questions.card_of(client, opp_id)["records"]["outcome"] is None
    freed = client.put(
        f"/api/v1/opportunities/{opp_id}/bookmark",
        json={"active": False},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert freed.status_code == 200 and freed.json()["data"]["active"] is False
