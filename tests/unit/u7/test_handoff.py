"""#771 전달 사항(PM 결정 2026-11-15·16, #756 하위): 다른 직원이 남기고 받는 사람이 확인한다.

실제 임시 DB·API로 본다. 가상 사례만 쓴다(거산 실제 사양 아님). 담당자 키는 예시 설정의
역할 이름(영업 담당 park-lee, 검수 담당 kim-gwajang)이다.
"""

from datetime import date

import pytest
from sqlalchemy import select

from geosan.api.coach import build_coach
from geosan.records.models import Note
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard as dashboard

dashboard_env = dashboard.dashboard_env
SALES = {"X-Staff-Key": "park-lee"}
TECH = {"X-Staff-Key": "kim-gwajang"}


def handoff(
    client, opp_id, text="가상 전달: 도금 두께 요구는 우리 설비로 가능", to="park-lee", headers=TECH
):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/notes",
        json={"kind": "HANDOFF", "text": text, "toStaffKey": to},
        headers=headers,
    )


def records(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["records"]


def today_rows(client, headers):
    data = client.get("/api/v1/dashboard", headers=headers).json()["data"]
    return {row["kind"]: row for row in data["todayChecks"]}


def test_handoff_is_saved_shown_in_detail_and_activity(dashboard_env):
    """Given 검수 담당이 영업 담당에게 전달 / When 저장 / Then 상세 records.handoffs 맨 위 확인 전,
    활동 이력 "전달 사항 → 영업 담당 · …"."""
    client, opp_ids = dashboard_env
    response = handoff(client, opp_ids[0])
    assert response.status_code == 200, response.text
    rows = records(client, opp_ids[0])["handoffs"]
    assert len(rows) == 1
    assert {k: rows[0][k] for k in ("text", "from", "to", "confirmedAt", "confirmedBy")} == {
        "text": "가상 전달: 도금 두께 요구는 우리 설비로 가능",
        "from": "kim-gwajang",
        "to": "park-lee",
        "confirmedAt": None,
        "confirmedBy": None,
    }
    activity = client.get(f"/api/v1/opportunities/{opp_ids[0]}/activity").json()["data"]
    items = activity if isinstance(activity, list) else activity["items"]
    assert any(
        item["summary"] == "전달 사항 → 영업 담당 · 가상 전달: 도금 두께 요구는 우리 설비로 가능"
        for item in items
    )


@pytest.mark.parametrize(
    "body,headers",
    [
        ({"kind": "HANDOFF", "text": "가상", "toStaffKey": None}, TECH),
        ({"kind": "HANDOFF", "text": "가상", "toStaffKey": "kim-gwajang"}, TECH),
        ({"kind": "HANDOFF", "text": "가상", "toStaffKey": "viewer"}, TECH),
        ({"kind": "HANDOFF", "text": "가상", "toStaffKey": "nobody"}, TECH),
        ({"kind": "HANDOFF", "text": "   ", "toStaffKey": "park-lee"}, TECH),
        ({"kind": "MEMO", "text": "가상", "toStaffKey": "park-lee"}, TECH),
    ],
)
def test_bad_handoff_is_refused(dashboard_env, body, headers):
    """Given 받는 사람 없음·자기 자신·보기 전용·모르는 키·빈 글·메모에 받는 사람
    / When 저장 / Then 400·저장 없음."""
    client, opp_ids = dashboard_env
    response = client.post(f"/api/v1/opportunities/{opp_ids[0]}/notes", json=body, headers=headers)
    assert response.status_code == 400, response.text
    with session_scope() as session:
        assert session.scalars(select(Note).where(Note.opp_id == opp_ids[0])).first() is None


def test_only_the_recipient_confirms_and_twice_is_the_same(dashboard_env):
    """Given 영업 담당에게 온 전달 / When 검수 담당이 확인 → 403, 영업 담당이 두 번 확인
    / Then 첫 확인 시각이 그대로 남고 상세에서 확인함."""
    client, opp_ids = dashboard_env
    note_id = handoff(client, opp_ids[0]).json()["data"]["noteId"]
    assert client.post(f"/api/v1/notes/{note_id}/confirm", headers=TECH).status_code == 403
    first = client.post(f"/api/v1/notes/{note_id}/confirm", headers=SALES)
    assert first.status_code == 200, first.text
    second = client.post(f"/api/v1/notes/{note_id}/confirm", headers=SALES)
    assert second.json()["data"] == first.json()["data"]
    assert first.json()["data"]["confirmedBy"] == "park-lee"
    assert records(client, opp_ids[0])["handoffs"][0]["confirmedBy"] == "park-lee"
    assert client.post("/api/v1/notes/note-none/confirm", headers=SALES).status_code == 404


def test_dashboard_shows_handoffs_for_me_without_the_text(dashboard_env):
    """Given 영업 담당에게 온 확인 전 전달 두 건(두 회사) / When 대시보드
    / Then 영업 담당에게만 "나에게 온 전달 사항" 2곳(보낸 사람·날짜, 글 없음), 확인하면 빠진다."""
    client, opp_ids = dashboard_env
    first = handoff(client, opp_ids[0]).json()["data"]["noteId"]
    handoff(client, opp_ids[1], text="가상 전달 둘")
    mine = today_rows(client, SALES)["HANDOFF_FOR_ME"]
    assert mine["count"] == 2
    for item in mine["items"]:
        assert item["note"].startswith("검수 담당(품질·기술) · ")
        assert "가상 전달" not in item["note"]
    assert "HANDOFF_FOR_ME" not in today_rows(client, TECH)
    client.post(f"/api/v1/notes/{first}/confirm", headers=SALES)
    assert today_rows(client, SALES)["HANDOFF_FOR_ME"]["count"] == 1


def test_coach_reads_handoffs_as_colleague_notes_without_names(dashboard_env):
    """Given 확인 전 전달 하나·확인한 전달 하나 / When 코치 보낼 글 / Then [전달 사항]에 두 줄,
    "동료 전달(확인 전)"·"동료 전달(확인함)", 보낸·받는 사람 키·이름은 없다."""
    client, opp_ids = dashboard_env
    done = handoff(client, opp_ids[0], text="가상 전달: 샘플 일정 가능").json()["data"]["noteId"]
    client.post(f"/api/v1/notes/{done}/confirm", headers=SALES)
    handoff(client, opp_ids[0], text="가상 전달: 도금 두께 가능")
    with session_scope() as session:
        plan = build_coach(session, opp_ids[0], "가상 메모", date(2026, 11, 16), 10)
    text = plan.context.text
    assert "[전달 사항]" in text
    assert "동료 전달(확인함): 가상 전달: 샘플 일정 가능" in text
    assert "동료 전달(확인 전): 가상 전달: 도금 두께 가능" in text
    for word in ("kim-gwajang", "park-lee", "검수 담당", "영업 담당"):
        assert word not in text
