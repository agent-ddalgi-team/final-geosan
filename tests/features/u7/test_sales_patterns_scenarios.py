"""#802·#820: 실제 임시 DB·실제 API로 영업 분석 패턴(기준 숫자 없이 펼쳐 보기) 시나리오를 확인한다.

"눈에 띔"이 실제로 골라지는 경우(표본 기준을 넘는 칸)는 회사가 20곳 넘게 필요해 순수 계산
단위 시험(tests/unit/u7/test_sales_patterns.py)에서 본다.

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


@then("끝난 회사 0곳이고 전체 성사율은 없으며 펼친 표와 눈에 띔이 모두 비어 있다")
def empty(context):
    data = context["data"]
    assert data["failure"]["count"] == 0 and data["success"]["count"] == 0
    assert data["basis"] == {
        "minSampleForRatio": 10,
        "closedCount": 0,
        "wonCount": 0,
        "overallWonRatio": None,
    }
    for key in ("contactsBeforeVisit", "longestGap", "answerOutcomes", "combos", "standouts"):
        assert data[key] == [], key
    assert data["questionnaireHints"] == []
    assert "signals" not in data  # 미리 정한 신호는 없앴다(#820)


@then("실패는 2곳(보류 1곳)이고 거절 이유는 가격 1건이다")
def failure(context):
    part = context["data"]["failure"]
    assert (part["count"], part["onHoldCount"]) == (2, 1)
    assert part["lostReasons"] == [{"code": "PRICE", "count": 1}]


@then(
    "방문 없이 접촉 3번 칸에 실패 1곳, 방문 전 접촉 1번 칸에 성사 1곳이고 표본이 적어 판단 보류다"
)
def contact_rows(context):
    rows = {(row["visited"], row["bucket"]): row for row in context["data"]["contactsBeforeVisit"]}
    assert (rows[(False, "THREE")]["failed"], rows[(False, "THREE")]["won"]) == (1, 0)
    assert (rows[(True, "ONE")]["won"], rows[(True, "ONE")]["failed"]) == (1, 0)
    assert all(row["judged"] is False and row["wonRatio"] is None for row in rows.values())


@then('관심 "낮음" 답 칸에 실패 1곳이다')
def interest_low(context):
    row = next(
        r
        for r in context["data"]["answerOutcomes"]
        if r["questionId"] == "INTEREST" and r["answerId"] == "LOW"
    )
    assert (row["failed"], row["won"], row["judged"]) == (1, 0, False)


@then("표본 기준을 넘는 칸이 없어 눈에 띄는 칸이 없다")
def no_standouts(context):
    assert context["data"]["standouts"] == []
    assert context["data"]["basis"]["overallWonRatio"] is None


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
