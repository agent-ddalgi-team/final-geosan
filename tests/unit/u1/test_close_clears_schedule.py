"""#719 단위: 마무리 저장의 다음 일정. 실제 임시 DB·API, 가상 사례만(거산 실제 사양 아님)."""

from datetime import timedelta

from sqlalchemy import select

from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import today_in_seoul
from tests.unit.u1.test_sales_questions import contact
from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7.test_bookmark import MINE, URL

dashboard_env = dashboard.dashboard_env


def _post(client, opp_id, body):
    response = client.post(f"{URL}/{opp_id}/outcomes", json=body, headers=MINE)
    assert response.status_code == 200, response.text


def _schedule(client, opp_id):
    outcome = client.get(f"{URL}/{opp_id}").json()["data"]["records"]["outcome"]
    return outcome["nextScheduleAt"], outcome["nextScheduleNote"]


def _with_schedule(dashboard_env):
    client, opp_ids = dashboard_env
    due = (today_in_seoul() + timedelta(days=3)).isoformat()
    _post(client, opp_ids[0], contact(nextScheduleAt=due, nextScheduleNote="다시 연락"))
    return client, opp_ids[0], due


def test_stage_only_request_that_ends_the_sale_clears_the_schedule(dashboard_env):
    """Given 일정이 잡힌 회사 / When 접촉 없이 단계만 성사로 고침 / Then 일정이 비워진다."""
    client, opp_id, _ = _with_schedule(dashboard_env)
    _post(client, opp_id, {"status": "WON"})
    assert _schedule(client, opp_id) == (None, None)


def test_requests_that_do_not_end_the_sale_still_inherit_the_schedule(dashboard_env):
    """Given 일정이 잡힌 회사 / When 통화만 더 남김·단계만 견적으로 / Then 일정은 그대로다."""
    client, opp_id, due = _with_schedule(dashboard_env)
    _post(client, opp_id, contact())
    assert _schedule(client, opp_id) == (due, "다시 연락")
    _post(client, opp_id, {"status": "SAMPLE_OR_REGISTRATION_APPROVED"})
    assert _schedule(client, opp_id) == (due, "다시 연락")


def test_earlier_rows_keep_their_schedule_and_cancelling_the_close_brings_it_back(
    dashboard_env,
):
    """마무리 저장은 새 행만 비운다. 그 기록을 [잘못 입력]으로 취소하면 이전 일정이 다시 보인다."""
    client, opp_id, due = _with_schedule(dashboard_env)
    _post(client, opp_id, contact(status="LOST", lostReasonCode="PRICE"))
    with session_scope() as session:
        rows = session.scalars(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version)
        ).all()
        assert [
            row.next_schedule_at.isoformat() if row.next_schedule_at else None for row in rows
        ] == [
            due,
            None,
        ]
        closing_id = rows[-1].outcome_id
    cancelled = client.post(f"{URL}/{opp_id}/records/{closing_id}/cancel", json={}, headers=MINE)
    assert cancelled.status_code == 200, cancelled.text
    assert _schedule(client, opp_id) == (due, "다시 연락")


def test_schedule_set_after_the_sale_ended_survives_a_later_reason_fix(dashboard_env):
    """Given 거절로 끝난 뒤 일부러 잡은 일정 / When 거절 이유만 고쳐 저장 / Then 일정이 남는다.

    이미 거절인 회사에 거절 행을 한 번 더 남기는 것은 "끝나는 저장"이 아니다.
    """
    client, opp_id, _ = _with_schedule(dashboard_env)
    lost = {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 첫 설명"}
    _post(client, opp_id, lost)
    assert _schedule(client, opp_id) == (None, None)
    later = (today_in_seoul() + timedelta(days=30)).isoformat()
    _post(client, opp_id, {"status": "LOST", "lostReasonCode": "OTHER", "nextScheduleAt": later})
    assert _schedule(client, opp_id)[0] == later
    _post(client, opp_id, {**lost, "reason": "가상 고친 설명"})
    assert _schedule(client, opp_id)[0] == later


def test_moving_from_one_ended_stage_to_another_clears_the_schedule(dashboard_env):
    """Given 거절 뒤 잡은 일정 / When 성사로 바뀌는 저장 / Then 일정이 비워진다(다시 끝남)."""
    client, opp_id, _ = _with_schedule(dashboard_env)
    _post(client, opp_id, {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 설명"})
    later = (today_in_seoul() + timedelta(days=30)).isoformat()
    _post(client, opp_id, {"status": "LOST", "lostReasonCode": "OTHER", "nextScheduleAt": later})
    _post(client, opp_id, {"status": "WON"})
    assert _schedule(client, opp_id) == (None, None)
