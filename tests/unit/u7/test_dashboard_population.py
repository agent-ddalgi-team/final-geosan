"""#465: 전체 평가를 기다리지 않고 관심 기업의 확정 평가로 대시보드를 센다."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from geosan.api.app import create_app
from geosan.api.routes import dashboard as dashboard_route
from geosan.capability.importer import import_capability
from geosan.config.registry import set_active_dataset_kind
from geosan.evaluation.ledger import latest_confirmed_evaluation, latest_full_batch
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note, Outcome
from geosan.storage.base import new_id
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u3.test_ingest_list_api import add_candidate, save_batch
from tests.unit.u7.test_bookmark import MINE, give_opinion, listed_ids, set_bookmark, write_note
from tests.unit.u7.test_dashboard import NOW, TODAY, ZERO_COUNTS, record


def dashboard_body(client):
    response = client.get("/api/v1/dashboard", headers=MINE)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def candidate_env(tmp_db, tmp_path, monkeypatch):
    """기존 후보 검사와 같은 실제 DB 부분 평가로 점수 입력 전 기록을 재현한다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    save_batch()
    opp_id = add_candidate(tmp_path, "dashboard-found")
    with session_scope() as session:
        evaluation = latest_confirmed_evaluation(session, opp_id)
        evaluation.classification_code = "NOT_EVALUATED"
        assert evaluation.score_s is None
        assert latest_full_batch(session, dataset_kind="VIRTUAL_REVIEWED") is None
    monkeypatch.setattr(dashboard_route, "utcnow", lambda: NOW)
    with TestClient(create_app()) as client:
        yield client, opp_id


def add_program_records(opp_id):
    """프로그램 기록은 관심을 자동으로 켜지 않는다. 글은 가상 메모이며 외부로 보내지 않는다."""
    with session_scope() as session:
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opp_id,
                staff_key="park-lee",
                kind="RESEARCH",
                text="대시보드에 보내지 않을 가상 메모",
                version=1,
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
        session.add(
            Outcome(
                outcome_id=new_id("outcome"),
                opp_id=opp_id,
                status="NOT_EXECUTED",
                next_schedule_at=TODAY,
                next_schedule_note="가상 일정",
                version=1,
                created_by="park-lee",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )


def assert_empty(body):
    assert body["data"]["counts"] == ZERO_COUNTS
    assert body["data"]["schedule"] == []
    assert body["data"]["recentActivity"] == []
    assert body["meta"]["hasVirtualData"] is False


def test_partial_pending_candidate_counts_immediately_and_follows_opinion(candidate_env):
    """Given 전체 평가 없는 평가 전 회사 / When 관심·의견 저장 / Then 바로 한 칸씩 이동한다."""
    client, opp_id = candidate_env
    assert_empty(dashboard_body(client))
    assert set_bookmark(client, opp_id, True).status_code == 200
    body = dashboard_body(client)
    assert body["data"]["counts"] == {**ZERO_COUNTS, "BOOKMARKED": 1, "NO_OPINION": 1}
    assert body["meta"]["hasVirtualData"] is True
    assert listed_ids(client, bookmarked="true") == {opp_id}
    for opinion, key in (("NEED_CHECK", "NEED_CHECK"), ("WORTH_REVIEW", "NOT_CONTACTED")):
        give_opinion(client, opp_id, opinion)
        assert dashboard_body(client)["data"]["counts"] == {**ZERO_COUNTS, "BOOKMARKED": 1, key: 1}
        assert listed_ids(client, filter=key) == {opp_id}
    with session_scope() as session:
        assert latest_full_batch(session, dataset_kind="VIRTUAL_REVIEWED") is None
        assert session.scalar(select(func.count()).select_from(EvaluationRun)) == 1


def test_schedule_and_activity_use_the_same_bookmarked_population(candidate_env):
    """Given 관심 없는 회사의 기록·일정 / When 관심 켬 / Then 건수·일정·최근 기록이 함께 나온다."""
    client, opp_id = candidate_env
    add_program_records(opp_id)
    assert_empty(dashboard_body(client))
    assert set_bookmark(client, opp_id, True).status_code == 200
    body = dashboard_body(client)
    assert body["data"]["counts"] == {
        **ZERO_COUNTS,
        "BOOKMARKED": 1,
        "NO_OPINION": 1,
        "SCHEDULE_DUE": 1,
    }
    assert [row["oppId"] for row in body["data"]["schedule"]] == [opp_id]
    assert {row["oppId"] for row in body["data"]["recentActivity"]} == {opp_id}
    assert len(body["data"]["recentActivity"]) == 2
    assert "대시보드에 보내지 않을 가상 메모" not in str(body)
    assert listed_ids(client, filter="SCHEDULE_DUE") == {opp_id}


def test_unbookmarked_and_unevaluated_companies_do_not_count(candidate_env, tmp_path):
    """Given 관심 끔·평가 없음 / When 조회 / Then 어느 칸·가상 표시에도 섞이지 않는다."""
    client, opp_id = candidate_env
    assert set_bookmark(client, opp_id, True).status_code == 200
    assert set_bookmark(client, opp_id, False).status_code == 200
    other = import_case(
        _write(
            tmp_path,
            "unevaluated.json",
            factories.apjeong_renamed_customer("not-evaluated", "평가 없는 가상 회사"),
        )
    ).opp_id
    assert set_bookmark(client, other, True).status_code == 200
    assert_empty(dashboard_body(client))


@pytest.mark.parametrize("location", ["opportunity", "customer", "evaluation", "batch"])
def test_out_of_dataset_records_are_excluded_everywhere(candidate_env, location):
    """Given 다른 묶음의 회사·평가·회차 / When 조회 / Then 건수·일정·활동·가상 표시에 안 든다."""
    client, opp_id = candidate_env
    add_program_records(opp_id)
    assert set_bookmark(client, opp_id, True).status_code == 200
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_id)
        evaluation = latest_confirmed_evaluation(session, opp_id)
        rows = {
            "opportunity": opportunity,
            "customer": session.get(Customer, opportunity.customer_id),
            "evaluation": evaluation,
            "batch": session.get(EvaluationBatch, evaluation.batch_id),
        }
        if location in {"opportunity", "customer"}:
            rows[location].is_virtual = False
        else:
            rows[location].dataset_kind = "BROCHURE"
    assert_empty(dashboard_body(client))


@pytest.mark.parametrize("invalid", ["run", "batch"])
def test_only_confirmed_records_are_counted(candidate_env, invalid):
    """Given 확정되지 않은 평가 또는 회차 / When 조회 / Then 이전 기록이 있어도 세지 않는다."""
    client, opp_id = candidate_env
    add_program_records(opp_id)
    assert set_bookmark(client, opp_id, True).status_code == 200
    with session_scope() as session:
        evaluation = latest_confirmed_evaluation(session, opp_id)
        if invalid == "run":
            evaluation.run_status = "SUPERSEDED"
        else:
            session.get(EvaluationBatch, evaluation.batch_id).status = "FAILED"
    assert_empty(dashboard_body(client))


def test_latest_confirmed_record_is_chosen_before_dataset_filter(candidate_env):
    """Given 최신 평가가 다른 묶음 / When 예전 묶음 조회 / Then 낡은 평가를 대신 세지 않는다."""
    client, opp_id = candidate_env
    assert set_bookmark(client, opp_id, True).status_code == 200
    with session_scope() as session:
        old = latest_confirmed_evaluation(session, opp_id)
        old_batch = session.get(EvaluationBatch, old.batch_id)
        batch_values = {
            column.name: getattr(old_batch, column.name)
            for column in EvaluationBatch.__table__.columns
        }
        batch_values.update(batch_id=new_id("batch"), dataset_kind="BROCHURE")
        session.add(EvaluationBatch(**batch_values))
        session.flush()
        values = {
            column.name: getattr(old, column.name) for column in EvaluationRun.__table__.columns
        }
        values.update(
            eval_id=new_id("eval"),
            batch_id=batch_values["batch_id"],
            created_at=old.created_at + timedelta(seconds=1),
            dataset_kind="BROCHURE",
        )
        session.add(EvaluationRun(**values))
    assert_empty(dashboard_body(client))


def test_switching_active_dataset_does_not_mix_companies(candidate_env, tmp_path):
    """Given 가상·소개서 회사 각각 관심 / When 묶음을 바꿔 조회 / Then 자기 회사만 센다."""
    client, virtual = candidate_env
    assert set_bookmark(client, virtual, True).status_code == 200
    import_capability(_write(tmp_path, "brochure-cap.json", factories.brochure_capability_file()))
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE")
    brochure = import_case(
        _write(tmp_path, "brochure.json", factories.brochure_case("dashboard-brochure"))
    ).opp_id
    assert run_evaluation(opp_ids=[brochure]).ok
    assert set_bookmark(client, brochure, True).status_code == 200
    for dataset, expected_virtual in (("BROCHURE", False), ("VIRTUAL_REVIEWED", True)):
        with session_scope() as session:
            set_active_dataset_kind(session, dataset)
        body = dashboard_body(client)
        assert body["data"]["counts"] == {**ZERO_COUNTS, "BOOKMARKED": 1, "NO_OPINION": 1}
        assert body["meta"]["datasetKind"] == dataset
        assert body["meta"]["hasVirtualData"] is expected_virtual


def test_reviewing_brochure_keeps_the_original_companies_visible(tmp_db, tmp_path):
    """Given 소개서 회사의 관심 / When 거산 확인 완료로 전환 / Then 원본 표시와 관심 건수 보존."""
    from geosan.commands.review_set import run_review_set

    import_capability(_write(tmp_path, "brochure-cap.json", factories.brochure_capability_file()))
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE")
    opp_id = import_case(
        _write(tmp_path, "brochure.json", factories.brochure_case("dashboard-review"))
    ).opp_id
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        assert set_bookmark(client, opp_id, True).status_code == 200
        before = dashboard_body(client)
        assert before["data"]["counts"] == {**ZERO_COUNTS, "BOOKMARKED": 1, "NO_OPINION": 1}
        assert (
            run_review_set(
                ["REVIEWED"], all_values=True, reviewer="가상 확인자", basis="가상 전체 확인"
            )
            == 0
        )
        after = dashboard_body(client)
        assert after["data"]["counts"] == before["data"]["counts"]
        assert after["meta"]["datasetKind"] == "COMPANY_CONFIRMED"
        assert after["meta"]["hasVirtualData"] is False
        with session_scope() as session:
            opportunity = session.get(Opportunity, opp_id)
            assert opportunity.dataset_kind == "BROCHURE"
            assert session.get(Customer, opportunity.customer_id).dataset_kind == "BROCHURE"


def test_existing_eighteen_companies_keep_counts_schedule_and_activity(
    tmp_db, tmp_path, monkeypatch
):
    """Given 가상 18곳 전체 평가 / When 새 회사 관심 켬 / Then 기존 결과 보존·새 곳만 더함."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    ids = [
        import_case(
            _write(
                tmp_path,
                f"old-{i}.json",
                factories.apjeong_renamed_customer(f"old-{i}", f"기존 가상 회사 {i}"),
            )
        ).opp_id
        for i in range(18)
    ]
    assert run_evaluation().ok
    monkeypatch.setattr(dashboard_route, "utcnow", lambda: NOW)
    with TestClient(create_app()) as client:
        for opp_id in ids:
            assert set_bookmark(client, opp_id, True).status_code == 200
        record(client, ids[0], {"status": "ON_HOLD", "nextScheduleAt": TODAY.isoformat()})
        write_note(client, ids[1])
        before = dashboard_body(client)["data"]
        assert before["counts"] == {
            **ZERO_COUNTS,
            "BOOKMARKED": 18,
            "NO_OPINION": 17,
            "ON_HOLD": 1,
            "SCHEDULE_DUE": 1,
        }
        save_batch()
        new = add_candidate(tmp_path, "new-after-eighteen")
        assert dashboard_body(client)["data"] == before
        assert set_bookmark(client, new, True).status_code == 200
        after = dashboard_body(client)["data"]
        assert after["counts"] == {**before["counts"], "BOOKMARKED": 19, "NO_OPINION": 18}
        assert after["schedule"] == before["schedule"]
        assert after["recentActivity"] == before["recentActivity"]
