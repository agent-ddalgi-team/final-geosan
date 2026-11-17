"""#853 전달 사항을 역할 묶음(영업·검수·운영)으로 받기(PM 결정 2026-11-17).

"영업"으로 보내면 영업 계정 모두가 보고, 한 사람이 [확인했어요]를 누르면 끝난다.
실제 임시 DB·API로 본다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import pytest

from geosan.config.models import AppSetting
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7 import test_handoff as single
from tests.unit.u7 import test_menu_badges as menu

dashboard_env = dashboard.dashboard_env
SALES = {"X-Staff-Key": "park-lee"}
SALES_2 = {"X-Staff-Key": "lee-sales"}
TECH = {"X-Staff-Key": "kim-gwajang"}
TEXT = "가상 전달: 도금 두께 요구는 우리 설비로 가능"


@pytest.fixture
def team_env(dashboard_env):
    """영업 담당을 둘(park-lee·lee-sales)로 두고 역할 묶음 영업·검수를 설정한다."""
    with session_scope() as session:
        staff = session.get(AppSetting, "staff")
        staff.value = [*staff.value, {"key": "lee-sales", "displayName": "영업 담당 2"}]
        teams = session.get(AppSetting, "handoffTeams")
        value = [
            {"key": "SALES", "label": "영업", "staffKeys": ["park-lee", "lee-sales"]},
            {"key": "QUALITY", "label": "검수(품질·기술)", "staffKeys": ["kim-gwajang"]},
            # 담당자 목록에 없는 키·보기 전용만 있는 묶음은 화면에 보내지 않는다.
            {"key": "BOSS", "label": "대표", "staffKeys": ["viewer", "nobody"]},
        ]
        if teams is None:
            session.add(AppSetting(setting_key="handoffTeams", value=value, updated_by="test"))
        else:
            teams.value = value
    return dashboard_env


def send(client, opp_id, team="SALES", headers=TECH, **extra):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/notes",
        json={"kind": "HANDOFF", "text": TEXT, "toTeam": team, **extra},
        headers=headers,
    )


def handoff_count(client, headers):
    row = single.today_rows(client, headers).get("HANDOFF_FOR_ME")
    return row["count"] if row else 0


def test_config_lists_teams_with_people_who_can_receive(team_env):
    client, _ = team_env
    teams = client.get("/api/v1/config/ui").json()["data"]["handoffTeams"]
    assert teams == [
        {"key": "SALES", "label": "영업", "staffKeys": ["park-lee", "lee-sales"]},
        {"key": "QUALITY", "label": "검수(품질·기술)", "staffKeys": ["kim-gwajang"]},
    ]


def test_team_handoff_reaches_every_member_and_one_confirm_ends_it(team_env):
    """Given 검수 담당이 "영업"으로 전달 / When 영업 담당 2가 확인
    / Then 영업 둘 다 "나에게 온 전달 사항"에 있다가 함께 사라지고, 보낸 사람은 확인할 수 없다."""
    client, opp_ids = team_env
    response = send(client, opp_ids[0])
    assert response.status_code == 200, response.text
    note_id = response.json()["data"]["noteId"]
    row = single.records(client, opp_ids[0])["handoffs"][0]
    assert (row["to"], row["toTeam"], row["from"]) == ("", "SALES", "kim-gwajang")
    activity = client.get(f"/api/v1/opportunities/{opp_ids[0]}/activity").json()["data"]
    items = activity if isinstance(activity, list) else activity["items"]
    assert any(item["summary"] == f"전달 사항 → 영업 · {TEXT}" for item in items)
    assert handoff_count(client, SALES) == 1
    assert handoff_count(client, SALES_2) == 1
    assert handoff_count(client, TECH) == 0
    assert menu.badges(client, headers=SALES_2)["dashboard"] >= 1
    # 보낸 사람(묶음 밖)은 확인할 수 없다.
    assert client.post(f"/api/v1/notes/{note_id}/confirm", headers=TECH).status_code == 403
    first = client.post(f"/api/v1/notes/{note_id}/confirm", headers=SALES_2)
    assert first.status_code == 200, first.text
    assert first.json()["data"]["confirmedBy"] == "lee-sales"
    # 다른 영업 담당이 다시 눌러도 첫 확인이 그대로다.
    again = client.post(f"/api/v1/notes/{note_id}/confirm", headers=SALES)
    assert again.json()["data"] == first.json()["data"]
    assert handoff_count(client, SALES) == 0
    assert handoff_count(client, SALES_2) == 0


def test_my_own_team_handoff_is_not_mine_to_confirm(team_env):
    """Given 영업 담당이 "영업"으로 보냄
    / Then 다른 영업 담당만 받고, 보낸 사람은 확인할 수 없다."""
    client, opp_ids = team_env
    note_id = send(client, opp_ids[0], headers=SALES).json()["data"]["noteId"]
    assert handoff_count(client, SALES) == 0
    assert handoff_count(client, SALES_2) == 1
    assert client.post(f"/api/v1/notes/{note_id}/confirm", headers=SALES).status_code == 403


@pytest.mark.parametrize(
    "team,headers,extra,path",
    [
        ("SALES", TECH, {"toStaffKey": "park-lee"}, "toTeam"),  # 사람과 묶음을 같이
        ("NOPE", TECH, {}, "toTeam"),  # 없는 묶음
        ("QUALITY", TECH, {}, "toTeam"),  # 묶음에 나뿐
        ("BOSS", TECH, {}, "toTeam"),  # 받을 수 있는 사람이 없음(보기 전용·없는 키)
    ],
)
def test_wrong_team_handoffs_are_refused(team_env, team, headers, extra, path):
    client, opp_ids = team_env
    response = send(client, opp_ids[0], team=team, headers=headers, **extra)
    assert response.status_code == 400
    assert [row["path"] for row in response.json()["error"]["fields"]] == [path]
    assert single.records(client, opp_ids[0])["handoffs"] == []


def test_team_is_only_for_handoffs(team_env):
    client, opp_ids = team_env
    response = client.post(
        f"/api/v1/opportunities/{opp_ids[0]}/notes",
        json={"kind": "MEMO", "text": "가상 메모", "toTeam": "SALES"},
        headers=TECH,
    )
    assert response.status_code == 400
    assert [row["path"] for row in response.json()["error"]["fields"]] == ["toTeam"]


def test_person_handoff_still_works_without_teams(dashboard_env):
    """역할 묶음 설정이 없어도(옛 DB 사본) 사람에게 보내는 전달 사항은 그대로다."""
    client, opp_ids = dashboard_env
    with session_scope() as session:
        row = session.get(AppSetting, "handoffTeams")
        if row is not None:
            row.value = []
    assert client.get("/api/v1/config/ui").json()["data"]["handoffTeams"] == []
    assert single.handoff(client, opp_ids[0]).status_code == 200
    assert single.records(client, opp_ids[0])["handoffs"][0]["toTeam"] is None
