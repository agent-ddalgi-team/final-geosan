"""#980 상대 담당자 연락처: 가림·확인 문구·열람 기록·보기 전용 제외·보관 1년(PM 결정 2026-11-28).

실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 자료만 쓴다(거산 실제 사양 아님).
"""

from datetime import timedelta

import pytest
from sqlalchemy import select

from geosan.records.models import ContactPerson, ContactReveal
from geosan.storage.session import session_scope
from tests.unit.u3 import test_company_info_fix as fixing
from tests.unit.u3 import test_staff_add_company as support

client = support.client
PARK = support.STAFF
KIM = {"X-Staff-Key": "kim-gwajang"}
OPS = {"X-Staff-Key": "choi-pm"}
VIEWER = {"X-Staff-Key": "viewer"}
BODY = {"personName": "김철수", "role": "구매팀 과장", "phone": "010 1234 5678"}


def base(opp_id):
    return f"/api/v1/opportunities/{opp_id}/contacts"


def add_contact(api, opp_id, body=BODY, headers=PARK):
    return api.post(base(opp_id), json=body, headers=headers)


def contact_rows():
    with session_scope() as session:
        rows = list(session.scalars(select(ContactPerson)))
        for row in rows:
            session.expunge(row)
        return rows


def reveal_rows():
    with session_scope() as session:
        return [
            (row.staff_key, row.contact_id, row.note_id)
            for row in session.scalars(select(ContactReveal))
        ]


@pytest.fixture
def opp_id(client):
    return fixing.added(client)


def test_saved_contact_is_masked_everywhere_but_reveal(client, opp_id):
    """Given 회사 / When 박 담당이 상대 담당자 연락처를 적음
    Then 저장 응답·목록·상세·활동 이력 어디에도 이름·번호 원문이 없고 가린 값만 보인다."""
    response = add_contact(client, opp_id)
    assert response.status_code == 200, response.text
    contact = response.json()["data"]["contact"]
    assert contact["personNameMasked"] == "김○○"
    assert contact["phoneMasked"] == "010-****-****"
    assert contact["role"] == "구매팀 과장"
    assert contact["retentionDue"] is False
    (row,) = contact_rows()
    assert (row.person_name, row.phone, row.created_by) == ("김철수", "010-1234-5678", "park-lee")
    assert (row.retain_until - row.created_at.date()).days in (365, 366)
    listed = client.get(base(opp_id), headers=PARK)
    assert listed.status_code == 200
    detail = client.get(f"/api/v1/opportunities/{opp_id}")
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity")
    for text in (response.text, listed.text, detail.text, activity.text):
        assert "1234" not in text and "김철수" not in text
    assert "상대 담당자 연락처 추가" in activity.text


def test_reveal_needs_acknowledgement_and_leaves_a_log(client, opp_id):
    contact_id = add_contact(client, opp_id).json()["data"]["contact"]["contactId"]
    url = f"{base(opp_id)}/{contact_id}/reveal"
    refused = client.post(url, json={"acknowledged": False}, headers=PARK)
    assert refused.status_code == 400
    assert reveal_rows() == []
    opened = client.post(url, json={"acknowledged": True}, headers=KIM)
    assert opened.status_code == 200, opened.text
    assert opened.json()["data"] == {
        "contactId": contact_id,
        "personName": "김철수",
        "role": "구매팀 과장",
        "phone": "010-1234-5678",
    }
    assert reveal_rows() == [("kim-gwajang", contact_id, None)]


def test_viewer_and_no_key_cannot_see_or_write(client, opp_id):
    contact_id = add_contact(client, opp_id).json()["data"]["contact"]["contactId"]
    for headers in (VIEWER, {}):
        assert client.get(base(opp_id), headers=headers).status_code == 403
        assert add_contact(client, opp_id, headers=headers).status_code == 403
        assert (
            client.post(
                f"{base(opp_id)}/{contact_id}/reveal", json={"acknowledged": True}, headers=headers
            ).status_code
            == 403
        )
    assert reveal_rows() == []


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"phone": "1234"}, "phone"),
        ({"phone": "010-1234-5678 a"}, "phone"),
        ({"personName": "김철수 01012345678", "phone": "010-1234-5678"}, "personName"),
        ({"role": "a@b.kr 담당", "phone": "010-1234-5678"}, "role"),
    ],
)
def test_wrong_values_are_rejected(client, opp_id, body, field):
    response = add_contact(client, opp_id, body)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["fields"][0]["path"] == field
    assert contact_rows() == []


def test_edit_then_delete_erases_the_values(client, opp_id):
    contact_id = add_contact(client, opp_id).json()["data"]["contact"]["contactId"]
    edited = client.post(
        f"{base(opp_id)}/{contact_id}",
        json={"personName": "이영희", "role": None, "phone": "041-555-1234"},
        headers=KIM,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["contact"]["phoneMasked"] == "041-***-****"
    assert edited.json()["data"]["contact"]["updatedBy"] == "kim-gwajang"
    deleted = client.post(f"{base(opp_id)}/{contact_id}/delete", json={}, headers=PARK)
    assert deleted.status_code == 200, deleted.text
    (row,) = contact_rows()
    assert (row.person_name, row.role, row.phone) == (None, None, None)
    assert (row.deleted_by, row.deleted_reason) == ("park-lee", "STAFF")
    assert client.get(base(opp_id), headers=PARK).json()["data"]["contacts"] == []
    again = client.post(
        f"{base(opp_id)}/{contact_id}/reveal", json={"acknowledged": True}, headers=PARK
    )
    assert again.status_code == 404
    lines = fixing.notes(opp_id)
    assert lines[-2:] == ["상대 담당자 연락처 고침", "상대 담당자 연락처 지움"]


def _near_limit(days_left: int) -> None:
    from geosan.api.routes.contacts import today_kst

    with session_scope() as session:
        for row in session.scalars(select(ContactPerson)):
            row.retain_until = today_kst() + timedelta(days=days_left)


def _retention_row(api, headers):
    body = api.get("/api/v1/dashboard", headers=headers).json()["data"]
    return next(
        (row for row in body["todayChecks"] if row["kind"] == "CONTACT_RETENTION_DUE"), None
    )


def test_retention_is_asked_on_the_home_and_never_deleted_by_itself(client, opp_id):
    """Given 보관 기한 10일 전인 연락처 / When 영업 홈을 엶
    Then 적은 사람과 운영 담당에게만 "지울지 확인" 줄이 뜨고, 저절로 지우지 않는다.
    [1년 더]를 누르면 기한이 1년 뒤로 가고 줄이 사라지며, 기한 전에는 [1년 더]가 409다."""
    contact_id = add_contact(client, opp_id).json()["data"]["contact"]["contactId"]
    keep = f"{base(opp_id)}/{contact_id}/keep"
    assert client.post(keep, headers=PARK).status_code == 409
    assert _retention_row(client, PARK) is None
    _near_limit(10)
    row = _retention_row(client, PARK)
    assert row is not None and row["count"] == 1
    assert row["items"][0]["oppId"] == opp_id and row["items"][0]["note"] is None
    assert _retention_row(client, OPS) is not None
    assert _retention_row(client, KIM) is None
    assert _retention_row(client, VIEWER) is None
    assert "1234" not in client.get("/api/v1/dashboard", headers=PARK).text
    (stored,) = contact_rows()
    assert stored.deleted_at is None
    kept = client.post(keep, headers=KIM)
    assert kept.status_code == 200, kept.text
    assert kept.json()["data"]["contact"]["retentionDue"] is False
    assert _retention_row(client, PARK) is None
    assert fixing.notes(opp_id)[-1] == "상대 담당자 연락처 1년 더 보관"


def test_delete_after_retention_notice_records_the_reason(client, opp_id):
    contact_id = add_contact(client, opp_id).json()["data"]["contact"]["contactId"]
    _near_limit(0)
    response = client.post(
        f"{base(opp_id)}/{contact_id}/delete", json={"reason": "RETENTION"}, headers=OPS
    )
    assert response.status_code == 200, response.text
    (row,) = contact_rows()
    assert row.deleted_reason == "RETENTION" and row.phone is None
    assert fixing.notes(opp_id)[-1] == "상대 담당자 연락처 지움(보관 1년)"
    assert _retention_row(client, OPS) is None


def test_memo_numbers_are_masked_on_screen_and_revealed_with_a_log(client, opp_id):
    """Given 메모에 상대 담당자 휴대폰·이메일 / When 상세 활동 이력을 봄
    Then 번호·이메일은 가려 보이고(textMasked), 확인 문구 뒤 [보기]로만 원문이 열리며
    기록이 남는다."""
    saved = client.post(
        f"/api/v1/opportunities/{opp_id}/notes",
        json={"text": "김과장 010-9876-5432, kim@example.com 으로 자료 요청"},
        headers=PARK,
    )
    assert saved.status_code == 200, saved.text
    note_id = saved.json()["data"]["noteId"]
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    line = next(item for item in activity if item.get("recordId") == note_id)
    assert line["textMasked"] is True
    assert "9876" not in line["summary"] and "kim@example.com" not in line["text"]
    assert "[번호 가림]" in line["text"] and "[이메일 가림]" in line["text"]
    url = f"/api/v1/notes/{note_id}/reveal"
    assert client.post(url, json={"acknowledged": True}, headers=VIEWER).status_code == 403
    opened = client.post(url, json={"acknowledged": True}, headers=KIM)
    assert opened.status_code == 200, opened.text
    assert opened.json()["data"]["text"].startswith("김과장 010-9876-5432")
    assert reveal_rows() == [("kim-gwajang", None, note_id)]


def test_operations_lists_who_opened_what_without_values(client, opp_id):
    contact_id = add_contact(client, opp_id).json()["data"]["contact"]["contactId"]
    client.post(f"{base(opp_id)}/{contact_id}/reveal", json={"acknowledged": True}, headers=PARK)
    response = client.get("/api/v1/operations", headers=OPS)
    assert response.status_code == 200, response.text
    (line,) = response.json()["data"]["contactReveals"]
    assert (line["staffKey"], line["kind"], line["oppId"]) == ("park-lee", "CONTACT", opp_id)
    assert line["customerName"] == "가상직접회사"
    assert "1234" not in response.text and "김철수" not in response.text
