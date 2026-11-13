"""#697: 접촉 기록을 남기면 같은 저장 안에서 검토 의견이 영업 대상으로 정해진다.

실제 임시 DB·API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import select

from geosan.records.models import ReviewOpinion
from geosan.storage.session import session_scope
from tests.unit.u1.test_sales_questions import contact
from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7.test_bookmark import MINE, URL, eval_ids, give_opinion, set_bookmark

dashboard_env = dashboard.dashboard_env
scenarios("u5/sales_target.feature")

# 화면에 보이는 말 → 저장 값(코드는 그대로다).
CODES = {"영업 대상": "WORTH_REVIEW", "검토 중": "NEED_CHECK", "제외": "NOT_TARGET"}
PROGRESS_KEYS = ("NOT_CONTACTED", "IN_CONTACT", "QUOTE_SAMPLE", "ON_HOLD", "DONE")


def opinion_rows(opp_id):
    with session_scope() as session:
        return [
            (row.opinion, row.staff_name, row.eval_id)
            for row in session.scalars(
                select(ReviewOpinion)
                .where(ReviewOpinion.opp_id == opp_id)
                .order_by(ReviewOpinion.version)
            )
        ]


def call(context, staff="kim-gwajang", **extra):
    client, opp_id = context["client"], context["opp_id"]
    body = contact(evalId=context["eval_id"], **extra)
    response = client.post(f"{URL}/{opp_id}/outcomes", json=body, headers={"X-Staff-Key": staff})
    assert response.status_code == 200, response.text
    return response.json()


def counts(context):
    return context["client"].get("/api/v1/dashboard", headers=MINE).json()["data"]["counts"]


def detail(context):
    client, opp_id = context["client"], context["opp_id"]
    return client.get(f"{URL}/{opp_id}").json()["data"]["records"]


@given("평가된 가상 회사 4곳이 있고 기록은 없다", target_fixture="context")
def companies(dashboard_env):
    client, opp_ids = dashboard_env
    return {"client": client, "opp_id": opp_ids[0], "eval_id": eval_ids(client)[opp_ids[0]]}


@given(parsers.parse('첫 회사의 검토 의견이 "{label}"이다'))
def opinion_given(context, label):
    give_opinion(context["client"], context["opp_id"], CODES[label])


@when("첫 회사에 본 평가 번호와 함께 통화를 남긴다")
def one_call(context):
    context["saved"] = call(context)


@when("첫 회사에 본 평가 번호와 함께 통화를 두 번 남긴다")
def two_calls(context):
    call(context)
    call(context)


@when("첫 회사에 영업 대상으로 되돌리기를 확인하고 통화를 남긴다")
def call_with_restore(context):
    context["saved"] = call(context, restoreExcluded=True)


@when("첫 회사를 관심으로만 켠다")
def bookmark_only(context):
    assert set_bookmark(context["client"], context["opp_id"], True).status_code == 200


@then('첫 회사의 검토 의견은 접촉한 담당자 이름으로 "영업 대상" 한 행이다')
def one_target_row(context):
    assert opinion_rows(context["opp_id"]) == [("WORTH_REVIEW", "kim-gwajang", context["eval_id"])]
    assert detail(context)["opinion"]["opinion"] == "WORTH_REVIEW"


@then("대시보드 영업 진행의 접촉 중에 1곳이 보인다")
def in_contact(context):
    now = counts(context)
    assert now["IN_CONTACT"] == 1 and now["BOOKMARKED"] == 1
    assert now["NO_OPINION"] == 0 and now["NEED_CHECK"] == 0


@then("활동 이력에 검토 의견 한 줄이 생긴다")
def activity_line(context):
    client, opp_id = context["client"], context["opp_id"]
    items = client.get(f"{URL}/{opp_id}/activity").json()["data"]
    opinions = [item for item in items if item["kind"] == "OPINION"]
    assert [(item["summary"], item["actor"]) for item in opinions] == [
        ("WORTH_REVIEW", "kim-gwajang")
    ]


@then('첫 회사의 검토 의견 이력은 "검토 중" 다음 "영업 대상"이다')
def need_check_then_target(context):
    assert [row[0] for row in opinion_rows(context["opp_id"])] == ["NEED_CHECK", "WORTH_REVIEW"]


@then("첫 회사의 검토 의견 행은 그대로 1개다")
def still_one_row(context):
    assert [row[0] for row in opinion_rows(context["opp_id"])] == ["WORTH_REVIEW"]


@then('접촉은 저장되고 첫 회사의 최신 의견은 "제외"이며 관심은 꺼진 채다')
def excluded_kept(context):
    assert context["saved"]["data"]["status"] == "IN_PROGRESS"
    assert [row[0] for row in opinion_rows(context["opp_id"])] == ["NOT_TARGET"]
    # 관심을 켠 적이 없는 회사라 관심 행 자체가 없다(꺼진 것과 같다).
    assert not (detail(context)["bookmark"] or {}).get("active")
    assert counts(context) == dashboard.ZERO_COUNTS


@then('첫 회사의 최신 의견은 "영업 대상"이고 관심이 다시 켜진다')
def restored(context):
    assert [row[0] for row in opinion_rows(context["opp_id"])] == ["NOT_TARGET", "WORTH_REVIEW"]
    assert detail(context)["bookmark"]["active"] is True


@then("관심 기업 1곳과 의견 전 1곳으로 세고 영업 진행 다섯 칸은 모두 0이다")
def bookmark_only_counts(context):
    now = counts(context)
    assert now == {**dashboard.ZERO_COUNTS, "BOOKMARKED": 1, "NO_OPINION": 1}
    assert all(now[key] == 0 for key in PROGRESS_KEYS)
    assert opinion_rows(context["opp_id"]) == []
