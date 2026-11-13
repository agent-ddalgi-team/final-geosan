"""#679 대시보드 맨 위 "오늘 확인할 것": 오늘 일정 · 놓친 일정 · 확인할 것이 남은 관심 회사.

실제 SQLite·평가·API로 확인한다. 오늘은 2026-11-05로 고정한다(NFR12). 가상 사례만 쓴다.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.api.routes import dashboard as dashboard_route
from geosan.capability.importer import import_capability
from geosan.dashboard.queries import build_dashboard
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import OppProcessLink
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u7.test_bookmark import MINE, set_bookmark, write_note
from tests.unit.u7.test_dashboard import NOW, TODAY, record


def _weak_case():
    """핵심 항목(제품·부품 생산 근거)이 약한 추정뿐이라 카드에 "근거 부족"이 보이는 회사."""
    data = factories.apjeong_renamed_customer("case-today-weak", "D테크(가상)")
    item = next(row for row in data["itemInputs"] if row["itemCode"] == "NEW_PRODUCT")
    item["state"] = item["certainty"] = "WEAK"
    return data


@pytest.fixture
def today_env(tmp_db, tmp_path, monkeypatch):
    """가상 회사 4곳: 평소 3곳(a·b·c)과 핵심 근거가 모자란 1곳(weak). 기록은 아직 없다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    cases = {
        "a": factories.apjeong_case(),
        "b": factories.apjeong_renamed_customer("case-today-b", "B금속(가상)"),
        "c": factories.apjeong_renamed_customer("case-today-c", "C산업(가상)"),
        "weak": _weak_case(),
    }
    ids = {
        name: import_case(_write(tmp_path, f"case-{name}.json", data)).opp_id
        for name, data in cases.items()
    }
    assert run_evaluation().ok
    monkeypatch.setattr(dashboard_route, "utcnow", lambda: NOW)
    with TestClient(create_app()) as client:
        yield client, ids


def dashboard_data(client):
    response = client.get("/api/v1/dashboard", headers=MINE)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def add_schedules(client, ids):
    """a·b는 오늘, c는 나흘 전 일정. 기록을 남기면 그 회사는 관심 기업이 된다."""
    record(
        client,
        ids["a"],
        {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-05", "nextScheduleNote": "견적"},
    )
    record(
        client,
        ids["b"],
        {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-05", "nextScheduleNote": "방문"},
    )
    record(client, ids["c"], {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-01"})


def rows_of(data):
    return {row["kind"]: row for row in data["todayChecks"]}


def listed(client, **params):
    body = client.get("/api/v1/opportunities", params=params).json()
    return [card["oppId"] for card in body["data"]]


def test_empty_database_has_no_today_rows_and_list_filter_is_connected(tmp_db):
    """Given 평가한 회사 없음 / When 대시보드·목록 / Then 줄이 없고 새 거르기 값은 빈 목록(200)."""
    with TestClient(create_app()) as client:
        assert dashboard_data(client)["todayChecks"] == []
        response = client.get("/api/v1/opportunities", params={"filter": "CHECK_LEFT"})
        assert response.status_code == 200 and response.json()["data"] == []


def test_today_and_overdue_rows_come_from_the_calendar_schedule(today_env):
    """Given 오늘 2건·지난 1건·다음 주 1건 / When 대시보드 / Then 달력 일정에서 고른 줄과 같다."""
    client, ids = today_env
    add_schedules(client, ids)
    record(client, ids["weak"], {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-10"})
    data = dashboard_data(client)
    rows = rows_of(data)
    schedule = data["schedule"]
    assert len(schedule) == 4
    assert [item["oppId"] for item in rows["SCHEDULE_TODAY"]["items"]] == [
        item["oppId"] for item in schedule if item["dueAt"] == "2026-11-05"
    ]
    assert [item["oppId"] for item in rows["SCHEDULE_OVERDUE"]["items"]] == [
        item["oppId"] for item in schedule if item["overdue"]
    ]
    assert rows["SCHEDULE_TODAY"]["count"] == 2 and rows["SCHEDULE_OVERDUE"]["count"] == 1


def test_closed_deal_schedule_is_not_a_today_row(today_env):
    """Given 오늘 일정이 남은 채 성사로 끝난 영업 / When 대시보드 / Then 달력처럼 뺀다."""
    client, ids = today_env
    record(client, ids["a"], {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-05"})
    assert "SCHEDULE_TODAY" in rows_of(dashboard_data(client))
    record(client, ids["a"], {"status": "WON", "nextScheduleAt": "2026-11-05"})
    data = dashboard_data(client)
    assert data["schedule"] == [] and data["todayChecks"] == []


def test_check_left_counts_only_bookmarked_companies(today_env):
    """Given 근거가 모자란 회사가 관심이 아님 / When 관심으로 켬 / Then 그때부터 줄에 센다."""
    client, ids = today_env
    assert set_bookmark(client, ids["a"], True).status_code == 200  # 평소 회사는 세지 않는다
    assert dashboard_data(client)["todayChecks"] == []
    assert listed(client, filter="CHECK_LEFT") == []
    assert set_bookmark(client, ids["weak"], True).status_code == 200
    row = rows_of(dashboard_data(client))["CHECK_LEFT"]
    assert (row["count"], row["listFilter"]) == (1, "CHECK_LEFT")
    assert [item["oppId"] for item in row["items"]] == [ids["weak"]]
    assert listed(client, filter="CHECK_LEFT") == [ids["weak"]]


def test_check_left_matches_the_card_for_proposed_only_process(today_env):
    """Given 확정 공정 없이 AI 제안만 있는 관심 회사 / When 대시보드 / Then 카드 기준과 같다."""
    client, ids = today_env
    for name in ("a", "b"):
        assert set_bookmark(client, ids[name], True).status_code == 200
    with session_scope() as session:
        for row in session.scalars(select(OppProcessLink).where(OppProcessLink.opp_id == ids["b"])):
            row.superseded_at = utcnow()
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=ids["b"],
                process_code="ZINC_PLATING",
                source="AI",
                state="PENDING",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
                created_by="system",
            )
        )
    row = rows_of(dashboard_data(client))["CHECK_LEFT"]
    assert [item["oppId"] for item in row["items"]] == [ids["b"]]
    # 카드가 "확인할 것"을 보이는 조건과 같다: 확정 공정 없음 + AI 제안 있음.
    cards = {
        card["oppId"]: card
        for card in client.get("/api/v1/opportunities", params={"filter": "CHECK_LEFT"}).json()[
            "data"
        ]
    }
    assert list(cards) == [ids["b"]]
    assert cards[ids["b"]]["confirmedProcessCodes"] == []
    assert cards[ids["b"]]["proposedProcessCount"] == 1


def test_check_left_counts_not_evaluated_company(today_env):
    """Given 분류가 "평가 전"인 관심 회사 / When 대시보드 / Then 카드처럼 줄에 센다."""
    client, ids = today_env
    assert set_bookmark(client, ids["c"], True).status_code == 200
    with session_scope() as session:
        latest_confirmed_evaluation(session, ids["c"]).classification_code = "NOT_EVALUATED"
    row = rows_of(dashboard_data(client))["CHECK_LEFT"]
    assert [item["customerName"] for item in row["items"]] == ["C산업(가상)"]


def test_today_rows_never_carry_memo_text(today_env):
    """Given 메모를 남긴 관심 회사 / When 대시보드 / Then 줄에는 이름·날짜·일정 한 줄·건수만."""
    client, ids = today_env
    add_schedules(client, ids)
    write_note(client, ids["weak"], text="줄에 실리면 안 되는 가상 메모")
    data = dashboard_data(client)
    assert "줄에 실리면 안 되는 가상 메모" not in str(data["todayChecks"])
    for row in data["todayChecks"]:
        assert set(row) == {"kind", "count", "items", "listFilter"}
        for item in row["items"]:
            assert set(item) == {"oppId", "customerName", "dueAt", "note"}


def test_dashboard_part_builds_schedule_rows_without_check_left(today_env):
    """Given 창구가 확인할 것 회사를 안 넘김 / When 집계 / Then 일정 줄만 만든다(지어내지 않음)."""
    client, ids = today_env
    add_schedules(client, ids)
    assert set_bookmark(client, ids["weak"], True).status_code == 200
    with session_scope() as session:
        data = build_dashboard(
            session, dataset_kind="VIRTUAL_REVIEWED", staff_key=None, today=TODAY, now=NOW
        ).data
    assert [(row.kind, row.count) for row in data.today_checks] == [
        ("SCHEDULE_TODAY", 2),
        ("SCHEDULE_OVERDUE", 1),
    ]
