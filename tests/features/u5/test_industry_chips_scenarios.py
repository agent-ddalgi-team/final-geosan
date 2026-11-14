"""#646: 상세 산업군 칩의 [확정]·[고치기]를 실제 임시 DB·API로 본다.

가상 사례만 쓴다(거산 실제 사양 아님). AI 제안은 DB에 직접 넣어 흉내 낸다(실제 AI 호출 없음).
"""

from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenarios, then, when

from geosan.api.app import create_app
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u1 import test_industry_chips as chips
from tests.unit.u1 import test_sales_confirm as support
from tests.unit.u1 import test_sales_questions as questions
from tests.unit.u7 import test_dashboard_breakdown as breakdown
from tests.unit.u7.test_bookmark import set_bookmark

confirm_env = support.confirm_env
brochure_env = breakdown.brochure_env
scenarios("u5/industry_chips.feature")

UNCONFIRMED = breakdown.UNCONFIRMED_INDUSTRY


def _industry_counts(client):
    rows = breakdown.industry_rows(breakdown.breakdown_of(client))
    return {name: row["count"] for name, row in rows.items()}


def _analysis_industries(client):
    """영업 분석 공정별 표의 산업 줄을 {산업 줄 이름: 접촉한 곳 수}로 모은다."""
    found = {}
    for row in support.analysis(client)["byProcess"]:
        for item in row["byIndustry"]:
            found[item["industry"]] = found.get(item["industry"], 0) + item["contactedCount"]
    return found


@given(
    'AI가 산업군 "반도체"와 "기계·설비"를 제안했고 확정된 것은 없는 가상 회사가 평가돼 있다',
    target_fixture="context",
)
def ai_proposed_company(confirm_env):
    client, ai_only, _ = confirm_env
    assert support.industries(ai_only) == (support.AI_INDUSTRIES, "AI", False)
    return {
        "client": client,
        "opp_id": ai_only,
        "eval_id": support.detail(client, ai_only)["evalId"],
        "notes": chips.note_lines(client, ai_only),
    }


@given(
    '소개서 묶음의 시험용 회사에 AI가 산업군 "반도체"를 제안했고 담당자가 확정한 것은 없다',
    target_fixture="context",
)
def brochure_company(brochure_env):
    # 대시보드 막대는 가상 묶음에서는 만들지 않아(계약 C1) 소개서 묶음 형식의 시험용 회사로 본다.
    opp_id = breakdown.add_company(brochure_env, "chip", industries=["반도체"])
    assert run_evaluation().ok
    breakdown.mark_industries_as_ai(opp_id)
    assert support.industries(opp_id)[:2] == (["반도체"], "AI")
    with TestClient(create_app()) as client:
        yield {"client": client, "opp_id": opp_id, "notes": []}


@given("그 회사는 관심 기업이고 접촉 기록이 하나 있으며 대시보드는 확정 산업군만 센다")
def dashboard_target(context):
    client, opp_id = context["client"], context["opp_id"]
    assert set_bookmark(client, opp_id, True).status_code == 200
    questions.save(client, opp_id, questions.contact(answers=[("WHO_TALKED", "RIGHT_PERSON")]))
    breakdown.set_count_proposed(False)
    context["notes"] = chips.note_lines(client, opp_id)


@given("확정 전에는 대시보드와 영업 분석 모두 산업 확인 전으로만 센다")
def counted_as_unconfirmed(context):
    counts = _industry_counts(context["client"])
    assert counts[UNCONFIRMED] == 1
    assert sum(counts.values()) == 1
    assert _analysis_industries(context["client"]) == {"산업 확인 전": 1}


@when("그 회사의 상세를 열면")
def open_detail(context):
    context["header"] = support.detail(context["client"], context["opp_id"])["header"]


@when("칩에서 제안된 산업군 그대로 확정하면")
def confirm_as_proposed(context):
    header = support.detail(context["client"], context["opp_id"])["header"]
    context["response"] = chips.save(context["client"], context["opp_id"], header["industries"])
    assert context["response"].status_code == 200, context["response"].text


@when(parsers.parse('칩에서 산업군을 "{name}"으로 고쳐 저장하면'))
def edit_to(context, name):
    context["response"] = chips.save(context["client"], context["opp_id"], [name])
    assert context["response"].status_code == 200, context["response"].text


@when(parsers.parse('칩에서 설정 목록에 없는 산업군 "{name}"을 저장하면'))
def save_unknown(context, name):
    context["response"] = chips.save(context["client"], context["opp_id"], ["반도체", name])


@then('산업군은 "반도체"와 "기계·설비"이고 출처는 AI 제안이다')
def shown_as_ai(context):
    header = context["header"]
    assert (header["industries"], header["industriesSource"]) == (support.AI_INDUSTRIES, "AI")


@then('산업군은 "반도체"와 "기계·설비"이고 출처는 담당자 확정이다')
def confirmed_same_values(context):
    assert support.industries(context["opp_id"]) == (support.AI_INDUSTRIES, "STAFF", True)
    header = support.detail(context["client"], context["opp_id"])["header"]
    assert (header["industries"], header["industriesSource"]) == (support.AI_INDUSTRIES, "STAFF")
    data = context["response"].json()["data"]
    assert (data["industries"], data["industriesSource"]) == (support.AI_INDUSTRIES, "STAFF")
    assert data["industriesConfirmedAt"]


@then(parsers.parse('산업군은 "{name}" 하나이고 출처는 담당자 확정이다'))
def confirmed_one(context, name):
    assert support.industries(context["opp_id"]) == ([name], "STAFF", True)
    header = support.detail(context["client"], context["opp_id"])["header"]
    assert (header["industries"], header["industriesSource"]) == ([name], "STAFF")


@then(parsers.parse('활동 이력에 "{line}" 한 줄이 남는다'))
def activity_line(context, line):
    lines = chips.note_lines(context["client"], context["opp_id"])
    assert [text for text in lines if text not in context["notes"]] == [line]


@then("다시 평가하지 않아 평가 번호는 그대로다")
def not_reevaluated(context):
    assert context["response"].json()["meta"]["reevaluated"] is False
    assert support.detail(context["client"], context["opp_id"])["evalId"] == context["eval_id"]


@then('대시보드 산업군 막대의 "자동차 부품"이 1곳이고 미확정은 0곳이다')
def dashboard_counts_confirmed(context):
    counts = _industry_counts(context["client"])
    assert (counts["자동차 부품"], counts[UNCONFIRMED]) == (1, 0)
    assert sum(counts.values()) == 1


@then('영업 분석의 산업 줄 "자동차 부품"에 1곳으로 나온다')
def analysis_counts_confirmed(context):
    assert _analysis_industries(context["client"]) == {"자동차 부품": 1}


@then("400으로 거부되고 어느 값이 틀렸는지 알려 준다")
def rejected_with_field(context):
    response = context["response"]
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["message"] == "산업군 목록에 없는 값입니다. 화면을 새로 고쳐 주세요."
    assert [item["path"] for item in error["fields"]] == ["industries[1]"]


@then("산업군과 출처는 AI 제안 그대로이고 활동 이력도 늘지 않는다")
def untouched(context):
    assert support.industries(context["opp_id"]) == (support.AI_INDUSTRIES, "AI", False)
    assert chips.note_lines(context["client"], context["opp_id"]) == context["notes"]
