"""#265: 가상 자료·실제 임시 DB·실제 엔진·API로 거래 관계 저장을 검사한다."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from geosan.api.app import create_app
from geosan.api.deps import get_session
from geosan.capability.importer import import_capability
from geosan.config.errors import AppError
from geosan.evaluation.models import EvaluationBatch, EvaluationRun, ItemJudgmentInput
from geosan.evidence import extraction
from geosan.evidence.homepage import find_case_homepage
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity, RelationHistory
from geosan.storage.migrate import downgrade, upgrade_to_head
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def relation_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    case_path = _write(tmp_path, "case.json", factories.apjeong_with_relation("UNCONFIRMED"))
    result = import_case(case_path)
    assert flow_evaluate.run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, result.opp_id, case_path


def detail(client, opp_id):
    response = client.get(f"/api/v1/opportunities/{opp_id}")
    assert response.status_code == 200
    return response.json()["data"]


def save(client, opp_id, status, eval_id, staff="park-lee"):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/relation",
        json={"relationStatus": status, "evalId": eval_id},
        headers={"X-Staff-Key": staff},
    )


def stored_rows():
    with session_scope() as session:
        return {
            model.__tablename__: session.execute(
                select(model.__table__).order_by(*model.__table__.primary_key)
            ).all()
            for model in (Customer, RelationHistory, EvaluationBatch, EvaluationRun)
        }


def test_change_in_every_direction_reevaluates_and_appends_history(relation_env):
    """Given 확인 전 / When 거래 중·없음·확인 전 저장 / Then 매번 새 평가와 이력이 남는다."""
    client, opp_id, _ = relation_env
    original = detail(client, opp_id)
    assert original["header"]["classificationCode"] == "FILTER_PENDING"
    previous = "UNCONFIRMED"
    for count, status in enumerate(["EXISTING_CONFIRMED", "NEW_CONFIRMED", "UNCONFIRMED"], start=1):
        before = detail(client, opp_id)
        response = save(client, opp_id, status, before["evalId"])
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert response.json()["meta"]["reevaluated"] is True
        assert data["evalId"] != before["evalId"]
        after = detail(client, opp_id)
        assert after["evalId"] == data["evalId"]
        assert after["header"]["relationStatus"] == status
        assert after["header"]["relationConfirmedBy"] == data["relationConfirmedBy"] == "park-lee"
        assert after["header"]["relationConfirmedAt"] == data["relationConfirmedAt"]
        assert after["header"]["classificationCode"] == (
            "FILTER_PENDING" if status == "UNCONFIRMED" else "CONTACT_URGENT"
        )
        cards = client.get("/api/v1/opportunities").json()["data"]
        assert cards[0]["evalId"] == data["evalId"]
        assert cards[0]["classificationCode"] == after["header"]["classificationCode"]
        activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
        history = [item for item in activity if item["kind"] == "RELATION_CONFIRMED"]
        assert len(history) == count
        assert history[0]["previousValue"] == previous
        assert history[0]["actor"] == "park-lee"
        assert "거래 관계:" in history[0]["summary"] and "→" in history[0]["summary"]
        with session_scope() as session:
            row = session.get(EvaluationRun, data["evalId"])
            assert row.input_snapshot["opportunity"]["relationStatus"] == status
            assert session.get(EvaluationRun, before["evalId"]).run_status == "SUPERSEDED"
        previous = status


def test_same_value_and_stale_evaluation_do_not_write(relation_env):
    client, opp_id, _ = relation_env
    old = detail(client, opp_id)["evalId"]
    before = stored_rows()
    assert save(client, opp_id, "UNCONFIRMED", old).status_code == 400
    assert stored_rows() == before
    assert save(client, opp_id, "EXISTING_CONFIRMED", old).status_code == 200
    before = stored_rows()
    for eval_id in (old, "missing"):
        response = save(client, opp_id, "NEW_CONFIRMED", eval_id)
        assert response.status_code == 409
        assert response.json()["error"]["kind"] == "STALE_EVALUATION"
    assert stored_rows() == before


@pytest.mark.parametrize("staff", ["viewer", "unknown", ""])
def test_forbidden_staff_cannot_change_relation(relation_env, staff):
    client, opp_id, _ = relation_env
    before = stored_rows()
    assert (
        save(client, opp_id, "NEW_CONFIRMED", detail(client, opp_id)["evalId"], staff).status_code
        == 403
    )
    assert stored_rows() == before


@pytest.mark.parametrize(
    "body",
    [
        {"relationStatus": "INVALID", "evalId": "eval"},
        {"relationStatus": "NEW_CONFIRMED"},
        {"relationStatus": "NEW_CONFIRMED", "evalId": ""},
        {"relationStatus": "NEW_CONFIRMED", "evalId": 12},
        {"relationStatus": "NEW_CONFIRMED", "evalId": "eval", "relationConfirmedBy": "other"},
    ],
)
def test_invalid_body_is_rejected(relation_env, body):
    client, opp_id, _ = relation_env
    before = stored_rows()
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/relation", json=body, headers={"X-Staff-Key": "park-lee"}
    )
    assert response.status_code == 400
    assert stored_rows() == before


def test_missing_opportunity_and_other_opportunity_evaluation_cannot_write(relation_env, tmp_path):
    client, opp_id, _ = relation_env
    eval_id = detail(client, opp_id)["evalId"]
    assert save(client, "missing", "NEW_CONFIRMED", eval_id).status_code == 404
    other = import_case(_write(tmp_path, "other.json", factories.apjeong_renamed_customer("other")))
    assert flow_evaluate.run_evaluation([other.opp_id]).ok
    before = stored_rows()
    response = save(client, other.opp_id, "EXISTING_CONFIRMED", eval_id)
    assert response.status_code == 409
    assert stored_rows() == before


@pytest.mark.parametrize("failed_step", ["evaluate", "save_evaluation", "upsert_question"])
def test_evaluation_failure_rolls_back_relation_history_and_all_evaluation_rows(
    relation_env, monkeypatch, failed_step
):
    """Given 실제 평가·질문 저장 도중 실패 / When 변경 / Then 이전 값·평가 전부 그대로다."""
    client, opp_id, _ = relation_env
    eval_id = detail(client, opp_id)["evalId"]
    before = stored_rows()
    real_step = getattr(flow_evaluate, failed_step)
    attempts = []

    def fail_after_write(*args, **kwargs):
        real_step(*args, **kwargs)
        attempts.append(failed_step)
        raise RuntimeError("가상 거래 관계 저장 실패")

    monkeypatch.setattr(flow_evaluate, failed_step, fail_after_write)
    response = save(client, opp_id, "EXISTING_CONFIRMED", eval_id)
    assert response.status_code == 500 and attempts == [failed_step]
    assert stored_rows() == before


def test_commit_failure_rolls_back_without_retry(relation_env):
    client, opp_id, _ = relation_env
    eval_id = detail(client, opp_id)["evalId"]
    before = stored_rows()
    attempts = []

    def fail_commit(session):
        attempts.append("commit")
        raise RuntimeError("가상 거래 관계 커밋 실패")

    def failing_session():
        with session_scope() as session:
            event.listen(session, "before_commit", fail_commit)
            yield session

    client.app.dependency_overrides[get_session] = failing_session
    try:
        response = save(client, opp_id, "EXISTING_CONFIRMED", eval_id)
    finally:
        client.app.dependency_overrides.pop(get_session)
    assert response.status_code == 500 and attempts == ["commit"]
    assert stored_rows() == before


def test_missing_evaluation_input_cancels_relation_instead_of_partial_success(relation_env):
    client, opp_id, _ = relation_env
    with session_scope() as session:
        row = session.scalar(select(ItemJudgmentInput).where(ItemJudgmentInput.opp_id == opp_id))
        session.delete(row)
    before = stored_rows()
    response = save(client, opp_id, "EXISTING_CONFIRMED", detail(client, opp_id)["evalId"])
    assert response.status_code == 500
    assert stored_rows() == before


def test_concurrent_requests_reject_one_stale_evaluation(relation_env):
    client, opp_id, _ = relation_env
    eval_id = detail(client, opp_id)["evalId"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(save, client, opp_id, status, eval_id)
            for status in ["NEW_CONFIRMED", "EXISTING_CONFIRMED"]
        ]
        assert sorted(f.result().status_code for f in futures) == [200, 409]
    with session_scope() as session:
        assert len(session.scalars(select(RelationHistory)).all()) == 1
        assert len(session.scalars(select(EvaluationRun)).all()) == 2


@pytest.mark.parametrize("status", ["EXISTING_CONFIRMED", "NEW_CONFIRMED", "UNCONFIRMED"])
def test_reimport_keeps_staff_values_including_reset_to_unconfirmed(relation_env, status):
    client, opp_id, case_path = relation_env
    if status == "UNCONFIRMED":
        assert (
            save(client, opp_id, "NEW_CONFIRMED", detail(client, opp_id)["evalId"]).status_code
            == 200
        )
    assert save(client, opp_id, status, detail(client, opp_id)["evalId"]).status_code == 200
    before = detail(client, opp_id)
    # 다시 넣는 파일은 원래의 확인 전 값이다. 되돌린 상태도 담당자·확인일을 보존한다.
    result = import_case(case_path)
    after = detail(client, opp_id)
    for field in ["relationStatus", "relationConfirmedAt", "relationConfirmedBy"]:
        assert after["header"][field] == before["header"][field]
    assert bool(result.warnings) is (status != "UNCONFIRMED")
    assert after["evalId"] == before["evalId"]


def test_migration_preserves_old_customer_and_starts_without_history(relation_env, tmp_db):
    client, opp_id, _ = relation_env
    before = detail(client, opp_id)
    assert downgrade(tmp_db, "tg_001") == ["tg_001"]
    assert upgrade_to_head(tmp_db) == ["rec_008"]
    after = detail(client, opp_id)
    assert after == before
    assert after["header"]["relationConfirmedBy"] is None
    with session_scope() as session:
        assert session.scalar(select(RelationHistory)) is None


def test_relation_migration_preserves_existing_lost_reason_rows(relation_env, tmp_db):
    """Given 거절 이유 저장 DB / When 거래 관계 열을 내렸다 올림 / Then 기존 행을 보존한다."""
    client, opp_id, _ = relation_env
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/outcomes",
        json={"status": "LOST", "lostReasonCode": "PRICE", "reason": "가상 가격 조건"},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200, response.text
    before_detail = detail(client, opp_id)
    with sqlite3.connect(tmp_db) as connection:
        before_rows = connection.execute("SELECT * FROM rec_outcome ORDER BY version").fetchall()
    assert before_detail["records"]["outcome"]["lostReasonCode"] == "PRICE"
    assert downgrade(tmp_db, "rec_007") == ["rec_007"]
    with sqlite3.connect(tmp_db) as connection:
        assert connection.execute("SELECT * FROM rec_outcome ORDER BY version").fetchall() == (
            before_rows
        )
    assert upgrade_to_head(tmp_db) == ["rec_008"]
    assert upgrade_to_head(tmp_db) == ["rec_008"]
    with sqlite3.connect(tmp_db) as connection:
        assert connection.execute("SELECT * FROM rec_outcome ORDER BY version").fetchall() == (
            before_rows
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    after_detail = detail(client, opp_id)
    # 관심 표(rec_008, #356)는 내리면 지워지고 다시 올릴 때 기록이 있는 회사를 다시 켠다.
    # 그래서 관심은 계속 켜져 있지만 누가·언제는 옮긴 자료(system) 것으로 바뀐다.
    before_bookmark = before_detail["records"].pop("bookmark")
    after_bookmark = after_detail["records"].pop("bookmark")
    assert before_bookmark["active"] is True and after_bookmark["active"] is True
    assert (before_bookmark["updatedBy"], after_bookmark["updatedBy"]) == ("park-lee", "system")
    assert after_detail == before_detail


def test_staff_relation_is_not_passed_to_search_adapter(relation_env):
    """Given 담당자가 거래 중 저장 / When 홈페이지 검색 / Then 공개 회사명·주소만 전달한다."""
    client, opp_id, _ = relation_env
    assert (
        save(client, opp_id, "EXISTING_CONFIRMED", detail(client, opp_id)["evalId"]).status_code
        == 200
    )
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.security_grade = "PUBLIC"
        customer.homepage_status = None
        expected = customer.name.strip(), customer.normalized_address.strip()
    sent = []

    def search(name, address):
        sent.append((name, address))
        return {
            "provider": "OPENAI_WEB_SEARCH",
            "url": None,
            "confidence": 0.0,
            "reason": "가상 검색 결과 없음",
            "fetchedAt": "2026-11-04T09:00:00+09:00",
        }

    find_case_homepage(opp_id, search=search)
    assert sent == [expected]
    assert all("EXISTING_CONFIRMED" not in value and "park-lee" not in value for value in sent[0])


def test_relation_history_id_is_refused_as_external_ai_input(relation_env, monkeypatch):
    """Given 거래 관계 이력 ID / When 공개 본문인 것처럼 전송 / Then HTTP 호출 전에 거부한다."""
    client, opp_id, _ = relation_env
    assert (
        save(client, opp_id, "EXISTING_CONFIRMED", detail(client, opp_id)["evalId"]).status_code
        == 200
    )
    with session_scope() as session:
        session.get(
            Customer, session.get(Opportunity, opp_id).customer_id
        ).security_grade = "PUBLIC"
        history_id = session.scalar(select(RelationHistory.relation_history_id))
    calls = []

    def forbidden_http(*args, **kwargs):
        calls.append(args)
        raise AssertionError("거래 관계는 외부 AI로 보낼 수 없습니다.")

    monkeypatch.setattr(extraction, "_post", forbidden_http)
    with pytest.raises(AppError) as exc:
        extraction.extract_evidence([history_id], opp_id, deadline=0, requested_by="park-lee")
    assert exc.value.status == 422
    assert calls == []
