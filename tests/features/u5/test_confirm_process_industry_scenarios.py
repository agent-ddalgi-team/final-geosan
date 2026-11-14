"""#652: 꼬리 질문의 공정·산업 확인과 영업 분석 세는 기준을 실제 임시 DB·API로 본다."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1 import test_sales_confirm as support
from tests.unit.u1 import test_sales_questions as questions
from tests.unit.u1 import test_sales_records as records

confirm_env = support.confirm_env
scenarios("u5/confirm_process_industry.feature")

AI_LINKS = {
    "ANODIZING": ("AI", "PENDING", None),
    "ZINC_PLATING": ("AI", "PENDING", None),
    "CHROMATE": ("AI", "PENDING", None),
}


def _context(client, opp_id):
    return {
        "client": client,
        "opp_id": opp_id,
        "eval_id": support.detail(client, opp_id)["evalId"],
        "link_rows": support.all_link_rows(opp_id),
        "evaluations": support.evaluation_count(opp_id),
    }


def _groups(context):
    """영업 분석 공정별 표를 {공정 줄 이름: {산업 줄 이름: 접촉한 곳 수}}로."""
    return {
        row["processName"]: {item["industry"]: item["contactedCount"] for item in row["byIndustry"]}
        for row in support.analysis(context["client"])["byProcess"]
    }


def _company(context):
    rows = support.analysis(context["client"])["companies"]
    return next(row for row in rows if row["oppId"] == context["opp_id"])


@given(
    "AI가 공정 3개와 산업군 2개를 제안했고 담당자가 확정한 것은 없는 가상 회사가 평가돼 있다",
    target_fixture="context",
)
def ai_only_company(confirm_env):
    client, ai_only, _ = confirm_env
    assert support.links(ai_only) == AI_LINKS
    return _context(client, ai_only)


@given(
    "사례 파일로 아노다이징이 확정된 가상 회사에 AI가 아연도금과 크로메이트를 제안했다",
    target_fixture="context",
)
def mixed_company(confirm_env):
    client, _, mixed = confirm_env
    assert support.links(mixed)["ANODIZING"][:2] == ("CASE_FILE", "CONFIRMED")
    return _context(client, mixed)


@when("공정·산업을 고르지 않고 연결된 접촉만 저장하면")
def contact_only(context):
    body = questions.contact(answers=[("WHO_TALKED", "RIGHT_PERSON")])
    questions.save(context["client"], context["opp_id"], body)


@then("AI 공정 제안 3개와 AI 산업군은 그대로다")
def proposals_untouched(context):
    assert support.links(context["opp_id"]) == AI_LINKS
    assert support.industries(context["opp_id"]) == (support.AI_INDUSTRIES, "AI", False)
    assert support.detail(context["client"], context["opp_id"])["evalId"] == context["eval_id"]


@then('영업 분석에는 "공정 확인 전" 줄의 "산업 확인 전"에만 1곳으로 나온다')
def only_unconfirmed_rows(context):
    assert _groups(context) == {"공정 확인 전": {"산업 확인 전": 1}}
    data = support.analysis(context["client"])
    assert data["byProcess"][0]["processCode"] is None
    company = _company(context)
    assert (company["processCodes"], company["industries"]) == ([], [])


@when('연결된 접촉에서 공정 "아연도금"과 산업 "반도체"를 골라 저장하면')
def pick_one_each(context):
    body = questions.contact(answers=support.picks(["ZINC_PLATING"], ["반도체"]))
    response = records.post(context["client"], context["opp_id"], "outcomes", body)
    assert response.status_code == 200, response.text
    context["meta"] = response.json()["meta"]


@then("아연도금은 담당자 확정이 되고 안 고른 AI 제안 2개는 지워지지 않고 이력으로만 남는다")
def one_confirmed(context):
    assert support.links(context["opp_id"]) == {"ZINC_PLATING": ("STAFF", "CONFIRMED", "park-lee")}
    # 지운 행은 없다: AI 행 3개는 이력으로 남고 담당자 확정 행 하나가 더해졌다.
    assert support.all_link_rows(context["opp_id"]) == context["link_rows"] + 1
    detail = support.detail(context["client"], context["opp_id"])
    assert [row["processCode"] for row in detail["processLinks"]] == ["ZINC_PLATING"]
    assert not [row for row in detail["reviewItems"] if row["itemId"].startswith("PL:")]


@then("산업군은 반도체 하나이고 출처는 담당자 확정이다")
def industry_confirmed(context):
    assert support.industries(context["opp_id"]) == (["반도체"], "STAFF", True)
    header = support.detail(context["client"], context["opp_id"])["header"]
    assert (header["industries"], header["industriesSource"]) == (["반도체"], "STAFF")


@then('다시 평가되고 활동 이력에 "꼬리 질문으로 공정 확정" 한 줄이 남는다')
def reevaluated_and_logged(context):
    client, opp_id = context["client"], context["opp_id"]
    assert context["meta"]["reevaluated"] is True
    assert support.detail(client, opp_id)["evalId"] != context["eval_id"]
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    lines = [row["summary"] for row in activity if row["kind"] == "NOTE"]
    assert lines == [
        "꼬리 질문으로 공정 확정 · 아연도금(전기아연도금) · AI 제안 2개 뺌"
        " / 꼬리 질문으로 산업 확정 · 반도체"
    ]


@then("영업 분석에는 아연도금 줄의 반도체에만 1곳으로 나온다")
def only_confirmed_rows(context):
    assert _groups(context) == {"아연도금(전기아연도금)": {"반도체": 1}}
    company = _company(context)
    assert (company["processCodes"], company["industries"]) == (["ZINC_PLATING"], ["반도체"])


@then("알아낸 것에 아연도금과 반도체가 남고 두 질문은 다시 묻지 않는다")
def known_and_closed(context):
    step = support.detail(context["client"], context["opp_id"])["records"]["salesStep"]
    known = {(row["questionId"], row["answerId"], row["answer"]) for row in step["known"]}
    assert (support.PROCESS, "ZINC_PLATING", "아연도금(전기아연도금)") in known
    assert (support.INDUSTRY, "반도체", "반도체") in known
    assert support.PROCESS not in step["openQuestions"]
    assert support.INDUSTRY not in step["openQuestions"]


@when('연결된 접촉에서 공정 "크로메이트"만 골라 저장하면')
def pick_chromate(context):
    body = questions.contact(answers=support.picks(["CHROMATE"]))
    questions.save(context["client"], context["opp_id"], body)


@then(
    "확정 공정은 크로메이트만 남고 아노다이징은 지워지지 않고 이력으로만 남으며 "
    "아연도금 제안은 빠진다"
)
def replaced_by_chromate(context):
    opp_id = context["opp_id"]
    assert support.links(opp_id) == {"CHROMATE": ("STAFF", "CONFIRMED", "park-lee")}
    # 지운 행은 없다: 사례 파일 행·AI 행 2개는 이력으로 남고 담당자 확정 행 하나가 더해졌다.
    assert support.all_link_rows(opp_id) == context["link_rows"] + 1
    assert support.superseded_codes(opp_id) == {
        ("ANODIZING", "CASE_FILE"),
        ("CHROMATE", "AI"),
        ("ZINC_PLATING", "AI"),
    }
    detail = support.detail(context["client"], opp_id)
    assert [row["processCode"] for row in detail["processLinks"]] == ["CHROMATE"]


@then('다시 평가는 한 번이고 활동 이력에 "공정 변경 · 아노다이징 → 크로메이트" 한 줄이 남는다')
def changed_once_and_logged(context):
    client, opp_id = context["client"], context["opp_id"]
    assert support.evaluation_count(opp_id) == context["evaluations"] + 1
    assert support.detail(client, opp_id)["evalId"] != context["eval_id"]
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    lines = [row["summary"] for row in activity if row["kind"] == "NOTE"]
    assert lines == ["공정 변경 · 아노다이징 → 크로메이트 · AI 제안 1개 뺌"]


@then("영업 분석에는 크로메이트 줄에만 1곳으로 나온다")
def only_chromate_row(context):
    groups = _groups(context)
    assert {name: sum(rows.values()) for name, rows in groups.items()} == {"크로메이트": 1}


@when('연결된 접촉에서 공정 "아노다이징"과 "크로메이트"를 골라 저장하면')
def pick_both(context):
    body = questions.contact(answers=support.picks(["ANODIZING", "CHROMATE"]))
    questions.save(context["client"], context["opp_id"], body)


@then("확정 공정과 AI 제안은 그대로이고 다시 평가하지 않는다")
def mixed_untouched(context):
    opp_id = context["opp_id"]
    assert support.links(opp_id) == {
        "ANODIZING": ("CASE_FILE", "CONFIRMED", None),
        "ZINC_PLATING": ("AI", "PENDING", None),
        "CHROMATE": ("AI", "PENDING", None),
    }
    assert support.all_link_rows(opp_id) == context["link_rows"]
    assert support.evaluation_count(opp_id) == context["evaluations"]


@then("아노다이징은 사례 파일 확정 그대로이고 크로메이트는 담당자 확정이며 아연도금 제안은 빠진다")
def case_file_link_kept(context):
    assert support.links(context["opp_id"]) == {
        "ANODIZING": ("CASE_FILE", "CONFIRMED", None),
        "CHROMATE": ("STAFF", "CONFIRMED", "park-lee"),
    }
    assert support.detail(context["client"], context["opp_id"])["evalId"] != context["eval_id"]


@then("영업 분석에는 아노다이징 줄과 크로메이트 줄에 1곳씩 나온다")
def two_confirmed_rows(context):
    groups = _groups(context)
    assert {name: sum(rows.values()) for name, rows in groups.items()} == {
        "아노다이징": 1,
        "크로메이트": 1,
    }


@when("연결된 접촉에서 목록에 없는 공정을 골라 저장하면")
def pick_unknown(context):
    body = questions.contact(answers=support.picks(["NOT_A_PROCESS"]))
    context["response"] = records.post(context["client"], context["opp_id"], "outcomes", body)


@then(
    '"질문 목록에 없는 질문이나 보기입니다. 화면을 새로 고쳐 주세요."로 거부되고 '
    "접촉 기록과 공정 제안은 그대로다"
)
def rejected(context):
    response = context["response"]
    assert response.status_code == 400, response.text
    assert response.json()["error"]["fields"] == [
        {
            "path": "answers[0]",
            "message": "질문 목록에 없는 질문이나 보기입니다. 화면을 새로 고쳐 주세요.",
        }
    ]
    assert support.outcome_count(context["opp_id"]) == 0
    assert support.links(context["opp_id"]) == AI_LINKS


@when('다시 평가가 실패하는 상태에서 공정 "아연도금"과 산업 "반도체"를 골라 저장하면')
def pick_while_evaluation_fails(context, monkeypatch):
    support.failing_evaluation(monkeypatch)
    body = questions.contact(answers=support.picks(["ZINC_PLATING"], ["반도체"]))
    context["response"] = records.post(context["client"], context["opp_id"], "outcomes", body)


@then("저장이 실패하고 접촉 기록·공정 제안·산업군은 모두 그대로다")
def all_rolled_back(context):
    response = context["response"]
    assert response.status_code == 500 and "취소" in response.json()["error"]["message"]
    opp_id = context["opp_id"]
    assert support.outcome_count(opp_id) == 0
    assert support.links(opp_id) == AI_LINKS
    assert support.all_link_rows(opp_id) == context["link_rows"]
    assert support.industries(opp_id) == (support.AI_INDUSTRIES, "AI", False)
    assert support.detail(context["client"], opp_id)["evalId"] == context["eval_id"]
