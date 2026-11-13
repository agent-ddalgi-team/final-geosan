"""#268: 실제 임시 DB·실제 API로 비슷한 회사 참고 시나리오를 확인한다. 외부 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u7 import test_peers as support

dashboard_env = support.dashboard_env
scenarios("u7/peers.feature")

STAFF = {"X-Staff-Key": "park-lee"}


@given(
    "평가된 가상 회사 4곳 가운데 한 곳은 가격 이유로 거절, 한 곳은 메일로 연결되고 메모가 있다",
    target_fixture="context",
)
def lost_and_contacted(dashboard_env):
    client, (a, b, c, d) = dashboard_env
    support.record(client, b, {"status": "LOST", "lostReasonCode": "PRICE", "reason": "가상"})
    support.record(
        client,
        c,
        {
            "status": "IN_PROGRESS",
            "method": "EMAIL",
            "result": "REACHED",
            "attemptedAt": "2026-10-16",
        },
    )
    support.note(client, c, "나" * 150)
    return {"client": client, "self": a, "others": [b, c, d]}


@given(
    "평가된 가상 회사 4곳 가운데 한 곳에 전화 기록과 메모를 남겼다가 둘 다 잘못 입력으로 표시했다",
    target_fixture="context",
)
def cancelled_records(dashboard_env):
    client, (a, b, _c, _d) = dashboard_env
    support.record(
        client,
        b,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "attemptedAt": "2026-10-15",
        },
    )
    note_id = support.note(client, b, "잘못 적은 가상 메모")
    activity = client.get(f"/api/v1/opportunities/{b}/activity").json()["data"]
    outcome_id = next(x["recordId"] for x in activity if x["recordKind"] == "OUTCOME")
    for record_id in (note_id, outcome_id):
        url = f"/api/v1/opportunities/{b}/records/{record_id}/cancel"
        assert client.post(url, json={}, headers=STAFF).status_code == 200
    return {"client": client, "self": a, "cancelled": b}


@when("보기 전용 계정이 나머지 한 곳의 비슷한 회사 참고를 연다")
@when("보기 전용 계정이 다른 한 곳의 비슷한 회사 참고를 연다")
def open_peers(context):
    context["data"] = support.get_peers(context["client"], context["self"])


@then(
    "본인을 뺀 3곳이 단계가 앞선 순으로 보이고 거절 이유와 연결 건수가 요약되며 "
    "메모는 120자까지만 보인다"
)
def listed(context):
    data = context["data"]
    assert [row["oppId"] for row in data["companies"]] == context["others"]
    assert [row["outcomeStatus"] for row in data["companies"]] == ["LOST", "IN_PROGRESS", None]
    assert data["companies"][1]["lastNote"]["text"] == "나" * 120
    assert data["summary"]["topLostReasons"] == [{"code": "PRICE", "count": 1}]
    assert data["summary"]["contactReach"]["EMAIL"] == {"reached": 1, "tried": 1}


@then("그 회사는 기록이 없는 회사로 보이고 접촉 건수는 0이다")
def cancelled_hidden(context):
    data = context["data"]
    row = next(x for x in data["companies"] if x["oppId"] == context["cancelled"])
    assert row["outcomeStatus"] is None and row["lastNote"] is None
    assert row["lastContactAt"] is None
    assert data["summary"]["contactReach"]["CALL"] == {"reached": 0, "tried": 0}
