"""#998: 공장주소가 같고 회사명이 다른 후보 쌍을 영업 묶음 전달 사항으로 알린다(PM 결정 2026-11-29).

회사명이 같고 주소가 다른 쌍은 그대로 둔다. 같은 쌍에는 한 번만 만든다.
실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 자료만 쓴다(거산 실제 사양 아님).
"""

import pytest
from sqlalchemy import select

from geosan.api.merge_notices import (
    ITEM_PREFIX,
    MERGE_NOTICE_TEAM,
    PROGRAM_STAFF,
    SAME_ADDRESS_BASIS,
    notify_in_new_session,
)
from geosan.config.models import AppSetting
from geosan.opportunity.models import MergeCandidate
from geosan.records.models import Note
from geosan.storage.session import session_scope
from tests.unit.u3 import test_company_info_fix as fixing
from tests.unit.u3 import test_staff_add_company as support

client = support.client
STAFF = support.STAFF
KIM = {"X-Staff-Key": "kim-gwajang"}


@pytest.fixture
def team(client):
    """영업 묶음(SALES)에 박·김 담당을 둔다. 배포 설정과 같은 모양."""
    with session_scope() as session:
        row = session.get(AppSetting, "handoffTeams")
        value = [{"key": "SALES", "label": "영업", "staffKeys": ["park-lee", "kim-gwajang"]}]
        if row is None:
            session.add(AppSetting(setting_key="handoffTeams", value=value, updated_by="test"))
        else:
            row.value = value
    return client


def handoffs(opp_id=None):
    with session_scope() as session:
        query = select(Note).where(Note.kind == "HANDOFF").order_by(Note.created_at)
        if opp_id is not None:
            query = query.where(Note.opp_id == opp_id)
        return [
            (row.opp_id, row.staff_key, row.to_team, row.item_id, row.text)
            for row in session.scalars(query)
        ]


def pair_ids(basis):
    with session_scope() as session:
        return [
            row.merge_candidate_id
            for row in session.scalars(
                select(MergeCandidate).where(MergeCandidate.match_basis == basis)
            )
        ]


def same_address_pair(api):
    """다른 이름의 두 회사를 넣고 둘째 회사 주소를 첫째와 같게 고친다(쌍 1건이 생김)."""
    older = fixing.added(api, name="가상주소회사", address="충남 아산시 겹침로 7")
    newer = fixing.added(api, name="가상다른이름", address="충남 천안시 다른로 2")
    response = fixing.fix(api, newer, address="충남 아산시 겹침로 7")
    assert response.status_code == 200, response.text
    return older, newer


def test_same_address_pair_leaves_one_handoff_on_the_newer_company(team):
    """Given 이름이 다른 두 회사 / When 나중 회사의 주소를 먼저 회사와 같게 고침
    Then 그 저장 안에서 나중 회사에 영업 묶음 전달 사항 1건
    (보낸 쪽 시스템, 먼저 회사 이름만 적힘)."""
    older, newer = same_address_pair(team)
    [merge_id] = pair_ids(SAME_ADDRESS_BASIS)
    rows = handoffs()
    assert len(rows) == 1
    opp_id, sender, team, item_id, text = rows[0]
    assert (opp_id, sender, team, item_id) == (
        newer,
        PROGRAM_STAFF,
        MERGE_NOTICE_TEAM,
        ITEM_PREFIX + merge_id,
    )
    assert "'가상주소회사'" in text and "공장주소가 같고" in text
    assert "겹침로" not in text  # 주소는 글에 넣지 않는다.
    assert handoffs(older) == []


def test_sales_sees_it_from_the_system_and_can_confirm(team):
    """Given 주소 같은 쌍의 전달 사항 / When 영업 담당이 영업 홈과 상세를 본 뒤 [확인]
    Then 영업 홈 "나에게 온 전달 사항"에 "시스템 · 날짜"로 보이고, 확인하면 빠진다."""
    client = team
    _, newer = same_address_pair(client)
    data = client.get("/api/v1/dashboard", headers=KIM).json()["data"]
    row = next(row for row in data["todayChecks"] if row["kind"] == "HANDOFF_FOR_ME")
    item = next(item for item in row["items"] if item["oppId"] == newer)
    assert item["note"].startswith("시스템 · ")
    assert item["text"].startswith("같은 회사일 수 있습니다")
    detail = client.get(f"/api/v1/opportunities/{newer}").json()["data"]["records"]
    handoff = detail["handoffs"][0]
    assert (handoff["from"], handoff["toTeam"]) == (PROGRAM_STAFF, MERGE_NOTICE_TEAM)
    confirmed = client.post(f"/api/v1/notes/{handoff['noteId']}/confirm", headers=KIM)
    assert confirmed.status_code == 200, confirmed.text
    data = client.get("/api/v1/dashboard", headers=KIM).json()["data"]
    left = [row for row in data["todayChecks"] if row["kind"] == "HANDOFF_FOR_ME"]
    assert all(item["oppId"] != newer for row in left for item in row["items"])


def test_same_name_different_address_is_left_alone(client):
    """Given 다른 회사와 이름만 같게 고침(주소 다름) / When 저장
    Then 쌍은 남지만 전달 사항은 없다."""
    fixing.added(client, name="가상겹침회사", address="충남 당진시 겹침로 1")
    opp_id = fixing.added(client, name="가상다른회사", address="충남 천안시 다른로 2")
    assert fixing.fix(client, opp_id, companyName="가상겹침회사").status_code == 200
    assert pair_ids("회사명은 같고 공장주소가 달라 확인 필요")
    assert handoffs() == []
    assert notify_in_new_session() == 0


def test_running_again_never_makes_a_second_note(team):
    """Given 이미 알린 쌍 / When 서버를 다시 켤 때처럼 다시 부름 / Then 더 만들지 않는다."""
    same_address_pair(team)
    assert notify_in_new_session() == 0
    assert notify_in_new_session() == 0
    assert len(handoffs()) == 1


def test_old_pairs_are_noticed_when_called_later(team):
    """Given 알림 전에 생긴 옛 쌍(전달 사항 없음) / When 서버를 켤 때처럼 부름
    Then 1건을 만들고 몇 쌍인지 돌려준다."""
    same_address_pair(team)
    with session_scope() as session:
        for row in session.scalars(select(Note).where(Note.kind == "HANDOFF")):
            session.delete(row)
    assert notify_in_new_session() == 1
    assert len(handoffs()) == 1


def test_without_sales_team_it_goes_to_the_person_who_made_the_pair(client):
    """Given 설정에 영업 묶음이 없음(팀 PC 시험용 DB) / When 박 담당의 저장이 주소 같은 쌍을 만듦
    Then 전달 사항은 박 담당 한 사람에게 간다."""
    _, newer = same_address_pair(client)
    [(opp_id, sender, team_key, _, _)] = handoffs()
    assert (opp_id, sender, team_key) == (newer, PROGRAM_STAFF, None)
    with session_scope() as session:
        note = session.scalar(select(Note).where(Note.kind == "HANDOFF"))
        assert note.to_staff_key == "park-lee"


def test_no_team_and_no_recording_person_means_no_note(client):
    """Given 영업 묶음도 없고 쌍을 만든 쪽이 사람이 아님(system) / When 알림 / Then 받을 사람이 없어
    남기지 않는다. 쌍은 그대로 남는다."""
    same_address_pair(client)
    with session_scope() as session:
        for row in session.scalars(select(Note).where(Note.kind == "HANDOFF")):
            session.delete(row)
        for pair in session.scalars(select(MergeCandidate)):
            pair.created_by = "system"
    assert notify_in_new_session() == 0
    assert pair_ids(SAME_ADDRESS_BASIS)
    assert handoffs() == []


def test_serve_startup_reports_the_count(team, capsys):
    """Given 알리지 않은 옛 쌍 / When 서버 시작 단계
    Then "…1쌍을 영업 묶음 전달 사항으로 남겼습니다"."""
    from geosan.commands.serve import _notify_merge_pairs

    same_address_pair(team)
    with session_scope() as session:
        for row in session.scalars(select(Note).where(Note.kind == "HANDOFF")):
            session.delete(row)
    capsys.readouterr()
    _notify_merge_pairs()
    assert (
        "공장주소가 같은 후보 1쌍을 영업 묶음 전달 사항으로 남겼습니다." in capsys.readouterr().out
    )
    _notify_merge_pairs()
    assert capsys.readouterr().out == ""
