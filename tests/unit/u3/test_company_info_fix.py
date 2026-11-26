"""#958: 상세 "한눈에 › 어떤 회사"의 주소·회사 이름 [고치기](PM 결정 2026-11-26).

주소는 모든 회사, 회사 이름은 직접 넣은 회사만 고친다. 주소가 바뀌면 저장된 좌표를 비운다.
실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 자료만 쓴다(거산 실제 사양 아님).
"""

from sqlalchemy import select

from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.models import Customer, MergeCandidate, Opportunity
from geosan.records.models import Bookmark, Note
from geosan.storage.session import session_scope
from tests.unit.u3 import test_staff_add_company as support

client = support.client
ADD, LOOKUP, STAFF = support.ADD, support.LOOKUP, support.STAFF


def fix(api, opp_id, staff=STAFF, **body):
    return api.post(f"/api/v1/opportunities/{opp_id}/company-info", json=body, headers=staff)


def added(api, name="가상직접회사", address="충남 천안시 가상로 9"):
    response = api.post(ADD, json={"companyName": name, "address": address}, headers=STAFF)
    assert response.status_code == 200, response.text
    return response.json()["data"]["oppId"]


def customer_of(opp_id):
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        session.expunge(customer)
        return customer


def notes(opp_id):
    with session_scope() as session:
        rows = session.scalars(select(Note).where(Note.opp_id == opp_id).order_by(Note.version))
        return [row.text for row in rows]


def set_point(opp_id, source):
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.lat, customer.lng, customer.geocode_source = 36.81, 127.11, source


def evaluations(opp_id):
    with session_scope() as session:
        return len(
            list(session.scalars(select(EvaluationRun).where(EvaluationRun.opp_id == opp_id)))
        )


def test_fixing_the_address_clears_the_old_point_and_leaves_one_history_line(client):
    """Given 좌표가 저장된 회사 / When 주소를 고침
    Then 주소·정규화 주소가 바뀌고 좌표는 비워지며(다음 상세 읽기 때 다시 찾음),
    이력 한 줄, 다시 평가 없음."""
    opp_id = added(client)
    set_point(opp_id, "JUSO")
    runs = evaluations(opp_id)
    response = fix(client, opp_id, address="  충남 아산시 가상로 10  ")
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {
        "companyName": "가상직접회사",
        "address": "충남 아산시 가상로 10",
    }
    assert response.json()["meta"]["reevaluated"] is False
    customer = customer_of(opp_id)
    assert customer.address == "충남 아산시 가상로 10"
    assert customer.normalized_address and "아산" in customer.normalized_address
    assert (customer.lat, customer.lng, customer.geocode_source) == (None, None, None)
    assert notes(opp_id)[-1] == "주소 변경 · 충남 천안시 가상로 9 → 충남 아산시 가상로 10"
    assert evaluations(opp_id) == runs
    # 고치기는 관심을 새로 켜지 않는다(넣기 때 켠 관심 1행 그대로).
    with session_scope() as session:
        assert len(list(session.scalars(select(Bookmark).where(Bookmark.opp_id == opp_id)))) == 1


def test_demo_point_is_kept_when_the_address_changes(client):
    """Given 시연 가상 위치(DEMO) / When 주소를 고침 / Then 가상 위치는 그대로 둔다."""
    opp_id = added(client)
    set_point(opp_id, "DEMO")
    assert fix(client, opp_id, address="충남 아산시 가상로 10").status_code == 200
    assert customer_of(opp_id).geocode_source == "DEMO"


def test_renaming_a_directly_added_company_updates_search_and_history(client):
    """Given 직접 넣은 회사(오타 "가상직접회사") / When 이름을 고침
    Then 이름·검색이 새 이름으로 맞춰지고 이력 "회사 이름 변경 · 전 → 후"."""
    opp_id = added(client, name="가상직접회사")
    response = fix(client, opp_id, companyName="가상직접정밀")
    assert response.status_code == 200, response.text
    assert customer_of(opp_id).name == "가상직접정밀"
    found = client.get(LOOKUP, params={"name": "가상직접정밀"}, headers=STAFF).json()["data"]
    assert [row["oppId"] for row in found["existing"]] == [opp_id]
    assert notes(opp_id)[-1] == "회사 이름 변경 · 가상직접회사 → 가상직접정밀"


def test_both_fields_in_one_save_make_one_line_and_same_values_change_nothing(client):
    """Given 직접 넣은 회사 / When 이름·주소를 함께 고침 / Then 이력 한 줄에 " / "로 잇는다.
    같은 값을 다시 보내면 이력이 늘지 않는다."""
    opp_id = added(client)
    response = fix(client, opp_id, companyName="가상새이름", address="충남 서산시 새길 1")
    assert response.status_code == 200, response.text
    assert notes(opp_id)[-1] == (
        "회사 이름 변경 · 가상직접회사 → 가상새이름 / "
        "주소 변경 · 충남 천안시 가상로 9 → 충남 서산시 새길 1"
    )
    before = notes(opp_id)
    assert (
        fix(client, opp_id, companyName="가상새이름", address="충남 서산시 새길 1").status_code
        == 200
    )
    assert notes(opp_id) == before


def test_same_name_as_another_company_makes_one_merge_candidate(client):
    """Given 다른 회사 "가상겹침회사" / When 직접 넣은 회사 이름을 같게 고침
    Then 겹침 후보 1건(자동으로 합치지 않음). 다시 보내도 더 늘지 않는다."""
    other = added(client, name="가상겹침회사", address="충남 당진시 겹침로 1")
    opp_id = added(client, name="가상다른회사", address="충남 천안시 다른로 2")
    assert fix(client, opp_id, companyName="가상겹침회사").status_code == 200
    with session_scope() as session:
        rows = list(session.scalars(select(MergeCandidate)))
        mine = {customer_of(opp_id).customer_id, customer_of(other).customer_id}
        pairs = [row for row in rows if {row.customer_id_a, row.customer_id_b} == mine]
    assert [row.match_basis for row in pairs] == ["회사명은 같고 공장주소가 달라 확인 필요"]
    assert pairs[0].status == "PENDING"
    assert fix(client, opp_id, address="충남 천안시 다른로 3").status_code == 200
    with session_scope() as session:
        again = [
            row
            for row in session.scalars(select(MergeCandidate))
            if {row.customer_id_a, row.customer_id_b} == mine
        ]
    assert len(again) == 1


def test_wrong_requests_are_refused_and_nothing_changes(client):
    """둘 다 없음·빈 값·전화번호가 섞임·직접 넣지 않은 회사의 이름은 400, 없는 회사는 404,
    담당자가 없거나 모르는 칸이 있으면 거부한다."""
    opp_id = added(client)
    before = (customer_of(opp_id).name, customer_of(opp_id).address, notes(opp_id))
    nothing = fix(client, opp_id)
    assert nothing.status_code == 400
    assert [row["path"] for row in nothing.json()["error"]["fields"]] == ["address"]
    blank = fix(client, opp_id, companyName="   ")
    assert blank.status_code == 400
    assert [row["path"] for row in blank.json()["error"]["fields"]] == ["companyName"]
    phone = fix(client, opp_id, address="충남 천안시 가상로 9 041-000-0000")
    assert phone.status_code == 400
    assert "전화번호나 이메일" in phone.json()["error"]["message"]
    assert fix(client, "opp-없음", address="충남").status_code == 404
    assert fix(client, opp_id, staff={}, address="충남 아산시").status_code >= 400
    assert fix(client, opp_id, address="충남 아산시", extra="x").status_code == 400
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.discovery_source = "FACTORY_FILE"
    official = fix(client, opp_id, companyName="가상바꾼이름")
    assert official.status_code == 400
    assert official.json()["error"]["message"] == "직접 넣은 회사만 이름을 고칠 수 있습니다."
    assert (customer_of(opp_id).name, customer_of(opp_id).address, notes(opp_id)) == before
