"""#268: 비슷한 회사 참고. 계산 부품은 값으로, 창구는 가상 입력·실제 SQLite·실제 API로 본다."""

from datetime import UTC, date, datetime

from geosan.dashboard.peers import ContactLine, PeerRecords, build_peers
from geosan.opportunity.models import Customer, Opportunity
from geosan.rules.codes import LostReasonCode
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard as dashboard

dashboard_env = dashboard.dashboard_env
record = dashboard.record
LOST_ORDER = [code.value for code in LostReasonCode]
VIEWER = {"X-Staff-Key": "viewer"}


def at(day: int) -> datetime:
    return datetime(2026, 11, day, 3, 0, tzinfo=UTC)


def peer(name, processes=(), industries=(), status=None, lost=None, last=None, contacts=()):
    return PeerRecords(
        opp_id=f"opp-{name}",
        name=name,
        process_codes=tuple(processes),
        industries=tuple(industries),
        outcome_status=status,
        lost_reason_code=lost,
        last_record_at=last,
        contacts=tuple(contacts),
        last_note=None,
    )


def call(reached, day):
    return ContactLine(
        method="CALL", reached=reached, attempted_at=date(2026, 11, day), created_at=at(day)
    )


def test_order_is_process_then_industry_then_stage_then_recent():
    """Given 같은 공정 4곳·산업군만 3곳 / When 고르기 / Then 공정 먼저, 단계·최근 순 5곳이다."""
    candidates = [
        peer("산업만-성사", industries=["반도체"], status="WON", last=at(9)),
        peer("공정만-미접촉", processes=["ZINC"]),
        peer("공정만-접촉-옛", processes=["ZINC"], status="IN_PROGRESS", last=at(2)),
        peer("공정만-접촉-새", processes=["ZINC"], status="IN_PROGRESS", last=at(8)),
        peer("둘다-미접촉", processes=["ZINC"], industries=["반도체"]),
        peer("산업만-접촉", industries=["반도체"], status="IN_PROGRESS", last=at(7)),
        peer("산업만-미접촉", industries=["반도체"]),
        peer("무관", processes=["ANODIZING"], industries=["조선"], status="WON", last=at(10)),
    ]
    result = build_peers(["ZINC"], ["반도체"], candidates, lost_reason_order=LOST_ORDER)
    assert [row.name for row in result.companies] == [
        "둘다-미접촉",
        "공정만-접촉-새",
        "공정만-접촉-옛",
        "공정만-미접촉",
        "산업만-성사",
    ]
    assert [(row.same_process, row.same_industry) for row in result.companies][:2] == [
        (True, True),
        (True, False),
    ]
    assert (result.summary.process_count, result.summary.industry_count) == (4, 4)
    assert result.summary.stage_counts == {"NOT_EXECUTED": 3, "IN_PROGRESS": 3, "WON": 1}


def test_summary_counts_lost_reasons_and_reach_over_all_peers():
    """Given 비슷한 회사 7곳의 거절·접촉 / When 요약 / Then 거절 상위 3개와 방법별 연결 수다."""
    candidates = [
        peer(f"거절-{index}", processes=["ZINC"], status="LOST", lost=code)
        for index, code in enumerate(["PRICE", "PRICE", "NO_DEMAND", "LEAD_TIME", "OTHER"])
    ] + [
        peer("전화", processes=["ZINC"], contacts=[call(False, 3), call(True, 5)]),
        # 지금 단계가 거절이 아니면 옛 거절 이유는 세지 않는다.
        peer("다시 접촉", processes=["ZINC"], status="IN_PROGRESS", lost="PRICE"),
    ]
    result = build_peers(["ZINC"], [], candidates, lost_reason_order=LOST_ORDER)
    assert result.summary.top_lost_reasons == (("PRICE", 2), ("LEAD_TIME", 1), ("NO_DEMAND", 1))
    assert result.summary.contact_reach == {"CALL": (1, 2), "EMAIL": (0, 0), "VISIT": (0, 0)}
    assert len(result.companies) == 5
    phone = build_peers(["ZINC"], [], candidates[5:6], lost_reason_order=LOST_ORDER).companies[0]
    assert phone.last_contact.attempted_at == date(2026, 11, 5)


def test_no_peers_gives_empty_list_and_zero_counts():
    """Given 겹치는 공정·산업군이 없는 회사뿐 / When 고르기 / Then 빈 목록과 0건이다."""
    result = build_peers(["ZINC"], ["반도체"], [peer("무관")], lost_reason_order=LOST_ORDER)
    assert result.companies == ()
    assert (result.summary.process_count, result.summary.industry_count) == (0, 0)
    assert result.summary.stage_counts == {} and result.summary.top_lost_reasons == ()


def get_peers(client, opp_id, headers=VIEWER):
    response = client.get(f"/api/v1/opportunities/{opp_id}/peers", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def note(client, opp_id, text, kind="MEMO"):
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/notes",
        json={"text": text, "kind": kind},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["noteId"]


def test_api_lists_other_companies_with_latest_values_for_viewer(dashboard_env):
    """Given 같은 공정 가상 회사 4곳과 기록 / When 보기 전용이 조회 / Then 본인 빼고 최신 값이다."""
    client, (a, b, c, d) = dashboard_env
    record(
        client,
        b,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "ABSENT",
            "attemptedAt": "2026-10-15",
        },
    )
    record(client, b, {"status": "LOST", "lostReasonCode": "PRICE", "reason": "가상 가격 조건"})
    record(
        client,
        c,
        {
            "status": "IN_PROGRESS",
            "method": "EMAIL",
            "result": "REACHED",
            "attemptedAt": "2026-10-16",
        },
    )
    note(client, c, "가" * 130)
    data = get_peers(client, a)
    assert [row["oppId"] for row in data["companies"]] == [b, c, d]
    lost, contacted, untouched = data["companies"]
    assert (lost["outcomeStatus"], lost["lostReasonCode"]) == ("LOST", "PRICE")
    assert lost["lastContactMethod"] == "CALL" and lost["lastContactAt"].startswith("2026-10-15")
    assert lost["lastNote"] is None and lost["sameProcess"] is True
    assert contacted["lastNote"]["text"] == "가" * 120 and contacted["lastNote"]["by"] == "park-lee"
    assert contacted["lastContactMethod"] == "EMAIL"
    assert untouched["outcomeStatus"] is None and untouched["lastContactAt"] is None
    summary = data["summary"]
    assert summary["processCount"] == 3
    assert summary["stageCounts"] == {"NOT_EXECUTED": 1, "IN_PROGRESS": 1, "LOST": 1}
    assert summary["topLostReasons"] == [{"code": "PRICE", "count": 1}]
    assert summary["contactReach"]["CALL"] == {"reached": 0, "tried": 1}
    assert summary["contactReach"]["EMAIL"] == {"reached": 1, "tried": 1}
    assert "가" * 121 not in client.get(f"/api/v1/opportunities/{a}/peers", headers=VIEWER).text
    assert client.get("/api/v1/opportunities/opp-none/peers", headers=VIEWER).status_code == 404


def test_api_excludes_cancelled_records_and_real_companies(dashboard_env):
    """Given 취소한 기록과 실제 회사 한 곳 / When 조회 / Then 취소 기록·실제 회사는 빠진다."""
    client, (a, b, c, d) = dashboard_env
    record(
        client,
        b,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "attemptedAt": "2026-10-15",
        },
    )
    note_id = note(client, b, "잘못 적은 가상 메모")
    activity = client.get(f"/api/v1/opportunities/{b}/activity").json()["data"]
    outcome_id = next(x["recordId"] for x in activity if x["recordKind"] == "OUTCOME")
    for record_id in (note_id, outcome_id):
        cancelled = client.post(
            f"/api/v1/opportunities/{b}/records/{record_id}/cancel",
            json={},
            headers={"X-Staff-Key": "park-lee"},
        )
        assert cancelled.status_code == 200, cancelled.text
    with session_scope() as session:
        opportunity = session.get(Opportunity, d)
        opportunity.is_virtual = False
        session.get(Customer, opportunity.customer_id).is_virtual = False
    data = get_peers(client, a)
    assert [row["oppId"] for row in data["companies"]] == [b, c]
    cancelled_company = data["companies"][0]
    assert cancelled_company["outcomeStatus"] is None and cancelled_company["lastNote"] is None
    assert cancelled_company["lastContactAt"] is None
    assert data["summary"]["contactReach"]["CALL"] == {"reached": 0, "tried": 0}
    assert data["summary"]["stageCounts"] == {"NOT_EXECUTED": 2}
