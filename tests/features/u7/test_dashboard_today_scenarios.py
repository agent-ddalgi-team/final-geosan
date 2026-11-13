"""#679: 실제 임시 DB·API로 대시보드 "오늘 확인할 것" 시나리오를 확인한다. 외부 AI 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u7 import test_dashboard_today as support
from tests.unit.u7.test_bookmark import set_bookmark
from tests.unit.u7.test_dashboard import record

today_env = support.today_env
scenarios("u7/dashboard_today.feature")


@given("가상 회사 네 곳 가운데 한 곳은 핵심 근거가 모자란다", target_fixture="env")
def companies(today_env):
    return today_env


@given("두 곳에 오늘 일정을, 한 곳에 지난 날짜 일정을 남겼다")
def schedules(env):
    client, ids = env
    support.add_schedules(client, ids)


@given("핵심 근거가 모자란 회사를 관심으로 켰다")
def bookmark_weak(env):
    client, ids = env
    assert set_bookmark(client, ids["weak"], True).status_code == 200


@given("평소 회사 한 곳에 다음 주 일정을 남겼다")
def next_week(env):
    client, ids = env
    record(client, ids["a"], {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-10"})


@when("대시보드를 연다", target_fixture="body")
def open_dashboard(env):
    client, _ = env
    return support.dashboard_data(client)


@then("오늘 일정 2건과 놓친 일정 1건, 확인할 것이 남은 관심 회사 1곳이 순서대로 보인다")
def rows_in_order(body):
    assert [(row["kind"], row["count"]) for row in body["todayChecks"]] == [
        ("SCHEDULE_TODAY", 2),
        ("SCHEDULE_OVERDUE", 1),
        ("CHECK_LEFT", 1),
    ]


@then("일정 줄에는 회사 이름과 날짜와 일정 한 줄만 실린다")
def schedule_items(env, body):
    _, ids = env
    today_row, overdue_row, _ = body["todayChecks"]
    assert today_row["listFilter"] is None and overdue_row["listFilter"] is None
    assert today_row["items"] == [
        {"oppId": ids["a"], "customerName": "A정밀", "dueAt": "2026-11-05", "note": "견적"},
        {"oppId": ids["b"], "customerName": "B금속(가상)", "dueAt": "2026-11-05", "note": "방문"},
    ]
    assert overdue_row["items"] == [
        {"oppId": ids["c"], "customerName": "C산업(가상)", "dueAt": "2026-11-01", "note": ""}
    ]


@then("확인할 것이 남은 관심 회사 줄을 누르면 그 회사만 걸러진 목록이 열린다")
def check_left_list(env, body):
    client, ids = env
    row = body["todayChecks"][2]
    assert row["listFilter"] == "CHECK_LEFT"
    assert row["items"] == [
        {"oppId": ids["weak"], "customerName": "D테크(가상)", "dueAt": None, "note": None}
    ]
    listed = client.get("/api/v1/opportunities", params={"filter": row["listFilter"]}).json()
    assert listed["meta"]["total"] == row["count"]
    assert [card["oppId"] for card in listed["data"]] == [ids["weak"]]


@then("오늘 확인할 것 줄이 하나도 없다")
def no_rows(body):
    assert body["todayChecks"] == []


@then("달력에 보일 일정은 그대로 1건이다")
def schedule_kept(body):
    assert len(body["schedule"]) == 1 and body["counts"]["SCHEDULE_DUE"] == 1


@given("필수조건이 아직 정해지지 않은 회사를 관심으로 켰다")
def bookmark_pending(env):
    client, ids = env
    assert set_bookmark(client, ids["stage"], True).status_code == 200


@when("핵심 근거가 모자란 회사의 영업을 보류로 저장한다")
def hold_weak(env):
    client, ids = env
    record(client, ids["weak"], {"status": "ON_HOLD"})


@then("확인할 것이 남은 관심 회사는 필수조건이 정해지지 않은 회사 1곳뿐이다")
def only_pending_left(env, body):
    _, ids = env
    rows = [row for row in body["todayChecks"] if row["kind"] == "CHECK_LEFT"]
    assert len(rows) == 1 and rows[0]["count"] == 1
    assert [item["oppId"] for item in rows[0]["items"]] == [ids["stage"]]


@then("그 줄의 건수와 눌러 연 목록의 건수가 같다")
def same_count_as_list(env, body):
    client, ids = env
    row = next(row for row in body["todayChecks"] if row["kind"] == "CHECK_LEFT")
    listed = client.get("/api/v1/opportunities", params={"filter": "CHECK_LEFT"}).json()
    assert listed["meta"]["total"] == row["count"]
    assert [card["oppId"] for card in listed["data"]] == [ids["stage"]]
