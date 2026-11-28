"""#985: 실제 임시 DB·실제 API로 영업 분석 "상대 반응 — 거산의 강점·약점" 시나리오를 확인한다.

접촉을 실제로 저장(`POST /outcomes`, 상대 반응 답 포함)한 뒤 창구가 그 값을 접촉 건수로 주는지 본다.
외부 AI 호출 없음. 가상 회사만 쓴다.
"""

from pytest_bdd import given, parsers, scenarios, then, when

from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_analysis as support

dashboard_env = support.dashboard_env
scenarios("u7/sales_reactions.feature")

MEMO = "반응 표에 나가면 안 되는 가상 한 줄 메모"
URL = "/api/v1/sales-analysis/reactions"


@given("평가된 가상 회사 4곳에 아직 접촉 기록이 없다", target_fixture="context")
def no_records(dashboard_env):
    client, opp_ids = dashboard_env
    return {"client": client, "opp_ids": opp_ids}


@given(
    "한 곳에 부재 전화를 한 번 남긴 뒤 연결된 전화에서 "
    '상대 반응 "부정적", 걸린 부분 "클레임"이라고 답했다'
)
def negative_claim(context):
    client, (a, *_rest) = context["client"], context["opp_ids"]
    support.record(client, a, support.contact("ABSENT", day="2026-10-15", memo=MEMO))
    support.record(
        client,
        a,
        support.contact(
            "REACHED",
            day="2026-10-16",
            memo=MEMO,
            answers=support.answers(("REACTION", "NEGATIVE"), ("REACTION_BAD", "CLAIM")),
        ),
    )
    context["company"] = a


@given(
    "공정 두 개가 확정된 회사 1곳의 대면 접촉에서 "
    '상대 반응 "긍정적", 좋게 본 부분 "품질·인증"이라고 답했다'
)
def two_process_positive(context):
    client, (a, *_rest) = context["client"], context["opp_ids"]
    support.confirm_second_process(a)
    support.record(
        client,
        a,
        support.contact(
            "REACHED",
            method="VISIT",
            day="2026-10-20",
            answers=support.answers(("REACTION", "POSITIVE"), ("REACTION_GOOD", "QUALITY_CERT")),
        ),
    )


@when("보기 전용 계정이 영업 분석 상대 반응을 연다")
def open_reactions(context):
    response = context["client"].get(URL, headers=support.VIEWER)
    assert response.status_code == 200, response.text
    context["text"] = response.text
    context["body"] = response.json()
    context["data"] = context["body"]["data"]


@when(parsers.parse('보기 전용 계정이 기간 "{value}"로 영업 분석 상대 반응을 연다'))
def open_bad_period(context, value):
    context["response"] = context["client"].get(URL, params={"from": value}, headers=support.VIEWER)


def _numbers(group):
    return (group["answeredCount"], group["positive"], group["neutral"], group["negative"])


@then("접촉 2건 가운데 반응을 남긴 접촉은 1건이고 부정적 1건이다")
def negative_once(context):
    data = context["data"]
    assert data["basis"] == {"minSampleForRatio": 10, "contactCount": 2, "answeredCount": 1}
    assert _numbers(data["total"]) == (1, 0, 0, 1)


@then("걸린 부분은 클레임 1건이고 좋게 본 부분은 비어 있다")
def claim_once(context):
    total = context["data"]["total"]
    assert total["bad"] == [{"answerId": "CLAIM", "count": 1}]
    assert total["good"] == []


@then("접촉 줄 하나가 그 회사 이름·접촉 날짜·통화·부정적·클레임을 보인다")
def contact_line(context):
    rows = context["data"]["contacts"]
    assert len(rows) == 1
    row = rows[0]
    with session_scope() as session:
        customer_id = session.get(Opportunity, context["company"]).customer_id
        saved_name = session.get(Customer, customer_id).name
    assert row["oppId"] == context["company"]
    assert row["name"] == saved_name and saved_name
    assert (row["day"], row["method"], row["reaction"], row["good"], row["bad"]) == (
        "2026-10-16",
        "CALL",
        "NEGATIVE",
        None,
        "CLAIM",
    )


@then("가상 표시가 켜져 있고 응답에 한 줄 메모 글과 담당자 이름이 없다")
def virtual_and_no_text(context):
    assert context["body"]["meta"]["hasVirtualData"] is True
    assert context["body"]["meta"]["datasetKind"] == "VIRTUAL_REVIEWED"
    assert MEMO not in context["text"] and "park-lee" not in context["text"]


@then("아노다이징 줄과 크로메이트 줄에 모두 긍정적 1건, 품질·인증 1건이 잡힌다")
def both_process_rows(context):
    rows = context["data"]["byProcess"]
    assert [(row["processCode"], _numbers(row)) for row in rows] == [
        ("ANODIZING", (1, 1, 0, 0)),
        ("CHROMATE", (1, 1, 0, 0)),
    ]
    assert all(row["good"] == [{"answerId": "QUALITY_CERT", "count": 1}] for row in rows)


@then("전체에는 긍정적 1건만 잡히고 접촉 줄은 하나다")
def total_once(context):
    data = context["data"]
    assert _numbers(data["total"]) == (1, 1, 0, 0)
    assert data["basis"]["contactCount"] == 1 and data["basis"]["answeredCount"] == 1
    assert [(row["method"], row["processCodes"]) for row in data["contacts"]] == [
        ("VISIT", ["ANODIZING", "CHROMATE"])
    ]


@then("400과 함께 from 칸 오류가 온다")
def bad_period(context):
    response = context["response"]
    assert response.status_code == 400, response.text
    assert [field["path"] for field in response.json()["error"]["fields"]] == ["from"]
