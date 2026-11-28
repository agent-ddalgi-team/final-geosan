"""#976: 실제 임시 DB·API로 영업 홈 "이번 주"와 관심 기업 줄 요약 시나리오를 확인한다.

외부 AI 호출 없음.
"""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u7 import test_dashboard_today as support
from tests.unit.u7 import test_week_entered as week

today_env = support.today_env
scenarios("u7/week_entered.feature")

MEMO = "가상 메모: 담당 과장과 통화"


@given("오늘이 목요일인 가상 회사 다섯 곳", target_fixture="env")
def companies(today_env):
    # today_env는 오늘을 2026-11-05(목)로 고정한다. 이번 주는 11-02(월)부터다.
    return today_env


@given("한 곳은 이번 주 화요일에 처음 접촉했다")
def first_contact_this_week(env):
    client, ids = env
    week.contact(client, ids["a"], "2026-11-03")


@given("한 곳은 지난달부터 접촉해 왔고 이번 주에도 접촉했다")
def long_running_contact(env):
    client, ids = env
    week.contact(client, ids["b"], "2026-10-20")
    week.contact(client, ids["b"], "2026-11-04")


@given("한 곳은 지난달부터 접촉해 오다 이번 주에 견적·샘플로 넘어갔다")
def moved_to_quote(env):
    client, ids = env
    week.contact(client, ids["c"], "2026-10-20")
    week.contact(client, ids["c"], "2026-11-04", status="SAMPLE_OR_REGISTRATION_APPROVED")


@given("한 곳에 메일 한 번과 전화 한 번을 남기고 다음 일정을 잡았다")
def contacts_with_schedule(env):
    client, ids = env
    week.contact(client, ids["a"], "2026-10-28", method="EMAIL")
    week.contact(
        client,
        ids["a"],
        "2026-11-03",
        memo=MEMO,
        nextScheduleAt="2026-11-10",
        nextScheduleNote="전화",
    )


@when("그 회사의 이번 주 기록을 잘못 입력으로 취소한다")
def cancel_this_week(env):
    client, ids = env
    week.cancel(client, ids["c"], "2026-11-04")


@when("영업 홈을 연다", target_fixture="body")
def open_home(env):
    client, _ = env
    return support.dashboard_data(client)


@when("목록에서 그 회사 줄을 본다", target_fixture="card")
def open_row(env):
    client, ids = env
    return week.card_of(client, ids["a"])


@then("접촉 칸에 이번 주 1곳, 견적·샘플 칸에 이번 주 1곳이다")
def one_each(body):
    assert body["enteredThisWeek"] == {**week.ZERO, "IN_CONTACT": 1, "QUOTE_SAMPLE": 1}


@then("접촉 칸의 숫자는 2곳 그대로다")
def band_count_kept(body):
    assert body["counts"]["IN_CONTACT"] == 2
    assert len(body["progressCompanies"]["IN_CONTACT"]) == 2


@then("미접촉 칸에는 이번 주 숫자를 주지 않는다")
def no_not_contacted(body):
    assert "NOT_CONTACTED" not in body["enteredThisWeek"]
    assert set(body["enteredThisWeek"]) == set(week.ENTERED_KEYS)


@then("어느 칸에도 이번 주에 들어온 회사가 없다")
def nothing_entered(body):
    assert body["enteredThisWeek"] == week.ZERO
    assert body["counts"]["IN_CONTACT"] == 1 and body["counts"]["QUOTE_SAMPLE"] == 0


@then("그 줄에 접촉 2회(전화 1 · 메일 1)와 마지막 접촉 날짜가 실린다")
def contact_summary(card):
    assert card["contactCount"] == 2
    assert card["contactByMethod"] == {"call": 1, "email": 1, "visit": 0}
    assert card["lastContactAt"] == "2026-11-03"


@then("그 줄에 다음 일정 날짜와 일정 한 줄이 실린다")
def next_schedule(card):
    assert card["records"]["outcome"] == {
        "status": "IN_PROGRESS",
        "nextScheduleAt": "2026-11-10",
        "nextScheduleNote": "전화",
    }


@then("그 값들은 그 회사 상세의 값과 같다")
def same_as_detail(env, card):
    client, ids = env
    records = client.get(f"/api/v1/opportunities/{ids['a']}").json()["data"]["records"]
    assert records["contactCount"] == {"total": card["contactCount"], **card["contactByMethod"]}
    assert records["lastContactAt"] == card["lastContactAt"]
    for key in ("nextScheduleAt", "nextScheduleNote"):
        assert records["outcome"][key] == card["records"]["outcome"][key]


@then("그 줄에 영업 메모 글은 없다")
def no_memo(card):
    assert MEMO not in str(card)
