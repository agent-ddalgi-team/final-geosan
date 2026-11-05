"""#216: 대시보드 건수·이번 주 일정·최근 내 기록을 실제 기록 표(SQLite)에서 집계한다.

현재 시각에 기대지 않도록 집계 함수에는 오늘(2026-11-05)과 지금을 직접 넣는다(NFR12).
기록은 실제 API로 저장하므로 저장 시각만 실제 시각이다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.dashboard.queries import RECENT_ACTIVITY_LIMIT, build_dashboard
from geosan.evidence.transfer import KST
from geosan.opportunity.importer import import_case
from geosan.records.models import Note
from geosan.storage.base import new_id
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

TODAY = date(2026, 11, 5)
NOW = datetime(2026, 11, 5, 9, 0, tzinfo=KST)
STAGES = {
    "NOT_CONTACTED": "NOT_EXECUTED",
    "INTERESTED": "INTERESTED",
    "IN_CONTACT": "IN_PROGRESS",
    "QUOTE_SAMPLE": "SAMPLE_OR_REGISTRATION_APPROVED",
}


@pytest.fixture
def dashboard_env(tmp_db, tmp_path):
    """가상 회사 4곳을 투입·평가한 상태. 기록은 아직 하나도 없다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_ids = [import_case(_write(tmp_path, "a.json", factories.apjeong_case())).opp_id]
    for index, name in enumerate(["B금속(가상)", "C산업(가상)", "D테크(가상)"], start=2):
        case = factories.apjeong_renamed_customer(f"case-dashboard-{index}", name)
        opp_ids.append(import_case(_write(tmp_path, f"case-{index}.json", case)).opp_id)
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, opp_ids


def record(client, opp_id, body, staff="park-lee"):
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/outcomes", json=body, headers={"X-Staff-Key": staff}
    )
    assert response.status_code == 200, response.text
    return response


def build(staff_key="park-lee"):
    with session_scope() as session:
        return build_dashboard(
            session,
            dataset_kind="VIRTUAL_REVIEWED",
            staff_key=staff_key,
            today=TODAY,
            now=NOW,
        ).data


def counts_of(data):
    counts = data.counts
    return {
        "NOT_CONTACTED": counts.not_contacted,
        "INTERESTED": counts.interested,
        "IN_CONTACT": counts.in_contact,
        "QUOTE_SAMPLE": counts.quote_sample,
        "SCHEDULE_DUE": counts.schedule_due,
    }


def test_empty_database_shows_zero_counts_and_hides_breakdown(tmp_db):
    """Given 평가한 회사 없음 / When 조회 / Then 건수 0, 일정·기록 없음, 막대 줄 숨김(null)."""
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/dashboard", headers={"X-Staff-Key": "park-lee"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["counts"] == {
        "NOT_CONTACTED": 0,
        "INTERESTED": 0,
        "IN_CONTACT": 0,
        "QUOTE_SAMPLE": 0,
        "SCHEDULE_DUE": 0,
    }
    assert data["schedule"] == [] and data["recentActivity"] == []
    assert data["breakdown"] is None


def test_counts_follow_latest_stage_and_match_list_filter(dashboard_env):
    """Given 회사 4곳의 단계가 다름 / When 조회 / Then 최신 단계로 세고 목록 ?stage= 건수와 같다."""
    client, (a, b, c, _d) = dashboard_env
    record(client, a, {"status": "INTERESTED"})
    record(client, b, {"status": "INTERESTED"})
    record(client, b, {"status": "IN_PROGRESS"})  # 최신 단계만 센다: 관심에서 빠진다
    record(client, c, {"status": "SAMPLE_OR_REGISTRATION_APPROVED"})
    counts = counts_of(build())
    assert counts == {
        "NOT_CONTACTED": 1,
        "INTERESTED": 1,
        "IN_CONTACT": 1,
        "QUOTE_SAMPLE": 1,
        "SCHEDULE_DUE": 0,
    }
    # 건수를 눌렀을 때 열리는 목록과 같은 기준이다(이슈 #216 할 일 2).
    for key, stage in STAGES.items():
        listed = client.get("/api/v1/opportunities", params={"stage": stage}).json()["meta"]
        assert listed["total"] == counts[key], key


def test_not_executed_record_counts_as_not_contacted(dashboard_env):
    """Given 단계를 미접촉으로 되돌림 / When 조회 / Then 기록이 없는 회사와 함께 미접촉이다."""
    client, (a, *_rest) = dashboard_env
    record(client, a, {"status": "INTERESTED"})
    record(client, a, {"status": "NOT_EXECUTED"})
    counts = counts_of(build())
    assert counts["NOT_CONTACTED"] == 4 and counts["INTERESTED"] == 0


def test_schedule_window_orders_overdue_first_and_skips_closed(dashboard_env):
    """Given 기한 지남·7일 안·8일 뒤·끝난 영업의 일정 / When 조회 / Then 7일 안만, 지남이 맨 위."""
    client, (a, b, c, d) = dashboard_env
    record(
        client,
        a,
        {"status": "INTERESTED", "nextScheduleAt": "2026-11-12", "nextScheduleNote": "방문"},
    )
    record(
        client,
        b,
        {
            "status": "IN_PROGRESS",
            "nextScheduleAt": "2026-11-01",
            "nextScheduleNote": "견적 보내기",
        },
        staff="kim-gwajang",
    )
    record(client, c, {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-13"})  # 8일 뒤
    record(client, d, {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-06"})
    record(client, d, {"status": "LOST", "reason": "가상 거절 사유"})  # 끝난 영업의 남은 일정
    data = build()
    assert [(row.due_at, row.overdue) for row in data.schedule] == [
        (date(2026, 11, 1), True),
        (date(2026, 11, 12), False),
    ]
    first, second = data.schedule
    assert (first.opp_id, first.note, first.staff_key) == (b, "견적 보내기", "kim-gwajang")
    assert (second.opp_id, second.note, second.staff_key) == (a, "방문", "park-lee")
    assert first.opp_title and second.opp_title
    assert counts_of(data)["SCHEDULE_DUE"] == 2


def test_schedule_list_filter_matches_dashboard_count(dashboard_env, monkeypatch):
    """Given 7일 안·기한 지남·8일 뒤·끝난 영업 / When 건수와 일정 목록 / Then 같다."""
    monkeypatch.setattr("geosan.api.routes.dashboard.utcnow", lambda: NOW)
    client, (a, b, c, d) = dashboard_env
    record(client, a, {"status": "INTERESTED", "nextScheduleAt": "2026-11-12"})
    record(client, b, {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-01"})
    record(client, c, {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-13"})
    record(client, d, {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-06"})
    record(client, d, {"status": "LOST", "reason": "가상 거절 사유"})
    dashboard = client.get("/api/v1/dashboard").json()["data"]
    listed = client.get("/api/v1/opportunities", params={"filter": "SCHEDULE_DUE"})
    assert listed.status_code == 200
    assert listed.json()["meta"]["total"] == dashboard["counts"]["SCHEDULE_DUE"] == 2
    assert {row["oppId"] for row in listed.json()["data"]} == {a, b}
    assert {row["oppId"] for row in listed.json()["data"]} == {
        row["oppId"] for row in dashboard["schedule"]
    }
    # 단계와 함께 걸어도 같은 기준이다.
    both = client.get(
        "/api/v1/opportunities", params={"filter": "SCHEDULE_DUE", "stage": "IN_PROGRESS"}
    )
    assert [row["oppId"] for row in both.json()["data"]] == [b]


def test_list_still_rejects_unconnected_filters_and_plain_list_is_unchanged(dashboard_env):
    """Given 거르기 등록 / When 연결 안 된 값 요청 / Then 이전처럼 입력 오류, 일반 목록은 그대로."""
    client, _ids = dashboard_env
    url = "/api/v1/opportunities"
    assert client.get(url).json()["meta"]["total"] == 4
    for params in ({"filter": "OTHER"}, {"filter": ""}, {"tab": "later"}, {"bookmarked": "true"}):
        response = client.get(url, params=params)
        assert response.status_code == 400, params
        assert "아직 연결되지 않았습니다" in response.text
    empty = client.get(url, params={"filter": "SCHEDULE_DUE"})
    assert empty.status_code == 200 and empty.json()["meta"]["total"] == 0


def test_stage_only_save_keeps_earlier_schedule_in_dashboard(dashboard_env):
    """Given 일정을 잡은 뒤 단계만 바꿈 / When 조회 / Then 앞서 잡은 일정이 계속 보인다."""
    client, (a, *_rest) = dashboard_env
    record(client, a, {"status": "INTERESTED", "nextScheduleAt": "2026-11-08"})
    record(client, a, {"status": "IN_PROGRESS"})
    data = build()
    assert [(row.opp_id, row.due_at) for row in data.schedule] == [(a, date(2026, 11, 8))]


def test_recent_activity_shows_only_my_records_newest_first(dashboard_env):
    """Given 메모·단계·접촉·일정·의견 기록 / When 조회 / Then 내 기록만 종류별 한 줄, 최신순."""
    client, (a, b, *_rest) = dashboard_env
    mine = {"X-Staff-Key": "park-lee"}
    eval_id = next(
        row["evalId"]
        for row in client.get("/api/v1/opportunities").json()["data"]
        if row["oppId"] == a
    )
    client.post(f"/api/v1/opportunities/{a}/notes", json={"text": "도금 두께 문의"}, headers=mine)
    record(client, a, {"status": "INTERESTED"})
    record(client, a, {"status": "IN_PROGRESS"})
    record(
        client,
        a,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "ABSENT",
            "attemptedAt": "2026-11-04",
        },
    )
    record(
        client,
        a,
        {"status": "IN_PROGRESS", "nextScheduleAt": "2026-11-12", "nextScheduleNote": "방문"},
    )
    client.post(
        f"/api/v1/opportunities/{a}/opinions",
        json={"evalId": eval_id, "opinion": "WORTH_REVIEW"},
        headers=mine,
    )
    # 다른 담당자의 기록은 내 목록에 나오지 않는다.
    record(client, b, {"status": "INTERESTED"}, staff="kim-gwajang")
    client.post(
        f"/api/v1/opportunities/{b}/notes",
        json={"text": "남의 메모"},
        headers={"X-Staff-Key": "kim-gwajang"},
    )
    rows = build().recent_activity
    assert [(row.kind, row.summary) for row in rows] == [
        ("OPINION", "검토 의견: 검토 권고"),
        ("SCHEDULE", "다음 일정: 11/12 방문"),
        ("CONTACT_ATTEMPT", "전화 시도, 부재"),
        ("STAGE", "관심 → 접촉"),
        ("STAGE", "관심"),
        ("NOTE", "메모를 남김"),
    ]
    assert all(row.opp_id == a and row.customer_name for row in rows)
    assert [row.at for row in rows] == sorted((row.at for row in rows), reverse=True)


def test_recent_activity_is_capped_and_empty_without_staff(dashboard_env):
    """Given 메모가 12개 / When 조회 / Then 10건만, 담당자 키가 없으면(보기 전용) 비어 있다."""
    client, (a, *_rest) = dashboard_env
    for number in range(12):
        client.post(
            f"/api/v1/opportunities/{a}/notes",
            json={"text": f"가상 메모 {number}"},
            headers={"X-Staff-Key": "park-lee"},
        )
    rows = build().recent_activity
    assert len(rows) == RECENT_ACTIVITY_LIMIT
    assert rows[0].summary == "메모를 남김"
    assert build(staff_key=None).recent_activity == []


def test_internal_note_reply_and_research_text_never_reach_dashboard(dashboard_env):
    """Given 메모·자료 조사·질문 답 / When GET /dashboard / Then 종류만 보이고 본문은 없다."""
    client, (a, *_rest) = dashboard_env
    mine = {"X-Staff-Key": "park-lee"}
    secret_memo, secret_research, secret_reply = "비밀메모ZZ1", "비밀조사ZZ2", "비밀답ZZ3"
    client.post(f"/api/v1/opportunities/{a}/notes", json={"text": secret_memo}, headers=mine)
    client.post(
        f"/api/v1/opportunities/{a}/notes",
        json={"text": secret_research, "kind": "RESEARCH"},
        headers=mine,
    )
    with session_scope() as session:
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=a,
                staff_key="park-lee",
                text=f"Q: 가상 질문 답: {secret_reply}",
                kind="REPLY",
                version=3,
            )
        )
    response = client.get("/api/v1/dashboard", headers=mine)
    assert response.status_code == 200
    for secret in (secret_memo, secret_research, secret_reply):
        assert secret not in response.text
    summaries = {row["summary"] for row in response.json()["data"]["recentActivity"]}
    assert summaries == {"메모를 남김", "자료 조사를 기록함", "질문 답을 기록함"}
    assert {row["kind"] for row in response.json()["data"]["recentActivity"]} == {"NOTE"}


def test_api_returns_contract_shape_for_staff_and_viewer(dashboard_env):
    """Given 기록 1건 / When GET /dashboard / Then 계약 모양(대문자 건수 키·breakdown null)."""
    client, (a, *_rest) = dashboard_env
    record(
        client, a, {"status": "INTERESTED", "nextScheduleAt": "2000-01-01", "nextScheduleNote": "x"}
    )
    staff = client.get("/api/v1/dashboard", headers={"X-Staff-Key": "park-lee"})
    assert staff.status_code == 200
    body = staff.json()
    assert set(body["data"]) == {"counts", "schedule", "recentActivity", "asOf", "breakdown"}
    assert set(body["data"]["counts"]) == {
        "NOT_CONTACTED",
        "INTERESTED",
        "IN_CONTACT",
        "QUOTE_SAMPLE",
        "SCHEDULE_DUE",
    }
    assert body["data"]["breakdown"] is None
    assert set(body["data"]["schedule"][0]) == {
        "oppId",
        "customerName",
        "oppTitle",
        "dueAt",
        "note",
        "overdue",
        "staffKey",
    }
    assert body["data"]["schedule"][0]["overdue"] is True  # 2000년 일정은 언제나 기한 지남
    assert body["meta"]["hasVirtualData"] is True
    assert body["meta"]["datasetKind"] == "VIRTUAL_REVIEWED"
    assert len(body["data"]["recentActivity"]) == 1
    viewer = client.get("/api/v1/dashboard", headers={"X-Staff-Key": "viewer"})
    assert viewer.status_code == 200 and viewer.json()["data"]["recentActivity"] == []
    anonymous = client.get("/api/v1/dashboard")
    assert anonymous.status_code == 200 and anonymous.json()["data"]["recentActivity"] == []
    assert datetime.fromisoformat(body["data"]["asOf"]).tzinfo is not None
