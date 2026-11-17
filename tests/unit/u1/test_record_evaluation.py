"""#450: 실제 API와 임시 DB로 기록 당시 본 평가 번호를 확인한다."""

import pytest
from sqlalchemy import func, select

from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.records.models import Bookmark, Note, Outcome, ReviewOpinion
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1 import test_sales_records
from tests.unit.u1.test_snapshot_ledger import _write

post = test_sales_records.post
records_env = test_sales_records.records_env


def body_for(kind, eval_id):
    body = {
        "outcomes": {"status": "IN_PROGRESS", "method": "CALL", "result": "REACHED"},
        "notes": {"kind": "RESEARCH", "text": "가상 공개 자료 확인"},
        "opinions": {"opinion": "NEED_CHECK"},
    }[kind]
    return {**body, "evalId": eval_id}


def viewed_evaluation(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["evalId"]


@pytest.mark.parametrize("kind,model", [("outcomes", Outcome), ("notes", Note)])
@pytest.mark.parametrize("older", [False, True])
def test_record_keeps_the_viewed_evaluation_even_after_reevaluation(
    records_env, kind, model, older
):
    """Given 화면에서 본 평가 / When 재평가 전후 기록 저장 / Then 요청 번호 그대로 남는다."""
    client, opp_id = records_env
    eval_id = viewed_evaluation(client, opp_id)
    if older:
        assert run_evaluation().ok
        assert viewed_evaluation(client, opp_id) != eval_id
        with session_scope() as session:
            assert session.get(EvaluationRun, eval_id).run_status == "SUPERSEDED"
    response = post(client, opp_id, kind, body_for(kind, eval_id))
    assert response.status_code == 200, response.text
    assert "evalId" not in response.json()["data"]
    with session_scope() as session:
        row = session.scalar(select(model).where(model.opp_id == opp_id))
        assert row.eval_id == eval_id and row.version == 1
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    # #697: 접촉을 남기면 같은 저장에서 검토 의견(영업 대상) 한 줄이 함께 생긴다.
    # 의견 줄은 본 평가 번호를 싣고(의견의 기존 규칙), 접촉·메모 줄은 싣지 않는다.
    opinions = [item for item in activity if item["kind"] == "OPINION"]
    records = [item for item in activity if item["kind"] != "OPINION"]
    assert len(records) == 1
    assert records[0].get("evalId") is None
    assert [item.get("evalId") for item in opinions] == ([eval_id] if kind == "outcomes" else [])
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    if kind == "outcomes":
        assert "evalId" not in detail["records"]["outcome"]


@pytest.mark.parametrize("kind,model", [("outcomes", Outcome), ("notes", Note)])
@pytest.mark.parametrize("omitted", [False, True])
def test_record_without_evaluation_stays_empty(records_env, kind, model, omitted):
    """Given 평가 번호 없음 / When 번호를 빼거나 null로 저장 / Then 최신 번호로 채우지 않는다."""
    client, opp_id = records_env
    body = body_for(kind, None)
    if omitted:
        body.pop("evalId")
    assert post(client, opp_id, kind, body).status_code == 200
    with session_scope() as session:
        assert session.scalar(select(model)).eval_id is None


@pytest.mark.parametrize("kind", ["outcomes", "notes", "opinions"])
@pytest.mark.parametrize("invalid", ["missing", "other", "unconfirmed", "batch_failed"])
def test_invalid_evaluation_creates_neither_record_nor_bookmark(
    records_env, tmp_path, kind, invalid
):
    """Given 없는·다른 회사·미확정 평가 / When 기록 요청 / Then 400이며 저장하지 않는다."""
    client, opp_id = records_env
    eval_id = viewed_evaluation(client, opp_id)
    if invalid == "missing":
        eval_id = "eval-missing"
    elif invalid == "other":
        case = factories.apjeong_case()
        case["caseId"] = "record-other"
        case["customer"]["name"] = "가상 다른 회사"
        other = import_case(_write(tmp_path, "other.json", case))
        assert run_evaluation().ok
        eval_id = viewed_evaluation(client, other.opp_id)
    else:
        with session_scope() as session:
            evaluation = session.get(EvaluationRun, eval_id)
            if invalid == "unconfirmed":
                evaluation.run_status = "DRAFT"
            else:
                session.get(EvaluationBatch, evaluation.batch_id).status = "FAILED"
    response = post(client, opp_id, kind, body_for(kind, eval_id))
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["message"] == "이 기회에서 본 평가 ID를 넣어 주세요."
    assert error["fields"][0]["path"] == "evalId"
    with session_scope() as session:
        for model in (Outcome, Note, ReviewOpinion, Bookmark):
            assert session.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize("kind,model", [("outcomes", Outcome), ("notes", Note)])
def test_each_appended_record_keeps_its_own_evaluation(records_env, kind, model):
    """Given 기록 뒤 재평가 / When 다시 기록 / Then 이전 행의 번호를 덮어쓰지 않는다."""
    client, opp_id = records_env
    first = viewed_evaluation(client, opp_id)
    assert post(client, opp_id, kind, body_for(kind, first)).status_code == 200
    assert run_evaluation().ok
    second = viewed_evaluation(client, opp_id)
    assert first != second
    assert post(client, opp_id, kind, body_for(kind, second)).status_code == 200
    with session_scope() as session:
        rows = session.scalars(select(model).order_by(model.version)).all()
        assert [(r.version, r.eval_id) for r in rows] == [(1, first), (2, second)]
