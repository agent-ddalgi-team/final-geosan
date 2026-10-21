"""S10 의견과 목록·상세 API. DB는 실제 임시 SQLite, 규칙 계산은 개발용 가짜 엔진이다."""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from geosan.api.app import JsonFormatter, create_app
from geosan.api.deps import get_session
from geosan.api.schemas import Scores
from geosan.capability.importer import import_capability
from geosan.evaluation.models import EvaluationRun
from geosan.evidence.models import Evidence
from geosan.opportunity.importer import import_case
from geosan.questions.models import ConfirmationQuestion
from geosan.records.models import ReviewOpinion
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


def test_score_keys_match_uppercase_contract():
    """Given 화면 약속의 대문자 점수 / When 응답 모델 직렬화 / Then E·P·S·R·C를 보존한다."""
    fixture = json.loads(
        (
            factories.EXAMPLES_DIR.parent / "web/src/test/fixtures/opportunity-detail-apjeong.json"
        ).read_text(encoding="utf-8")
    )
    serialized = Scores.model_validate(fixture["data"]["scores"]).model_dump(
        mode="json", by_alias=True
    )
    assert {"E", "P", "S", "R", "C"} <= serialized.keys()


@pytest.fixture
def api_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opportunity = import_case(_write(tmp_path, "case.json", factories.apjeong_case()))
    evaluation = run_evaluation()
    assert evaluation.ok, evaluation.summary
    with TestClient(create_app()) as client:
        yield client, opportunity.opp_id, evaluation.new_eval_ids[0]


def _save(client, opp_id, eval_id, **values):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/opinions",
        headers={"X-Staff-Key": "park-lee"},
        json={"opinion": "WORTH_REVIEW", "evalId": eval_id, **values},
    )


def test_empty_list_and_ui_configuration(tmp_db):
    """Given 아직 평가 없음 / When 목록·화면 설정 조회 / Then 빈 목록과 공개 설정을 준다."""
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities")
        assert response.status_code == 200 and response.json()["data"] == []
        assert response.json()["meta"]["total"] == 0
        config = client.get("/api/v1/config/ui")
        assert config.status_code == 200
        data = config.json()["data"]
        assert len(data["classificationLabels"]) == 11
        assert any(staff["key"] == "park-lee" for staff in data["staff"])
        assert "filePath" not in config.text and "ruleHash" not in config.text


def test_list_keeps_full_rank_and_uses_latest_partial_content(api_env, tmp_path):
    """Given 일부 재평가·새 기회 / When 목록 조회 / Then 원래 순위와 최신 평가를 준다."""
    client, opp_id, original_eval_id = api_env
    latest = run_evaluation([opp_id])
    assert latest.ok
    import_case(_write(tmp_path, "second.json", factories.apjeong_renamed_customer("second")))
    response = client.get("/api/v1/opportunities?pageSize=1")
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1 and body["meta"]["notEvaluatedCount"] == 1
    card = body["data"][0]
    assert card["rank"] == 1 and card["evalId"] == latest.new_eval_ids[0] != original_eval_id
    assert card["reevaluated"] and card["scoreDisplay"] == "81"
    assert client.get("/api/v1/opportunities?page=2&pageSize=1").json()["data"] == []


def test_first_detail_contains_checks_questions_scores_and_hides_forbidden(api_env):
    """Given 첫 평가·금지 자료 / When 상세 조회 / Then 판정·질문을 주고 금지 원문은 뺀다."""
    client, opp_id, eval_id = api_env
    with session_scope() as session:
        evidence = session.scalar(select(Evidence).where(Evidence.opp_id == opp_id))
        evidence.security_grade = "FORBIDDEN"
        evidence.quote = "상세에 나오면 안 되는 가상 표식"
    response = client.get(f"/api/v1/opportunities/{opp_id}")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["requirements"]) == 3 and len(data["reasons"]["questions"]) == 1
    assert data["scores"]["E"] == 77 and len(data["scores"]["items"]) == 8
    assert data["evalId"] == eval_id and not data["reevaluated"]
    assert "상세에 나오면 안 되는" not in response.text
    assert client.get("/api/v1/opportunities/missing").status_code == 404


def test_opinion_history_last_save_wins_without_changing_evaluation(api_env):
    """Given 낡은 평가·버전 / When 의견 수정 / Then 새 이력·이전 값을 주고 평가는 보존한다."""
    client, opp_id, eval_id = api_env
    first = _save(client, opp_id, eval_id)
    assert first.status_code == 200 and first.json()["data"]["version"] == 1
    assert run_evaluation([opp_id]).ok
    second = _save(client, opp_id, eval_id, opinion="NEED_CHECK", expectedVersion=0)
    assert second.status_code == 200 and second.json()["data"]["version"] == 2
    assert second.json()["meta"]["previousValue"]["opinion"] == "WORTH_REVIEW"
    card = client.get("/api/v1/opportunities").json()["data"][0]
    assert card["records"]["opinion"]["opinion"] == "NEED_CHECK"
    assert card["classificationCode"] == "CONTACT_URGENT"
    with session_scope() as session:
        rows = list(session.scalars(select(ReviewOpinion).order_by(ReviewOpinion.version)))
        assert len(rows) == 2 and rows[1].previous_opinion_id == rows[0].opinion_id
        assert rows[1].eval_id == eval_id
        assert session.get(EvaluationRun, eval_id).score_e == 77
        assert session.scalar(select(func.count()).select_from(ConfirmationQuestion)) == 1


def test_staff_missing_unknown_and_viewer_are_forbidden(api_env):
    """Given 담당자 키 없음·목록 밖·보기 전용 / When 의견 저장 / Then 세 경우 모두 403이다."""
    client, opp_id, eval_id = api_env
    for key in (None, "unknown-staff", "viewer"):
        response = client.post(
            f"/api/v1/opportunities/{opp_id}/opinions",
            headers={"X-Staff-Key": key} if key else {},
            json={"opinion": "WORTH_REVIEW", "evalId": eval_id},
        )
        assert response.status_code == 403
        assert {"message", "nextAction", "ref"} <= response.json()["error"].keys()
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ReviewOpinion)) == 0


def test_invalid_opinions_never_store_rows(api_env, tmp_path):
    """Given 잘못된 의견 입력 / When 저장 요청 / Then 칸별 오류 400이며 저장하지 않는다."""
    client, opp_id, eval_id = api_env
    other = import_case(
        _write(tmp_path, "second.json", factories.apjeong_renamed_customer("second"))
    )
    cases = [
        ({"opinion": "NOT_TARGET"}, "reason"),
        ({"memo": "가상 연락처 sales@example.invalid"}, "memo"),
        ({"reason": "가상 전화 010-0000-0000"}, "reason"),
        ({"unknown": True}, "unknown"),
        ({"evalId": "missing"}, "evalId"),
    ]
    for values, field in cases:
        response = _save(client, opp_id, eval_id, **values)
        assert response.status_code == 400, response.text
        assert field in [item["path"] for item in response.json()["error"]["fields"]]
    response = _save(client, other.opp_id, eval_id)
    assert response.status_code == 400
    assert client.get("/api/v1/opportunities?pageSize=51").status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ReviewOpinion)) == 0


def test_body_limit_and_log_formatter_do_not_disclose_text():
    """Given 큰 본문·민감 로그 / When 경계 검사 / Then DB 전에 거부하고 로그에서 가린다."""
    with TestClient(create_app()) as client:
        response = client.post(
            "/api/v1/opportunities/missing/opinions",
            content=b"x" * (64 * 1024 + 1),
            headers={"Content-Length": "1", "Content-Type": "application/json"},
        )
        assert response.status_code == 400
        assert response.json()["error"]["fields"][0]["path"] == "body"
        malformed = client.post(
            "/api/v1/opportunities/missing/opinions",
            content="{",
            headers={"Content-Type": "application/json"},
        )
        assert malformed.status_code == 400
    record = logging.LogRecord("geosan", logging.INFO, "", 0, "가상 원문", (), None)
    record.memo = "가상 원문"
    record.key = "가상 키"
    log = json.loads(JsonFormatter().format(record))
    assert "가상 원문" not in json.dumps(log, ensure_ascii=False)
    assert log["memo"] == log["key"] == "[redacted]"


def test_unexpected_database_failure_returns_safe_error():
    """Given 가짜 DB 실패 / When 오류 경계 검사 / Then 오류 원문 없이 500·대조 번호를 준다."""
    app = create_app()

    def broken_session():
        raise RuntimeError("응답하면 안 되는 가상 비밀")

    app.dependency_overrides[get_session] = broken_session
    with TestClient(app) as client:
        response = client.get("/api/v1/opportunities")
        assert response.status_code == 500
        assert "응답하면 안 되는" not in response.text
        error = response.json()["error"]
        assert {"message", "nextAction", "ref"} <= error.keys() and len(error["ref"]) == 8
