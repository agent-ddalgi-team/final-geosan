"""#531: 접촉 때 AI 판단이 맞았나를 저장한다. 영업 성과와 별개이고 점수는 바꾸지 않는다."""

import pytest
from sqlalchemy import func, select

from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_records as support

records_env = support.records_env


def contact(**extra):
    return {
        "status": "IN_PROGRESS",
        "method": "CALL",
        "result": "REACHED",
        "attemptedAt": "2026-10-20",
        **extra,
    }


@pytest.mark.parametrize("value", ["MATCHED", "MISMATCHED", "UNKNOWN"])
def test_contact_saves_judgment_check(records_env, value):
    client, opp_id = records_env
    response = support.post(client, opp_id, "outcomes", contact(judgmentCheck=value))
    assert response.status_code == 200, response.text
    with session_scope() as session:
        assert session.scalar(select(Outcome)).judgment_check == value


def test_contact_without_choice_stays_empty(records_env):
    client, opp_id = records_env
    assert support.post(client, opp_id, "outcomes", contact()).status_code == 200
    with session_scope() as session:
        assert session.scalar(select(Outcome)).judgment_check is None


def test_stage_only_record_rejects_judgment_check(records_env):
    """Given 접촉이 아닌 단계 저장 / When 판단 값을 넣음 / Then 칸 오류이며 저장하지 않는다."""
    client, opp_id = records_env
    body = {"status": "IN_PROGRESS", "judgmentCheck": "MATCHED"}
    response = support.post(client, opp_id, "outcomes", body)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["fields"][0]["path"] == "judgmentCheck"
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0


def test_unknown_value_is_rejected(records_env):
    client, opp_id = records_env
    response = support.post(client, opp_id, "outcomes", contact(judgmentCheck="MAYBE"))
    assert response.status_code in (400, 422), response.text


def test_judgment_check_does_not_change_the_score(records_env):
    client, opp_id = records_env
    with session_scope() as session:
        before = latest_confirmed_evaluation(session, opp_id)
        expected = before.eval_id, before.score_s, before.classification_code
    body = contact(judgmentCheck="MISMATCHED")
    assert support.post(client, opp_id, "outcomes", body).status_code == 200
    with session_scope() as session:
        after = latest_confirmed_evaluation(session, opp_id)
        assert (after.eval_id, after.score_s, after.classification_code) == expected
