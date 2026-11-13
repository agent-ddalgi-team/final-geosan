"""#217: 실제 임시 DB·평가·API로 엑셀 내려받기 시나리오를 확인한다. 외부 AI 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from tests.unit.u7 import test_export_xlsx_api as support

process_env = support.process_env
scenarios("u7/export_xlsx.feature")

PHONE_IN_ITEM = "010-1234-5678"


@given(
    "가상 회사 기회 3건이 목록에 있고 한 곳에 접촉 단계와 다음 일정이 있다",
    target_fixture="env",
)
def companies(process_env, monkeypatch):
    client, ids, _ = process_env
    support.add_outcome(ids[1])
    # 내려받은 기록이 준비된 뒤 운영자가 스위치를 켠 상태에서 시작한다.
    support.mark_download_log_ready(monkeypatch)
    support.set_export_enabled(True)
    return client, ids


@given("앱 설정에서 엑셀 내려받기가 꺼져 있다")
def switch_off(env):
    support.set_export_enabled(False)


@when("화면 설정을 읽는다", target_fixture="ui_config")
def read_ui_config(env):
    response = env[0].get("/api/v1/config/ui")
    assert response.status_code == 200, response.text
    return response.json()["data"]


@then("화면 설정이 엑셀 내려받기가 꺼져 있다고 알려 준다")
def ui_says_off(ui_config):
    assert ui_config["export"] == {"xlsxEnabled": False}


@then("꺼져 있다는 오류를 받고 파일은 없다")
def disabled(response):
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["kind"] == "EXPORT_DISABLED"
    assert error["message"] == "엑셀 내려받기가 꺼져 있습니다."
    assert "content-disposition" not in response.headers
    assert not response.content.startswith(b"PK")


@given("그 회사에 가상 메모와 대표번호가 있고 품목 글에 전화번호가 섞여 있다")
def private_values(env):
    _, ids = env
    support.add_private_values(ids[1])
    with session_scope() as session:
        session.get(Opportunity, ids[1]).item = f"가상 브래킷 {PHONE_IN_ITEM}"


@given("회사의 보안 등급이 금지로 바뀌었다")
def forbidden(env):
    _, ids = env
    with session_scope() as session:
        customer_id = session.get(Opportunity, ids[0]).customer_id
        session.get(Customer, customer_id).security_grade = "FORBIDDEN"


@when("조건 없이 엑셀을 내려받는다", target_fixture="response")
def download(env):
    return env[0].get(support.EXPORT_URL)


@when("접촉 단계로 걸러서 엑셀을 내려받는다", target_fixture="response")
def download_stage(env):
    return env[0].get(support.EXPORT_URL, params={"stage": "IN_PROGRESS"})


@then("첫 줄에 내부용과 가상 데이터 포함 표시가 있다")
def notice(response):
    assert support.sheet_rows(response)[0][0] == "내부용·고객 제출용 아님 · 가상 데이터 포함"


@then("열은 회사 공정 점수 단계 다음 일정 다섯 개뿐이다")
def five_columns(response):
    rows = support.sheet_rows(response)
    assert rows[1] == ["회사", "공정", "점수", "단계", "다음 일정"]
    assert all(len(row) == 5 for row in rows)


@then("엑셀의 회사 순서가 화면 목록과 같다")
def same_order(env, response):
    cards = support.all_cards(env[0])
    assert len(cards) == 3
    assert [row[0] for row in support.sheet_rows(response)[2:]] == [c["title"] for c in cards]


@then("엑셀에는 접촉 단계 회사 한 곳만 있고 다음 일정 날짜가 적혀 있다")
def only_stage(env, response):
    client, ids = env
    cards = support.all_cards(client, stage="IN_PROGRESS")
    assert [card["oppId"] for card in cards] == [ids[1]]
    rows = support.sheet_rows(response)[2:]
    assert [row[0] for row in rows] == [cards[0]["title"]]
    assert rows[0][3:] == ["접촉", "2026-11-20"]


@then("엑셀 어디에도 메모와 대표번호와 전화번호가 없다")
def nothing_private(response):
    rows = support.sheet_rows(response)
    text = "\n".join(str(value) for row in rows for value in row)
    for private in (support.MEMO, support.PHONE, PHONE_IN_ITEM, "가상 일정"):
        assert private not in text
    assert PHONE_IN_ITEM.encode() not in response.content


@then("품목 글은 전화번호만 지워진 채로 적혀 있다")
def scrubbed(response):
    titles = [row[0] for row in support.sheet_rows(response)[2:]]
    assert sum(title.endswith("가상 브래킷 [연락처 제거]") for title in titles) == 1


@then("내보내기 거부 오류와 걸린 항목 목록을 받고 파일은 없다")
def rejected(env, response):
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["kind"] == "EXPORT_REJECTED"
    assert sorted(item["refId"] for item in error["rejectedItems"]) == sorted(env[1])
    assert "content-disposition" not in response.headers
    assert not response.content.startswith(b"PK")
