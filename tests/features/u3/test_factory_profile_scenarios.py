"""#573: 실제 임시 SQLite·API로 보조 자료를 붙인 결과가 카드·상세에 보이는지 본다.

외부 호출 없음.
"""

from datetime import date

from pytest_bdd import given, scenarios, then, when

from geosan.opportunity.factory_profile import ProfileIndex, apply_to_customer, road_key
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from tests.unit.u1 import test_own_plating_review as plating
from tests.unit.u1.test_review_checks import detail
from tests.unit.u3 import test_factory_profile as support

records_env = plating.records_env
scenarios("u3/factory_profile.feature")


def _company(opp_id):
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        return customer.name, customer.address


@given("목록 회사와 같은 이름·주소의 팩토리온 공장 행이 저장돼 있다", target_fixture="context")
def profile_saved(records_env, tmp_path):
    client, opp_id = records_env
    name, address = _company(opp_id)
    support._store(
        tmp_path,
        [support.row(**{"회사명": name, "공장주소(도로명)": address, "업종번호": "25929"})],
    )
    return client, opp_id


@given(
    "목록 회사와 같은 도로명·건물번호의 수질 명단 사업장이 저장돼 있다",
    target_fixture="context",
)
def water_saved(records_env, tmp_path):
    client, opp_id = records_env
    # #613: 같은 시·군만으로는 붙이지 않고 도로명·건물번호까지 같아야 붙인다.
    # 시드 회사 주소에는 도로명이 없어 가상 도로명 주소를 넣는다.
    address = "충남 천안시 가상로 7"
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.address = address
        name = customer.name
    assert road_key(address) is not None
    support._store(tmp_path, [], [f"{name} 제2공장,금강유역환경청,{address},위탁처리"])
    return client, opp_id, detail(client, opp_id)


@when("운영자가 보조 자료를 회사에 붙인다")
def attach(context):
    opp_id = context[1]
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        apply_to_customer(customer, ProfileIndex(session), ["25922", "25923"])


@then("카드와 상세 머리에 원자재·종업원 수·공장 규모·기준일이 같은 값으로 나온다")
def profile_shown(context):
    client, opp_id = context
    expected = {
        "rawMaterials": "강판, SUS",
        "employeeCount": 12,
        "scale": "소기업",
        "fileDate": date(2026, 11, 11).isoformat(),
    }
    cards = client.get("/api/v1/opportunities").json()["data"]
    card = next(card for card in cards if card["oppId"] == opp_id)
    assert card["factoryProfile"] == expected
    assert detail(client, opp_id)["header"]["factoryProfile"] == expected
    # 업종번호 25929(그 밖의 금속가공)는 표면처리 표시를 붙이지 않는다.
    assert card["ownPlatingLineSuspected"] is False


@then("상세 검토사항 끝에 수질 명단 근거의 표면처리 확인 줄이 규칙 출처로 생긴다")
def water_item(context):
    client, opp_id, before = context
    after = detail(client, opp_id)
    assert after["reviewItems"][:-1] == before["reviewItems"]
    item = after["reviewItems"][-1]
    assert item["itemId"] == plating.ITEM_ID and item["source"] == "RULE"
    basis = "특정수질유해물질 배출 사업장 명단에 있음(국립환경과학원, 공공누리 제1유형)"
    assert item["text"] == f"{plating.LABEL}: {basis}"
    assert after["header"]["factoryProfile"] is None


@then("회사는 목록에 그대로 남는다")
def still_listed(context):
    client, opp_id, _ = context
    cards = client.get("/api/v1/opportunities").json()["data"]
    assert any(card["oppId"] == opp_id and card["ownPlatingLineSuspected"] for card in cards)
