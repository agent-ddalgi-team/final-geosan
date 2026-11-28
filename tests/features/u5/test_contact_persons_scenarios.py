"""#980: 가상 입력·실제 SQLite·실제 API로 상대 담당자 연락처 가림·열람·보관을 본다.

외부 호출 없음.
"""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u3 import test_company_info_fix as fixing
from tests.unit.u3 import test_contact_persons as support

client = support.client
scenarios("u5/contact_persons.feature")


@given("가상 회사에 박 담당이 상대 담당자 휴대폰을 적었다", target_fixture="context")
def written(client):
    opp_id = fixing.added(client)
    saved = support.add_contact(client, opp_id)
    assert saved.status_code == 200, saved.text
    return {
        "client": client,
        "opp_id": opp_id,
        "contact_id": saved.json()["data"]["contact"]["contactId"],
        "saved": saved.text,
    }


@when("김 담당이 확인 문구에 체크하고 번호를 열면")
def open_number(context):
    client, opp_id = context["client"], context["opp_id"]
    context["listed"] = client.get(support.base(opp_id), headers=support.KIM).text
    context["opened"] = client.post(
        f"{support.base(opp_id)}/{context['contact_id']}/reveal",
        json={"acknowledged": True},
        headers=support.KIM,
    )


@then("열기 전 화면에는 가린 번호만 있고 연 뒤에는 원래 번호가 보이며 열람 기록 1건이 남는다")
def opened(context):
    for text in (context["saved"], context["listed"]):
        assert "010-****-****" in text and "1234" not in text
    assert context["opened"].status_code == 200
    assert context["opened"].json()["data"]["phone"] == "010-1234-5678"
    assert support.reveal_rows() == [("kim-gwajang", context["contact_id"], None)]


@when("보기 전용 계정이 목록과 열기를 요청하면")
def viewer_asks(context):
    client, opp_id = context["client"], context["opp_id"]
    context["list"] = client.get(support.base(opp_id), headers=support.VIEWER)
    context["reveal"] = client.post(
        f"{support.base(opp_id)}/{context['contact_id']}/reveal",
        json={"acknowledged": True},
        headers=support.VIEWER,
    )


@then("둘 다 403이고 열람 기록은 없다")
def refused(context):
    assert context["list"].status_code == 403
    assert context["reveal"].status_code == 403
    assert support.reveal_rows() == []


@given("보관 기한이 열흘 남았다")
def near_limit(context):
    support._near_limit(10)


@when("박 담당이 영업 홈을 열고 [지우기]를 누르면")
def delete_from_home(context):
    client, opp_id = context["client"], context["opp_id"]
    context["before"] = support._retention_row(client, support.PARK)
    response = client.post(
        f"{support.base(opp_id)}/{context['contact_id']}/delete",
        json={"reason": "RETENTION"},
        headers=support.PARK,
    )
    assert response.status_code == 200, response.text
    context["after"] = support._retention_row(client, support.PARK)


@then('지우기 전에는 "지울지 확인" 줄이 있고 지운 뒤에는 번호가 비워지며 줄이 사라진다')
def deleted(context):
    assert context["before"] is not None and context["before"]["count"] == 1
    assert context["after"] is None
    (row,) = support.contact_rows()
    assert row.phone is None and row.person_name is None and row.deleted_reason == "RETENTION"


@given("가상 회사를 이름으로 넣었다", target_fixture="context")
def company(client):
    return {"client": client, "opp_id": fixing.added(client)}


@when("박 담당이 대표번호와 대표명을 고치면")
def edit(context):
    response = fixing.fix(
        context["client"], context["opp_id"], mainPhone="041-555-1234", representativeName="홍길동"
    )
    assert response.status_code == 200, response.text


@then("상세에 담당자 입력으로 보이고 활동 이력에는 번호와 이름 없이 한 줄만 남는다")
def edited(context):
    client, opp_id = context["client"], context["opp_id"]
    header = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["header"]
    assert (header["mainPhone"], header["mainPhoneSource"]) == ("041-555-1234", "MANUAL")
    assert (header["representativeName"], header["representativeNameSource"]) == (
        "홍길동",
        "MANUAL",
    )
    assert fixing.notes(opp_id)[-1] == "대표번호 입력 / 대표명 입력"
