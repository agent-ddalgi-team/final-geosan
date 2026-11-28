"""#998: 가상 입력·실제 SQLite·실제 API로 '주소 같음' 쌍의 전달 사항을 본다. 외부 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u3 import test_company_info_fix as fixing
from tests.unit.u3 import test_merge_notices as support

client = support.client
team = support.team
scenarios("u3/same_address_notice.feature")


@given("영업 묶음이 있고 이름이 다른 가상 회사 두 곳을 넣었다", target_fixture="context")
def two_companies(team):
    older = fixing.added(team, name="가상주소회사", address="충남 아산시 겹침로 7")
    newer = fixing.added(team, name="가상다른이름", address="충남 천안시 다른로 2")
    return {"client": team, "older": older, "newer": newer}


@when("나중 회사의 주소를 먼저 회사와 같게 고치면")
def same_address(context):
    response = fixing.fix(context["client"], context["newer"], address="충남 아산시 겹침로 7")
    assert response.status_code == 200, response.text


@when("나중 회사의 이름을 먼저 회사와 같게 고치면")
def same_name(context):
    response = fixing.fix(context["client"], context["newer"], companyName="가상주소회사")
    assert response.status_code == 200, response.text


def _for_me(client, opp_id):
    data = client.get("/api/v1/dashboard", headers=support.KIM).json()["data"]
    rows = [row for row in data["todayChecks"] if row["kind"] == "HANDOFF_FOR_ME"]
    return [item for row in rows for item in row["items"] if item["oppId"] == opp_id]


@then('나중 회사에 보낸 쪽 "시스템"의 전달 사항 1건이 영업 담당 영업 홈에 보이고 확인하면 빠진다')
def noticed(context):
    client, newer = context["client"], context["newer"]
    assert [row[0] for row in support.handoffs()] == [newer]
    [item] = _for_me(client, newer)
    assert item["note"].startswith("시스템 · ")
    [note_id] = item["noteIds"]
    assert client.post(f"/api/v1/notes/{note_id}/confirm", headers=support.KIM).status_code == 200
    assert _for_me(client, newer) == []


@then("같은 회사일 수 있는 쌍은 남지만 전달 사항은 없다")
def left_alone(context):
    assert support.pair_ids("회사명은 같고 공장주소가 달라 확인 필요")
    assert support.handoffs() == []
