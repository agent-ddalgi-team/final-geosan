"""#608: 실제 임시 DB·실제 API로 영업 분석표 시나리오를 확인한다. 외부 AI 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u7 import test_sales_analysis as support

dashboard_env = support.dashboard_env
scenarios("u7/sales_analysis.feature")

MEMO = "분석표에 나가면 안 되는 가상 한 줄 메모"


@given("평가된 가상 회사 4곳에 아직 접촉 기록이 없다", target_fixture="context")
def no_records(dashboard_env):
    client, opp_ids = dashboard_env
    return {"client": client, "opp_ids": opp_ids}


@given(
    "한 곳은 전화 2번과 방문 1번 뒤 성사, 한 곳은 메일 1번 뒤 기존 거래처 이유로 거절, "
    "한 곳은 전화 1번만 남겼다"
)
def records(context):
    client, (a, b, c, _d) = context["client"], context["opp_ids"]
    support.record(client, a, support.contact("ABSENT", day="2026-10-15", memo=MEMO))
    support.record(client, a, support.contact("REACHED", day="2026-10-17"))
    support.record(client, a, support.contact("REACHED", method="VISIT", day="2026-10-20"))
    support.record(client, a, {"status": "WON"})
    support.record(client, b, support.contact("ABSENT", method="EMAIL", day="2026-10-16"))
    support.record(client, b, {"status": "LOST", "lostReasonCode": "INCUMBENT_SUPPLIER"})
    support.record(client, c, support.contact("REACHED", day="2026-10-18"))


@when("보기 전용 계정이 영업 분석표를 연다")
def open_analysis(context):
    response = context["client"].get("/api/v1/sales-analysis", headers=support.VIEWER)
    assert response.status_code == 200, response.text
    context["text"] = response.text
    context["body"] = response.json()


@then("공정별 표와 회사별 표가 비어 있고 표본 기준 10건이 함께 온다")
def empty(context):
    data = context["body"]["data"]
    assert data["byProcess"] == [] and data["companies"] == []
    assert data["basis"]["minSampleForRatio"] == 10 and data["basis"]["companyCount"] == 0
    assert data["asOf"]


def _row(context):
    rows = context["body"]["data"]["byProcess"]
    assert [row["processCode"] for row in rows] == ["ANODIZING"]
    return rows[0]


@then("아노다이징 줄은 접촉 3곳, 진행 중 1곳, 성사 1곳, 거절 1곳, 성사까지 평균 3번이다")
def process_row(context):
    row = _row(context)
    assert (
        row["contactedCount"],
        row["inProgressCount"],
        row["onHoldCount"],
        row["wonCount"],
        row["lostCount"],
        row["avgContactsToWon"],
    ) == (3, 1, 0, 1, 1, 3.0)
    assert context["body"]["data"]["basis"]["companyCount"] == 3


@then("방법별 시도와 연결은 전화 3번 중 2번, 메일 1번 중 0번, 방문 1번 중 1번이다")
def reach(context):
    assert _row(context)["contactReach"] == {
        "CALL": {"reached": 2, "tried": 3},
        "EMAIL": {"reached": 0, "tried": 1},
        "VISIT": {"reached": 1, "tried": 1},
    }


@then("거절 이유 분포는 기존 거래처 유지 1건이다")
def lost_reasons(context):
    assert _row(context)["lostReasons"] == [{"code": "INCUMBENT_SUPPLIER", "count": 1}]


@then("표본이 기준보다 적어 비율은 오지 않는다")
def no_ratio(context):
    row = _row(context)
    assert row["ratios"] is None
    assert all(item["ratios"] is None for item in row["byIndustry"])


@then("회사별 표의 성사한 회사 줄은 전화 2, 방문 1, 첫 접촉일과 마지막 접촉일을 보인다")
def company_row(context):
    won_id = context["opp_ids"][0]
    row = next(item for item in context["body"]["data"]["companies"] if item["oppId"] == won_id)
    assert row["name"] == "A정밀"
    assert row["contactCount"] == {"total": 3, "call": 2, "email": 0, "visit": 1}
    assert (row["firstContactAt"], row["lastContactAt"]) == ("2026-10-15", "2026-10-20")
    assert row["outcomeStatus"] == "WON" and row["daysToOutcome"] is not None
    assert len(context["body"]["data"]["companies"]) == 3  # 접촉이 없는 네 번째 회사는 없다


@then("가상 표시가 켜져 있고 응답에 한 줄 메모 글과 담당자 이름이 없다")
def virtual_and_private(context):
    assert context["body"]["meta"]["hasVirtualData"] is True
    assert MEMO not in context["text"] and "park-lee" not in context["text"]
