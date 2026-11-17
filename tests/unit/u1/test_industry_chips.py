"""#646: 상세 산업군 칩의 저장 창구 `POST /opportunities/{oppId}/industries`.

실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import pytest
from sqlalchemy import select

from geosan.config.models import AppSetting
from geosan.records.models import Bookmark, Note
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_confirm as support

confirm_env = support.confirm_env


def save(client, opp_id, industries, staff="park-lee", **extra):
    headers = {"X-Staff-Key": staff} if staff else {}
    return client.post(
        f"/api/v1/opportunities/{opp_id}/industries",
        json={"industries": industries, **extra},
        headers=headers,
    )


def note_lines(client, opp_id):
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    # #731 PM 결정 2026-11-14: 프로그램이 남긴 줄은 메모(NOTE)가 아니라 변경 기록(CHANGE)이다.
    return [row["summary"] for row in activity if row["kind"] == "CHANGE"]


def settings_industries():
    with session_scope() as session:
        return list(session.get(AppSetting, "industries").value)


def test_saved_order_follows_settings_and_note_is_virtual_memo(confirm_env):
    """Given AI 제안 / When 설정과 다른 순서로 저장 / Then 설정 순서로 저장·이력 한 줄."""
    client, opp_id, _ = confirm_env
    order = settings_industries()
    picked = [order[3], order[0]]
    response = save(client, opp_id, picked)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["data"]["industries"] == [order[0], order[3]]
    assert body["data"]["industriesSource"] == "STAFF"
    assert body["meta"]["reevaluated"] is False
    assert body["meta"]["hasVirtualData"] is True
    assert note_lines(client, opp_id) == [f"상세에서 산업 확정 · {order[0]}, {order[3]}"]
    with session_scope() as session:
        note = session.scalars(select(Note).where(Note.opp_id == opp_id)).one()
        assert (note.kind, note.staff_key, note.is_virtual) == ("CHANGE", "park-lee", True)
        # 산업군 확정은 관심(찜)을 자동으로 켜지 않는다.
        assert not list(session.scalars(select(Bookmark).where(Bookmark.opp_id == opp_id)))


def test_same_confirmed_values_change_nothing(confirm_env):
    """Given 이미 담당자 확정 / When 같은 값을 다시 저장 / Then 그대로이고 이력도 늘지 않는다."""
    client, opp_id, _ = confirm_env
    assert save(client, opp_id, ["반도체"]).status_code == 200
    first = support.industries(opp_id)
    with session_scope() as session:
        stamp = session.scalars(select(Note.created_at).where(Note.opp_id == opp_id)).one()
    response = save(client, opp_id, ["반도체"])
    assert response.status_code == 200, response.text
    assert response.json()["data"]["industries"] == ["반도체"]
    assert support.industries(opp_id) == first
    assert note_lines(client, opp_id) == ["상세에서 산업 확정 · 반도체"]
    with session_scope() as session:
        assert session.scalars(select(Note.created_at).where(Note.opp_id == opp_id)).one() == stamp


def test_case_file_values_become_staff_when_edited(confirm_env):
    """Given 사례 파일 산업군 / When 칩에서 고침 / Then 담당자 확정으로 바뀐다."""
    client, _, mixed = confirm_env
    assert support.industries(mixed)[1] != "STAFF"
    assert save(client, mixed, ["항공우주"]).status_code == 200
    assert support.industries(mixed) == (["항공우주"], "STAFF", True)


def test_empty_list_returns_to_unconfirmed(confirm_env):
    """Given 담당자 확정 / When 빈 배열 저장 / Then 값·출처·확정 시각이 비고 이력 한 줄."""
    client, opp_id, _ = confirm_env
    assert save(client, opp_id, ["반도체"]).status_code == 200
    response = save(client, opp_id, [])
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["industries"], data["industriesSource"], data["industriesConfirmedAt"]) == (
        [],
        None,
        None,
    )
    assert support.industries(opp_id) == ([], None, False)
    header = support.detail(client, opp_id)["header"]
    assert (header["industries"], header["industriesSource"]) == ([], None)
    assert sorted(note_lines(client, opp_id)) == [
        "상세에서 산업 미확정으로 되돌림",
        "상세에서 산업 확정 · 반도체",
    ]
    # 이미 미확정이면 다시 보내도 이력이 늘지 않는다.
    count = len(note_lines(client, opp_id))
    assert save(client, opp_id, []).status_code == 200
    assert len(note_lines(client, opp_id)) == count


@pytest.mark.parametrize(
    "industries,message,paths",
    [
        (
            ["반도체", "없는 산업"],
            "산업군 목록에 없는 값입니다. 화면을 새로 고쳐 주세요.",
            ["industries[1]"],
        ),
        (["반도체", "반도체"], "같은 산업군을 두 번 골랐습니다.", ["industries[1]"]),
        (
            ["방위산업", "반도체", "항공우주", "기타"],
            "산업군은 3개까지 고를 수 있습니다.",
            ["industries"],
        ),
    ],
)
def test_invalid_values_are_rejected_and_nothing_is_saved(confirm_env, industries, message, paths):
    """Given AI 제안 / When 목록 밖·중복·4개 / Then 400이고 값·이력은 그대로다."""
    client, opp_id, _ = confirm_env
    response = save(client, opp_id, industries)
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["message"] == message
    assert [item["path"] for item in error["fields"]] == paths
    assert support.industries(opp_id) == (support.AI_INDUSTRIES, "AI", False)
    assert note_lines(client, opp_id) == []


def test_bad_body_missing_company_and_viewer_are_rejected(confirm_env):
    """Given 칩 저장 창구 / When 본문 오류·없는 회사·담당자 아님 / Then 400·404·403, 저장 없음."""
    client, opp_id, _ = confirm_env
    url = f"/api/v1/opportunities/{opp_id}/industries"
    headers = {"X-Staff-Key": "park-lee"}
    assert client.post(url, json={}, headers=headers).status_code == 400
    assert client.post(url, json={"industries": "반도체"}, headers=headers).status_code == 400
    assert client.post(url, json={"industries": [1]}, headers=headers).status_code == 400
    assert save(client, opp_id, ["반도체"], source="AI").status_code == 400
    assert save(client, "missing", ["반도체"]).status_code == 404
    assert save(client, opp_id, ["반도체"], staff=None).status_code == 403
    assert save(client, opp_id, ["반도체"], staff="nobody").status_code == 403
    assert support.industries(opp_id) == (support.AI_INDUSTRIES, "AI", False)
    assert note_lines(client, opp_id) == []
