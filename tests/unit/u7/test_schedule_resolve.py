"""#766 대시보드 "지난 일정 — 했나요?": [완료]·[필요 없어요]·[날짜 바꾸기] (PM 결정 2026-11-16).

실제 임시 DB·API로 본다. 단계·이유는 그대로 두고 일정만 바꾼 새 기록 한 행과 변경 기록 한 줄이
남고, 대시보드 "놓친 일정"에서 빠지는지 확인한다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import select

from geosan.dashboard.queries import TODAY_SCHEDULE_OVERDUE, build_dashboard
from geosan.evidence.transfer import KST
from geosan.records.models import Note, Outcome
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import today_in_seoul
from tests.unit.u1.test_past_schedule import _with_past_schedule
from tests.unit.u7 import test_dashboard as dashboard

dashboard_env = dashboard.dashboard_env
MINE = {"X-Staff-Key": "park-lee"}
_WEEKDAYS = "월화수목금토일"


def _label(day):
    return f"{day.month}/{day.day}({_WEEKDAYS[day.weekday()]})"


def _latest(opp_id):
    with session_scope() as session:
        row = session.scalars(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
        ).first()
        return row.version, row.status, row.next_schedule_at, row.next_schedule_note, row.method


def _change_lines(opp_id):
    with session_scope() as session:
        return [
            row.text
            for row in session.scalars(
                select(Note)
                .where(Note.opp_id == opp_id, Note.kind == "CHANGE")
                .order_by(Note.version)
            )
        ]


def _overdue_ids():
    today = today_in_seoul()
    with session_scope() as session:
        result = build_dashboard(
            session,
            dataset_kind="VIRTUAL_REVIEWED",
            staff_key="park-lee",
            today=today,
            now=datetime.combine(today, time(9), tzinfo=KST),
        )
    rows = [row for row in result.data.today_checks if row.kind == TODAY_SCHEDULE_OVERDUE]
    return {item.opp_id for row in rows for item in row.items}


def resolve(client, opp_id, action, version, day=None, headers=MINE):
    body = {"action": action, "expectedVersion": version}
    if day is not None:
        body["nextScheduleAt"] = day.isoformat()
    return client.post(
        f"/api/v1/opportunities/{opp_id}/schedule/resolve", json=body, headers=headers
    )


@pytest.mark.parametrize(
    "action,word",
    [("DONE", "완료로 정리"), ("DROPPED", "필요 없어 지움")],
)
def test_done_or_dropped_clears_the_past_schedule_and_leaves_one_change_line(
    dashboard_env, action, word
):
    """Given 이틀 전 "다시 연락" 일정이 지난 회사(놓친 일정) / When [완료]·[필요 없어요]
    / Then 단계는 그대로·접촉 없이 일정만 비운 새 기록, 변경 기록 "11/14(금) 일정(다시 연락) — …",
    놓친 일정에서 빠진다."""
    client, opp_id, past = _with_past_schedule(dashboard_env)
    assert opp_id in _overdue_ids()
    version, status, *_ = _latest(opp_id)
    response = resolve(client, opp_id, action, version)
    assert response.status_code == 200, response.text
    new_version, new_status, due, note, method = _latest(opp_id)
    assert (new_version, new_status, due, note, method) == (version + 1, status, None, None, None)
    day = today_in_seoul() - timedelta(days=2)
    assert _change_lines(opp_id)[-1] == f"{_label(day)} 일정(다시 연락) — {word}"
    assert opp_id not in _overdue_ids()


def test_moved_keeps_the_note_and_sets_the_new_date(dashboard_env):
    """Given 지난 일정 / When [날짜 바꾸기]로 사흘 뒤
    / Then 새 날짜·같은 내용, 변경 기록 "… — 날짜로 옮김"."""
    client, opp_id, _ = _with_past_schedule(dashboard_env)
    version, status, *_ = _latest(opp_id)
    later = today_in_seoul() + timedelta(days=3)
    response = resolve(client, opp_id, "MOVED", version, later)
    assert response.status_code == 200, response.text
    assert _latest(opp_id)[1:4] == (status, later, "다시 연락")
    assert _change_lines(opp_id)[-1].endswith(f"— {_label(later)}로 옮김")
    assert opp_id not in _overdue_ids()


def test_bad_requests_are_refused_and_nothing_is_saved(dashboard_env):
    """Given 지난 일정 / When 옛 버전·날짜 없는 옮기기·지난 날짜·완료에 날짜·담당자 없음
    / Then 409·400·400·400·403이고 기록이 늘지 않는다. 일정이 없는 회사는 400."""
    client, opp_id, _ = _with_past_schedule(dashboard_env)
    version = _latest(opp_id)[0]
    yesterday = today_in_seoul() - timedelta(days=1)
    assert resolve(client, opp_id, "DONE", version - 1).status_code == 409
    assert resolve(client, opp_id, "MOVED", version).status_code == 400
    assert resolve(client, opp_id, "MOVED", version, yesterday).status_code == 400
    assert resolve(client, opp_id, "DONE", version, today_in_seoul()).status_code == 400
    assert resolve(client, opp_id, "DONE", version, headers={}).status_code == 403
    assert _latest(opp_id)[0] == version
    assert _change_lines(opp_id) == []
    _, opp_ids = dashboard_env
    assert resolve(client, opp_ids[1], "DONE", 0).status_code == 400


def test_won_count_and_filter_match(dashboard_env):
    """Given 관심 기업 둘 중 하나가 성사 / When 대시보드·목록 `?filter=WON`
    / Then WON 1, DONE에도 1, 목록 1곳."""
    client, opp_ids = dashboard_env
    dashboard.record(client, opp_ids[0], {"status": "WON"})
    dashboard.record(client, opp_ids[1], {"status": "IN_PROGRESS"})
    counts = client.get("/api/v1/dashboard").json()["data"]["counts"]
    assert (counts["WON"], counts["DONE"]) == (1, 1)
    listed = client.get("/api/v1/opportunities", params={"filter": "WON"}).json()["data"]
    assert [card["oppId"] for card in listed] == [opp_ids[0]]


def test_lost_company_keeps_its_reason_when_the_schedule_is_cleared(dashboard_env):
    """Given 거절(가격)로 끝난 뒤 일부러 잡아 둔 일정이 지남 / When [완료]
    / Then 거절·이유 코드·설명은 그대로이고 일정만 비워진다."""
    client, opp_ids = dashboard_env
    opp_id = opp_ids[2]
    dashboard.record(
        client, opp_id, {"status": "LOST", "lostReasonCode": "PRICE", "reason": "가상 가격 이유"}
    )
    later = (today_in_seoul() + timedelta(days=1)).isoformat()
    dashboard.record(
        client,
        opp_id,
        {"status": "LOST", "lostReasonCode": "PRICE", "nextScheduleAt": later},
    )
    with session_scope() as session:
        row = session.scalars(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
        ).first()
        row.next_schedule_at = today_in_seoul() - timedelta(days=1)
        version = row.version
    assert resolve(client, opp_id, "DONE", version).status_code == 200
    with session_scope() as session:
        row = session.scalars(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
        ).first()
        assert (row.status, row.lost_reason_code, row.reason, row.next_schedule_at) == (
            "LOST",
            "PRICE",
            "가상 가격 이유",
            None,
        )
