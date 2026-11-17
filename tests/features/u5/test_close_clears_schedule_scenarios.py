"""#719: 같은 저장으로 성사·거절이 되면 그 회사의 남은 다음 일정을 비운다(보류는 그대로).

실제 임시 DB·API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from datetime import timedelta

from pytest_bdd import given, parsers, scenarios, then, when

from geosan.workflows.flow_evaluate import today_in_seoul
from tests.unit.u1.test_sales_questions import contact
from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7.test_bookmark import MINE, URL

dashboard_env = dashboard.dashboard_env
scenarios("u5/close_clears_schedule.feature")

CLOSING = {
    "거절": {"status": "LOST", "lostReasonCode": "PRICE"},
    "성사": {"status": "WON"},
    "보류": {"status": "ON_HOLD"},
}


def save(context, **extra):
    response = context["client"].post(
        f"{URL}/{context['opp_id']}/outcomes", json=contact(**extra), headers=MINE
    )
    assert response.status_code == 200, response.text


def outcome(context):
    data = context["client"].get(f"{URL}/{context['opp_id']}").json()["data"]
    return data["records"]["outcome"]


@given(
    parsers.parse('평가된 가상 회사가 있고 통화와 함께 다음 일정 "{note}"을 잡아 두었다'),
    target_fixture="context",
)
def company_with_schedule(dashboard_env, note):
    client, opp_ids = dashboard_env
    context = {"client": client, "opp_id": opp_ids[0]}
    context["due"] = (today_in_seoul() + timedelta(days=3)).isoformat()
    save(context, nextScheduleAt=context["due"], nextScheduleNote=note)
    assert outcome(context)["nextScheduleAt"] == context["due"]
    schedule = client.get("/api/v1/dashboard", headers=MINE).json()["data"]["schedule"]
    assert [item["oppId"] for item in schedule] == [context["opp_id"]]
    return context


@when(parsers.parse('이어서 통화를 "{stage}"로 마무리해 저장한다'))
def close(context, stage):
    save(context, **CLOSING[stage])


@when(parsers.parse('이어서 통화를 "{stage}"로 마무리하며 새 일정 "{note}"를 함께 저장한다'))
def close_with_new_schedule(context, stage, note):
    context["due"] = (today_in_seoul() + timedelta(days=5)).isoformat()
    save(context, **CLOSING[stage], nextScheduleAt=context["due"], nextScheduleNote=note)


@then("상세의 다음 일정이 비어 있다")
def schedule_cleared(context):
    now = outcome(context)
    assert now["nextScheduleAt"] is None and now["nextScheduleNote"] is None


@then(parsers.parse('활동 이력의 "{label}" 줄에 옛 일정이 붙지 않는다'))
def activity_without_old_schedule(context, label):
    items = context["client"].get(f"{URL}/{context['opp_id']}/activity").json()["data"]
    closing = [item["summary"] for item in items if item["summary"].startswith(label)]
    assert len(closing) == 1
    assert "다음 일정" not in closing[0] and "다시 연락" not in closing[0]


@then("대시보드 일정에도 그 회사가 없다")
def not_on_dashboard(context):
    data = context["client"].get("/api/v1/dashboard", headers=MINE).json()["data"]
    assert data["schedule"] == []


@then(parsers.parse('상세의 다음 일정은 "{note}" 그대로다'))
def schedule_kept(context, note):
    now = outcome(context)
    assert (now["nextScheduleAt"], now["nextScheduleNote"]) == (context["due"], note)
