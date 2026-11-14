"""지난 일정 이어받기(PM 결정 2026-11-14). 실제 임시 DB·API, 가상 사례만(거산 실제 사양 아님).

통화·메일·방문을 남기면 이미 지난 일정은 다음 기록으로 넘기지 않는다. 그 날짜 뒤에 연락했으니
놓친 일정이 아니다. 오늘 이후 일정은 지금처럼 넘기고, 접촉 없이 단계만 고치는 저장은 지난 일정도
그대로 둔다(대시보드 "놓친 일정"으로 알려야 하므로).
"""

from datetime import timedelta

from sqlalchemy import select

from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import today_in_seoul
from tests.unit.u1.test_close_clears_schedule import _post, _schedule
from tests.unit.u1.test_sales_questions import contact
from tests.unit.u7 import test_dashboard as dashboard

dashboard_env = dashboard.dashboard_env


def _with_past_schedule(dashboard_env):
    client, opp_ids = dashboard_env
    opp_id = opp_ids[0]
    _post(client, opp_id, contact(nextScheduleAt=today_in_seoul().isoformat()))
    past = today_in_seoul() - timedelta(days=2)
    with session_scope() as session:
        row = session.scalars(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
        ).first()
        row.next_schedule_at = past
        row.next_schedule_note = "다시 연락"
    return client, opp_id, past.isoformat()


def test_contact_after_a_past_schedule_does_not_carry_it(dashboard_env):
    """Given 이틀 전 일정이 남은 회사 / When 새 일정 없이 통화를 남김 / Then 일정이 비워진다."""
    client, opp_id, _ = _with_past_schedule(dashboard_env)
    _post(client, opp_id, contact())
    assert _schedule(client, opp_id) == (None, None)


def test_stage_only_save_keeps_a_past_schedule(dashboard_env):
    """Given 이틀 전 일정이 남은 회사 / When 접촉 없이 단계만 견적으로 / Then 놓친 일정은 남는다."""
    client, opp_id, past = _with_past_schedule(dashboard_env)
    _post(client, opp_id, {"status": "SAMPLE_OR_REGISTRATION_APPROVED"})
    assert _schedule(client, opp_id) == (past, "다시 연락")


def test_contact_keeps_a_future_schedule(dashboard_env):
    """Given 사흘 뒤 일정 / When 새 일정 없이 통화를 남김 / Then 일정은 그대로 넘어간다."""
    client, opp_ids = dashboard_env
    due = (today_in_seoul() + timedelta(days=3)).isoformat()
    _post(client, opp_ids[0], contact(nextScheduleAt=due, nextScheduleNote="다시 연락"))
    _post(client, opp_ids[0], contact())
    assert _schedule(client, opp_ids[0]) == (due, "다시 연락")
