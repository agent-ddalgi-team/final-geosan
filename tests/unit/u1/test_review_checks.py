"""#227: 검토사항 파생·체크 이력은 가상 입력과 실제 임시 SQLite·API로 확인한다."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, func, literal_column, select

from geosan.api.deps import get_session
from geosan.api.routes.records import derive_review_items
from geosan.api.schemas import OpportunityDetail, Question
from geosan.evaluation.models import EvaluationRun
from geosan.evidence.models import Evidence
from geosan.opportunity.importer import import_case
from geosan.records.models import Note, ReviewCheck
from geosan.storage.migrate import downgrade, upgrade_to_head
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_sales_records import records_env as sales_env
from tests.unit.u1.test_sales_records import request_logs as sales_logs
from tests.unit.u1.test_snapshot_ledger import _write

records_env = sales_env
request_logs = sales_logs


def detail(client, opp_id):
    response = client.get(f"/api/v1/opportunities/{opp_id}")
    assert response.status_code == 200
    return response.json()["data"]


def save_check(client, opp_id, item_id, eval_id, checked, staff="park-lee"):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/review-items/{item_id}/check",
        json={"checked": checked, "evalId": eval_id},
        headers={"X-Staff-Key": staff},
    )


def test_review_items_are_stable_and_reads_do_not_write(records_env):
    """Given 평가 / When 상세 두 번 조회 / Then 안정 ID와 확인 전 값은 같고 체크 행은 없다."""
    client, opp_id = records_env
    first = detail(client, opp_id)
    second = detail(client, opp_id)
    assert first["reviewItems"] and first["reviewItems"] == second["reviewItems"]
    assert len({x["itemId"] for x in first["reviewItems"]}) == len(first["reviewItems"])
    assert all(
        not x["checked"] and x["checkedBy"] is None and x["checkedAt"] is None
        for x in first["reviewItems"]
    )
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)) is None


def test_check_and_uncheck_append_history_and_keep_scores(records_env):
    """Given 확인 전 항목 / When 체크·해제 / Then 두 이력·담당자·본 평가가 남고 점수는 그대로다."""
    client, opp_id = records_env
    before = detail(client, opp_id)
    item_id = before["reviewItems"][0]["itemId"]
    first = save_check(client, opp_id, item_id, before["evalId"], True)
    second = save_check(client, opp_id, item_id, before["evalId"], False, staff="kim-gwajang")
    assert first.status_code == second.status_code == 200
    after = detail(client, opp_id)
    item = next(x for x in after["reviewItems"] if x["itemId"] == item_id)
    assert item["checked"] is False and item["checkedBy"] == "kim-gwajang"
    assert item["checkedAt"] == second.json()["data"]["checkedAt"]
    assert after["scores"] == before["scores"]
    with session_scope() as session:
        rows = session.scalars(select(ReviewCheck).where(ReviewCheck.opp_id == opp_id)).all()
        assert len(rows) == 2
        assert {r.checked for r in rows} == {True, False}
        assert {r.eval_id for r in rows} == {before["evalId"]}
        assert {r.staff_key for r in rows} == {"park-lee", "kim-gwajang"}


def test_derive_five_sources_and_question_target_labels(records_env):
    """Given 가상 검색 실패·질문·판정 입력 / When 파생 / Then 다섯 종류와 질문 대상이 맞다."""
    client, opp_id = records_env
    data = OpportunityDetail.model_validate(detail(client, opp_id))
    data.header.homepage_status = "NOT_FOUND"
    data.evidence = []
    data.reasons.questions = [
        Question(
            question_id=f"question-{target}",
            target_kind=target,
            target_id="virtual",
            text=f"가상 {target} 확인 질문",
            effect_if_answered="확인 범위 갱신",
            status="WAITING",
        )
        for target in [
            "OPPORTUNITY",
            "REQUIREMENT",
            "QUALIFICATION",
            "PROCESS",
            "CAPABILITY",
            "FIELD",
        ]
    ]
    data.scores.items = [
        row.model_copy(update={"state": state})
        for row, state in zip(data.scores.items[:2], ["NO_SIGNAL", "UNAVAILABLE"], strict=True)
    ]
    data.requirements = [data.requirements[0].model_copy(update={"result": "QUESTION_NEEDED"})]
    items = {item.item_id: item for item in derive_review_items(data)}
    assert items["GAP:HOMEPAGE"].kind == "DATA_NOT_FOUND"
    assert items["GAP:HOMEPAGE"].source == "AI"
    assert items["GAP:EVIDENCE"].kind == "DATA_NOT_FOUND"
    assert items["GAP:EVIDENCE"].source == "RULE"
    for score in data.scores.items:
        assert items[f"GAP:ITEM:{score.item_code}"].kind == "DATA_INSUFFICIENT"
        assert score.label in items[f"GAP:ITEM:{score.item_code}"].text
    assert items[f"GAP:REQ:{data.requirements[0].req_id}"].kind == "DATA_INSUFFICIENT"
    for question in data.reasons.questions:
        item = items[f"Q:{question.question_id}"]
        assert item.text == question.text and item.source == "RULE"
        assert item.target_label == (
            "상대 회사" if question.target_kind in {"OPPORTUNITY", "REQUIREMENT"} else "거산"
        )
    assert "GAP:HOMEPAGE" not in {
        x.item_id
        for x in derive_review_items(OpportunityDetail.model_validate(detail(client, opp_id)))
    }
    data.header.homepage_status = "AI_FOUND"
    data.scores = None
    data.requirements = []
    assert not any(x.item_id.startswith("GAP:ITEM:") for x in derive_review_items(data))
    assert "GAP:HOMEPAGE" not in {x.item_id for x in derive_review_items(data)}


@pytest.mark.parametrize("staff", ["viewer", "unknown", ""])
def test_forbidden_staff_cannot_append_checks(records_env, staff):
    """Given 보기 전용·없는 담당자 / When 체크 / Then 권한 거부이며 행을 저장하지 않는다."""
    client, opp_id = records_env
    data = detail(client, opp_id)
    response = save_check(
        client, opp_id, data["reviewItems"][0]["itemId"], data["evalId"], True, staff
    )
    assert response.status_code == 403
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)) is None


@pytest.mark.parametrize(
    "body",
    [
        {"checked": "true", "evalId": "invalid"},
        {"checked": True},
        {"checked": 1, "evalId": "invalid"},
        {"checked": True, "evalId": ""},
        {"checked": True, "evalId": "invalid", "checkedBy": "someone"},
    ],
)
def test_invalid_check_body_cannot_write(records_env, body):
    client, opp_id = records_env
    data = detail(client, opp_id)
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/review-items/{data['reviewItems'][0]['itemId']}/check",
        json=body,
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 400
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)) is None


def test_missing_item_opportunity_and_evaluation_are_rejected(records_env):
    client, opp_id = records_env
    data = detail(client, opp_id)
    item_id = data["reviewItems"][0]["itemId"]
    assert save_check(client, "missing", item_id, data["evalId"], True).status_code == 404
    assert save_check(client, opp_id, "missing", data["evalId"], True).status_code == 404
    assert save_check(client, opp_id, item_id, "missing", True).status_code == 400
    with session_scope() as session:
        evaluation = session.get(EvaluationRun, data["evalId"])
        evaluation.run_status = "DRAFT"
    assert save_check(client, opp_id, item_id, data["evalId"], True).status_code == 400
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)) is None


def test_latest_insert_wins_even_when_timestamps_match(records_env):
    """Given 같은 시각 이력 / When 상세 조회 / Then 마지막 저장 담당자·체크값을 쓴다."""
    client, opp_id = records_env
    data = detail(client, opp_id)
    item_id = data["reviewItems"][0]["itemId"]
    assert save_check(client, opp_id, item_id, data["evalId"], True).status_code == 200
    assert (
        save_check(client, opp_id, item_id, data["evalId"], False, "kim-gwajang").status_code == 200
    )
    with session_scope() as session:
        for row in session.scalars(select(ReviewCheck)):
            row.created_at = datetime(2026, 11, 3, tzinfo=UTC)
    item = next(x for x in detail(client, opp_id)["reviewItems"] if x["itemId"] == item_id)
    assert item["checked"] is False and item["checkedBy"] == "kim-gwajang"


def test_reevaluation_keeps_check_and_records_the_evaluation_seen(records_env):
    """Given 이전에 본 평가 / When 재평가 후 같은 항목 체크 / Then 본 평가 ID를 정확히 남긴다."""
    client, opp_id = records_env
    before = detail(client, opp_id)
    item_id = before["reviewItems"][0]["itemId"]
    assert run_evaluation().ok
    current = detail(client, opp_id)
    assert current["evalId"] != before["evalId"]
    assert save_check(client, opp_id, item_id, before["evalId"], True).status_code == 200
    after = detail(client, opp_id)
    assert next(x for x in after["reviewItems"] if x["itemId"] == item_id)["checked"] is True
    assert after["scores"] == current["scores"]
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)).eval_id == before["evalId"]


def test_save_failure_keeps_history_without_retry(records_env, request_logs):
    """Given 기존 체크 / When 최종 저장 실패 / Then 기존 행 보존·재시도 없음·오류 원문 숨김."""
    client, opp_id = records_env
    data = detail(client, opp_id)
    item_id = data["reviewItems"][0]["itemId"]
    assert save_check(client, opp_id, item_id, data["evalId"], True).status_code == 200
    attempts = []

    def fail_commit(session):
        assert session.scalar(select(func.count()).select_from(ReviewCheck)) == 2
        attempts.append("commit")
        raise RuntimeError("review-check-private-error")

    def failing_session():
        with session_scope() as session:
            event.listen(session, "before_commit", fail_commit)
            yield session

    client.app.dependency_overrides[get_session] = failing_session
    try:
        response = save_check(client, opp_id, item_id, data["evalId"], False)
    finally:
        client.app.dependency_overrides.pop(get_session)
    assert response.status_code == 500 and attempts == ["commit"]
    assert "review-check-private-error" not in response.text
    assert "review-check-private-error" not in request_logs.getvalue()
    with session_scope() as session:
        rows = session.scalars(select(ReviewCheck)).all()
        assert len(rows) == 1 and rows[0].checked is True
    assert next(x for x in detail(client, opp_id)["reviewItems"] if x["itemId"] == item_id)[
        "checked"
    ]


def test_concurrent_checks_both_append_and_last_insert_is_visible(records_env):
    client, opp_id = records_env
    data = detail(client, opp_id)
    item_id = data["reviewItems"][0]["itemId"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(save_check, client, opp_id, item_id, data["evalId"], value, staff)
            for value, staff in [(True, "park-lee"), (False, "kim-gwajang")]
        ]
        assert [f.result().status_code for f in futures] == [200, 200]
    with session_scope() as session:
        rows = session.scalars(select(ReviewCheck).order_by(literal_column("rowid"))).all()
        assert len(rows) == 2
        last_value, last_staff = rows[-1].checked, rows[-1].staff_key
    item = next(x for x in detail(client, opp_id)["reviewItems"] if x["itemId"] == item_id)
    assert (item["checked"], item["checkedBy"]) == (last_value, last_staff)


def test_removed_item_is_not_checkable_and_history_is_retained(records_env):
    """Given 근거 없음 체크 / When 근거가 다시 보임 / Then 항목은 사라져도 체크 이력은 남는다."""
    client, opp_id = records_env
    with session_scope() as session:
        for row in session.scalars(select(Evidence).where(Evidence.opp_id == opp_id)):
            row.security_grade = "FORBIDDEN"
    data = detail(client, opp_id)
    assert any(x["itemId"] == "GAP:EVIDENCE" for x in data["reviewItems"])
    assert save_check(client, opp_id, "GAP:EVIDENCE", data["evalId"], True).status_code == 200
    with session_scope() as session:
        for row in session.scalars(select(Evidence).where(Evidence.opp_id == opp_id)):
            row.security_grade = "PUBLIC"
    assert not any(x["itemId"] == "GAP:EVIDENCE" for x in detail(client, opp_id)["reviewItems"])
    assert save_check(client, opp_id, "GAP:EVIDENCE", data["evalId"], False).status_code == 404
    with session_scope() as session:
        rows = session.scalars(select(ReviewCheck)).all()
        assert len(rows) == 1 and rows[0].checked is True


def test_other_opportunity_cannot_share_check_or_evaluation(records_env, tmp_path):
    client, opp_id = records_env
    first = detail(client, opp_id)
    item_id = next(x["itemId"] for x in first["reviewItems"] if x["itemId"].startswith("GAP:ITEM:"))
    case = factories.apjeong_renamed_customer("review-other", name="가상검토2")
    case["customer"]["bizNumber"] = None
    other_id = import_case(_write(tmp_path, "other-review.json", case)).opp_id
    assert run_evaluation().ok
    other = detail(client, other_id)
    assert save_check(client, opp_id, item_id, first["evalId"], True).status_code == 200
    assert (
        next(x for x in detail(client, other_id)["reviewItems"] if x["itemId"] == item_id)[
            "checked"
        ]
        is False
    )
    assert save_check(client, opp_id, item_id, other["evalId"], False).status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ReviewCheck)) == 1


def test_review_table_rollback_and_upgrade_preserve_existing_notes(records_env, tmp_db):
    client, opp_id = records_env
    assert (
        client.post(
            f"/api/v1/opportunities/{opp_id}/notes",
            json={"text": "보존할 가상 메모"},
            headers={"X-Staff-Key": "park-lee"},
        ).status_code
        == 200
    )
    assert downgrade(tmp_db, "opp_005") == ["opp_005"]
    assert upgrade_to_head(tmp_db) == ["rec_010"]
    with session_scope() as session:
        assert session.scalar(select(Note)).text == "보존할 가상 메모"
        assert session.scalar(select(ReviewCheck)) is None
