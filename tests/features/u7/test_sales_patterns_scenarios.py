"""#802 1단계: 실제 임시 DB·실제 API로 영업 분석 패턴 세기 시나리오를 확인한다.

외부 AI 호출 없음.
"""

from pytest_bdd import given, parsers, scenarios, then, when

from tests.unit.u7 import test_sales_analysis as support

dashboard_env = support.dashboard_env
scenarios("u7/sales_patterns.feature")

MEMO = "패턴에 나가면 안 되는 가상 한 줄 메모"
URL = "/api/v1/sales-analysis/patterns"


@given("평가된 가상 회사 4곳에 아직 접촉 기록이 없다", target_fixture="context")
def no_records(dashboard_env):
    client, opp_ids = dashboard_env
    return {"client": client, "opp_ids": opp_ids}


@given(
    "한 곳은 전화만 3번 남기고 가격 이유로 거절, 한 곳은 전화 뒤 방문해 성사, "
    "한 곳은 연결된 전화에서 관심이 낮다고 답한 뒤 보류했다"
)
def records(context):
    client, (a, b, c, _d) = context["client"], context["opp_ids"]
    for day in ("2026-10-15", "2026-10-17", "2026-10-20"):
        support.record(client, a, support.contact("ABSENT", day=day, memo=MEMO))
    support.record(client, a, {"status": "LOST", "lostReasonCode": "PRICE"})
    support.record(client, b, support.contact("REACHED", day="2026-10-16"))
    support.record(client, b, support.contact("REACHED", method="VISIT", day="2026-10-21"))
    support.record(client, b, {"status": "WON"})
    support.record(
        client,
        c,
        support.contact(
            "REACHED", day="2026-10-18", answers=[{"questionId": "INTEREST", "answerId": "LOW"}]
        ),
    )
    support.record(client, c, {"status": "ON_HOLD"})


@when("보기 전용 계정이 영업 분석 패턴을 연다")
def open_patterns(context):
    response = context["client"].get(URL, headers=support.VIEWER)
    assert response.status_code == 200, response.text
    context["text"] = response.text
    context["data"] = response.json()["data"]


@when(parsers.parse('보기 전용 계정이 기간 "{value}"로 영업 분석 패턴을 연다'))
def open_bad_period(context, value):
    context["response"] = context["client"].get(URL, params={"from": value}, headers=support.VIEWER)


@then("실패·성공은 0곳이고 쓸 수 있는 기록 0곳 / 필요 30곳으로 부족하다")
def empty(context):
    data = context["data"]
    assert data["failure"]["count"] == 0 and data["success"]["count"] == 0
    assert data["basis"] == {
        "minSampleForRatio": 10,
        "usableCount": 0,
        "neededCount": 30,
        "enough": False,
    }
    assert data["combos"] == [] and data["questionnaireHints"] == []


@then("실패는 2곳(보류 1곳)이고 거절 이유는 가격 1건이다")
def failure(context):
    part = context["data"]["failure"]
    assert (part["count"], part["onHoldCount"]) == (2, 1)
    assert part["lostReasons"] == [{"code": "PRICE", "count": 1}]


def _signal(context, code, question=None):
    return next(
        row
        for row in context["data"]["signals"]
        if row["code"] == code and row["questionId"] == question
    )


@then('"전화만·방문 없음" 신호는 실패 쪽 1곳이고 표본이 적어 판단 보류다')
def call_only(context):
    row = _signal(context, "CALL_ONLY")
    assert (row["withSignal"], row["failed"], row["won"]) == (1, 1, 0)
    assert row["failedShare"] == 0.5 and row["judged"] is False


@then('"관심 낮음" 신호는 실패 쪽 1곳이다')
def interest_low(context):
    row = _signal(context, "ANSWER", "INTEREST")
    assert (row["withSignal"], row["failed"]) == (1, 1)
    assert row["answerIds"] == ["LOW", "NONE"]


@then("성사한 회사는 2번째 접촉에서 처음 방문했다")
def first_visit(context):
    assert context["data"]["success"]["avgFirstVisitIndex"] == 2.0


@then("응답에 한 줄 메모 글과 회사 이름이 없다")
def no_text(context):
    assert MEMO not in context["text"]
    assert "가상)" not in context["text"] and "A정밀" not in context["text"]


@then("400과 함께 from 칸 오류가 온다")
def bad_period(context):
    response = context["response"]
    assert response.status_code == 400, response.text
    assert "from" in response.text
