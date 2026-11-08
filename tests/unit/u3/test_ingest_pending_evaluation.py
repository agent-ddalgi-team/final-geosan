"""PM #440: 새 후보의 평가 전 기록, 실제 API 목록·상세와 대시보드 집계를 확인한다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from geosan.api.app import create_app
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import EvaluationRun, ItemJudgment, ItemJudgmentInput
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows.research import ResearchResult
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u3 import test_flow_ingest as support
from tests.unit.u7.test_bookmark import set_bookmark

ingest_env = support.ingest_env


def found_opportunity():
    with session_scope() as session:
        opp = session.scalar(
            select(Opportunity).join(Customer).where(Customer.ingest_batch_id.is_not(None))
        )
        return opp.opp_id


@pytest.mark.parametrize("dataset", ["VIRTUAL_REVIEWED", "BROCHURE"])
def test_empty_found_company_has_real_pending_record_and_opens_detail(
    ingest_env, monkeypatch, dataset
):
    """Given 입력 없는 새 후보 / When 재평가 / Then 실제 평가 번호로 목록·상세가 열린다."""
    if dataset == "BROCHURE":
        support._brochure_runtime()
        monkeypatch.setattr(
            support.flow, "research_one", lambda opp_id: ResearchResult(status="NOT_FOUND")
        )
    support.flow.run_ingest(support.new_batch(dataset=dataset))
    opp_id = found_opportunity()
    with session_scope() as session:
        run = latest_confirmed_evaluation(session, opp_id)
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        assert run.classification_code == "NOT_EVALUATED" and run.score_s is None
        assert run.reason == customer.pick_reason
        assert run.blocker_text == "점수 입력 전 · 거래 관계·필수조건 확인 전"
        assert run.next_action == "AI 조사 결과 확인 뒤 점수 입력"
        assert run.score_display == "--" and run.blocks_approval
        assert run.input_snapshot["itemInputs"] == [] and not run.operational_ready
        assert session.scalar(select(func.count()).select_from(ItemJudgmentInput)) == 0
        judgments = session.scalars(
            select(ItemJudgment).where(ItemJudgment.eval_id == run.eval_id)
        ).all()
        assert len(judgments) == len(run.input_snapshot["ruleConfig"]["newProfileItems"])
        assert all(row.state == "UNAVAILABLE" and row.score is None for row in judgments)
    with TestClient(create_app()) as client:
        listed = client.get("/api/v1/opportunities")
        assert listed.status_code == 200
        card = listed.json()["data"][0]
        assert card["evalId"] == run.eval_id and card["scoreState"] == "NONE"
        assert card["scoreDisplay"] == "--" and card["classificationCode"] == "NOT_EVALUATED"
        detail = client.get(f"/api/v1/opportunities/{opp_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["data"]["evalId"] == run.eval_id
        assert detail.json()["data"]["scores"]["S"] is None


def _add_inputs(opp_id, codes):
    with session_scope() as session:
        for code in codes:
            session.add(
                ItemJudgmentInput(
                    item_input_id=new_id("input"),
                    opp_id=opp_id,
                    item_code=code,
                    state="MISMATCH",
                    entered_by="park-lee",
                    entered_at=utcnow(),
                    dataset_kind="VIRTUAL_REVIEWED",
                    is_virtual=True,
                )
            )


def test_real_inputs_replace_pending_record_and_keep_previous_history(ingest_env):
    support.flow.run_ingest(support.new_batch())
    opp_id = found_opportunity()
    with session_scope() as session:
        previous = latest_confirmed_evaluation(session, opp_id)
        codes = [
            row["itemCode"] for row in previous.input_snapshot["ruleConfig"]["newProfileItems"]
        ]
    _add_inputs(opp_id, codes)
    result = support.flow.run_evaluation([opp_id])
    assert result.ok and result.affected_opp_ids == [opp_id]
    with session_scope() as session:
        current = latest_confirmed_evaluation(session, opp_id)
        assert current.score_s is not None and current.previous_eval_id == previous.eval_id
        assert session.get(EvaluationRun, previous.eval_id).run_status == "SUPERSEDED"
        assert current.input_snapshot["itemInputs"]


def test_partly_entered_found_company_is_still_skipped(ingest_env):
    support.flow.run_ingest(support.new_batch())
    opp_id = found_opportunity()
    with session_scope() as session:
        previous = latest_confirmed_evaluation(session, opp_id)
        code = previous.input_snapshot["ruleConfig"]["newProfileItems"][0]["itemCode"]
    _add_inputs(opp_id, [code])
    result = support.flow.run_evaluation([opp_id])
    assert result.ok and result.affected_opp_ids == [] and "항목 입력 없음" in result.summary
    with session_scope() as session:
        assert latest_confirmed_evaluation(session, opp_id).eval_id == previous.eval_id


def test_empty_case_file_company_keeps_original_skip_behavior(ingest_env, tmp_path):
    imported = import_case(_write(tmp_path, "original.json", factories.apjeong_case()))
    with session_scope() as session:
        session.execute(
            delete(ItemJudgmentInput).where(ItemJudgmentInput.opp_id == imported.opp_id)
        )
    result = support.flow.run_evaluation([imported.opp_id])
    assert result.ok and result.new_eval_ids == [] and "항목 입력 없음" in result.summary


def test_pending_candidate_stays_listed_and_bookmarked_after_full_evaluation(ingest_env, tmp_path):
    """평가 전 후보도 관심 기업에 남는다. 즉시 대시보드 집계는 PM 후속 #465가 검증한다."""
    import_case(_write(tmp_path, "anchor.json", factories.apjeong_case()))
    assert support.flow.run_evaluation().ok
    support.flow.run_ingest(support.new_batch())
    opp_id = found_opportunity()
    with TestClient(create_app()) as client:
        listed = client.get("/api/v1/opportunities").json()
        assert listed["meta"]["total"] == 2
        counts = {row["processCode"]: row["count"] for row in listed["meta"]["processCounts"]}
        assert counts["ZINC_PLATING"] >= 1
        initial = client.get("/api/v1/dashboard").json()["data"]["counts"]
        assert all(value == 0 for value in initial.values())
        response = set_bookmark(client, opp_id, True)
        assert response.status_code == 200, response.text
        assert (
            client.get("/api/v1/opportunities", params={"bookmarked": True}).json()["meta"]["total"]
            == 1
        )
        bookmarked = client.get("/api/v1/opportunities", params={"bookmarked": True}).json()["data"]
        assert bookmarked[0]["oppId"] == opp_id
        assert bookmarked[0]["classificationCode"] == "NOT_EVALUATED"
        assert support.flow.run_evaluation().ok
        after_full = client.get("/api/v1/dashboard").json()["data"]["counts"]
        assert after_full["BOOKMARKED"] == after_full["NO_OPINION"] == 1
