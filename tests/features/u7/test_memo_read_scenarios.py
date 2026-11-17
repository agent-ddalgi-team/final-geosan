"""#720: 메모 읽기를 실제 임시 DB·실제 API로 본다. 외부 AI는 가짜 응답이다(실제 호출 없음)."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.records.models import Note
from geosan.storage.session import session_scope
from tests.unit.u1.test_sales_confirm import links
from tests.unit.u7 import test_memo_read as memo
from tests.unit.u7 import test_sales_assistant as support

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
memo_env = memo.memo_env
scenarios("u7/memo_read.feature")


@given(
    "아노다이징이 확정된 가상 회사에 이름과 전화가 적힌 메모가 저장돼 있고 "
    "영업 기록 스위치가 켜져 있다",
    target_fixture="context",
)
def company_with_memo(memo_env):
    client, opp_ids, fake, target, _ = memo_env
    opp_id = opp_ids[0]
    assert links(opp_id)["ANODIZING"][1] == "CONFIRMED"
    return {
        "client": client,
        "opp_id": opp_id,
        "fake": fake,
        "target": target,
        "links": links(opp_id),
        "rows": support.row_counts(),
    }


@when("그 메모로 메모 읽기를 부르면")
def read_memo(context):
    context["response"] = memo.memo_read(context["client"], context["opp_id"], context["target"])


@when("스위치를 끄고 그 메모로 메모 읽기를 부르면")
def read_memo_with_switch_off(context):
    support.use_external_ai(salesRecordsEnabled=False)
    read_memo(context)


@then('외부 AI로 나간 글에는 "[이름] 과장과 통화"가 있고 사람 이름과 전화번호는 없다')
def only_scrubbed_copy_went_out(context):
    assert context["response"].status_code == 200, context["response"].text
    sent = context["fake"].sent
    assert "[이름] 과장과 통화" in sent
    for planted in ("김철수", "철수", "홍길동", "010-0000-0000"):
        assert planted not in sent, planted


@then('응답에 한 줄 요약과 "아노다이징 → 아연도금" 공정 제안과 근거 구절이 온다')
def summary_and_proposal(context):
    data = context["response"].json()["data"]
    assert data["summary"]
    (proposal,) = data["proposals"]
    assert (proposal["kind"], proposal["before"], proposal["after"]) == (
        "PROCESS",
        ["아노다이징"],
        ["아연도금(전기아연도금)"],
    )
    assert proposal["quote"] == "아연도금으로 바꾸고 싶다고 함"


@then("회사의 공정·기록·저장된 메모는 그대로이고 전송 기록만 1행 늘었다")
def nothing_changed(context):
    opp_id = context["opp_id"]
    assert links(opp_id) == context["links"]
    assert support.row_counts() == context["rows"]
    with session_scope() as session:
        assert session.get(Note, context["target"]).text == memo.MEMO
    assert support.logs() == [(opp_id, "SALES_RECORD", "ALLOWED", 1)]


@when("받은 공정 제안을 접촉 없이 공정 확인 답으로 저장하면")
def apply_process_proposal(context):
    (proposal,) = context["response"].json()["data"]["proposals"]
    body = {
        "status": "NOT_EXECUTED",
        "answers": [
            {"questionId": "CONFIRM_PROCESS", "answerId": code} for code in proposal["values"]
        ],
    }
    response = context["client"].post(
        f"/api/v1/opportunities/{context['opp_id']}/outcomes", json=body, headers=support.STAFF
    )
    assert response.status_code == 200, response.text


@then(
    "확정 공정은 아연도금만 남고 활동 이력에 "
    '"공정 변경 · 아노다이징 → 아연도금(전기아연도금)"이 남는다'
)
def process_replaced(context):
    opp_id = context["opp_id"]
    assert links(opp_id) == {"ZINC_PLATING": ("STAFF", "CONFIRMED", "park-lee")}
    with session_scope() as session:
        texts = list(
            session.scalars(select(Note.text).where(Note.opp_id == opp_id).order_by(Note.version))
        )
    assert texts[-1] == "공정 변경 · 아노다이징 → 아연도금(전기아연도금)"


@then('"영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다."로 거부되고 외부 AI는 불리지 않는다')
def rejected_by_switch(context):
    response = context["response"]
    assert response.status_code == 422, response.text
    assert (
        response.json()["error"]["message"] == "영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다."
    )
    assert context["fake"].payloads == []
