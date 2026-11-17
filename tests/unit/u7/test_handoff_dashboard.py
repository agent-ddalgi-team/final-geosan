"""#854 대시보드 전달 사항 [확인]·내가 보낸 전달 사항을 #853 역할 받는 사람에 맞춘다.

"영업"으로 보낸 전달은 영업 계정 모두의 "나에게 온 전달 사항"에 있고, 한 사람이 대시보드 [확인]
(같은 확인 저장)을 누르면 다른 영업 계정과 보낸 사람의 "내가 보낸 전달 사항"에서도 빠진다.
실제 임시 DB·API로 본다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from tests.unit.u7 import test_handoff as single
from tests.unit.u7 import test_handoff_team as team

team_env = team.team_env
dashboard_env = team.dashboard_env
SALES, SALES_2, TECH = team.SALES, team.SALES_2, team.TECH


def test_team_handoff_one_member_confirms_from_dashboard_and_it_leaves_everyone(team_env):
    """Given 검수 담당이 "영업"으로 전달 / When 영업 담당 2가 대시보드 줄의 번호로 확인
    / Then 영업 담당·영업 담당 2의 나에게 온 전달 사항과 검수 담당의 보낸 전달 사항에서
    모두 빠진다."""
    client, opp_ids = team_env
    note_id = team.send(client, opp_ids[0]).json()["data"]["noteId"]
    sent = single.today_rows(client, TECH)["HANDOFF_FROM_ME"]
    assert sent["count"] == 1
    assert sent["items"][0]["note"].startswith("→ 영업 · ")
    for headers in (SALES, SALES_2):
        item = single.today_rows(client, headers)["HANDOFF_FOR_ME"]["items"][0]
        assert item["noteIds"] == [note_id]
    response = client.post(f"/api/v1/notes/{note_id}/confirm", headers=SALES_2)
    assert response.status_code == 200, response.text
    for headers in (SALES, SALES_2):
        assert "HANDOFF_FOR_ME" not in single.today_rows(client, headers)
    assert "HANDOFF_FROM_ME" not in single.today_rows(client, TECH)


def test_sent_rows_name_person_or_team_with_arrow(team_env):
    """Given 한 회사는 사람(영업 담당)에게, 다른 회사는 역할(검수)로 보냄 / When 보낸 사람 대시보드
    / Then "→ 영업 담당 · M/D"와 "→ 검수(품질·기술) · M/D". 같은 역할 사람이 보낸 묶음 전달은
    그 사람의 나에게 온 전달 사항에 없다(#853 규칙 그대로)."""
    client, opp_ids = team_env
    single.handoff(client, opp_ids[0], to="park-lee", headers=SALES_2)
    team.send(client, opp_ids[1], team="QUALITY", headers=SALES_2)
    team.send(client, opp_ids[2], team="SALES", headers=SALES_2)
    notes = {
        item["oppId"]: item["note"]
        for item in single.today_rows(client, SALES_2)["HANDOFF_FROM_ME"]["items"]
    }
    assert notes[opp_ids[0]].startswith("→ 영업 담당 · ")
    assert notes[opp_ids[1]].startswith("→ 검수(품질·기술) · ")
    assert notes[opp_ids[2]].startswith("→ 영업 · ")
    for_me = single.today_rows(client, SALES_2).get("HANDOFF_FOR_ME")
    assert for_me is None or opp_ids[2] not in {item["oppId"] for item in for_me["items"]}
