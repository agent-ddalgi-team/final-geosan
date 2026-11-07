"""#209: 가상 입력을 실제 SQLite와 API로 저장·조회한다."""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from io import StringIO

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select

from geosan.api.app import JsonFormatter, create_app
from geosan.api.deps import get_session
from geosan.capability.importer import import_capability
from geosan.config.models import AppSetting
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note, Outcome
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


@pytest.fixture
def records_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    result = import_case(_write(tmp_path, "case.json", factories.apjeong_case()))
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, result.opp_id


def post(client, opp_id, kind, body, staff="park-lee"):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/{kind}", json=body, headers={"X-Staff-Key": staff}
    )


@pytest.mark.parametrize("enabled,limit", [(False, 200), (True, 80)])
def test_config_ui_returns_current_record_settings(records_env, enabled, limit):
    """Given 승인 표시·메모 상한 설정 / When 화면 설정 조회 / Then 현재 설정만 돌려준다."""
    client, _ = records_env
    with session_scope() as session:
        session.get(AppSetting, "records").value = {
            "approvalEnabled": enabled,
            "noteMaxLength": limit,
        }
    response = client.get("/api/v1/config/ui")
    assert response.status_code == 200
    assert response.json()["data"]["records"] == {
        "approvalEnabled": enabled,
        "noteMaxLength": limit,
    }


def set_test_phone(opp_id, phone="041-000-0000"):
    """가상 대표번호만 넣는다. 실제 연락처는 사용하지 않는다."""
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id)
        customer.main_phone = phone
        customer.main_phone_source = "HOMEPAGE"
        customer.main_phone_source_url = "https://example.invalid/company"


def test_phone_confirmation_and_source_are_visible_without_activity(records_env):
    """Given 공개 대표번호 / When 담당자 확인 / Then 번호는 그대로·확인 정보만 저장된다."""
    client, opp_id = records_env
    set_test_phone(opp_id)
    url = f"/api/v1/opportunities/{opp_id}"
    before = client.get(url).json()["data"]["header"]
    assert before["mainPhoneSourceUrl"] == "https://example.invalid/company"
    assert before["mainPhoneConfirmedAt"] is None
    response = post(client, opp_id, "main-phone/confirm", {"expectedPhone": "041-000-0000"})
    assert response.status_code == 200
    confirmed = response.json()["data"]
    after = client.get(url).json()["data"]["header"]
    assert after["mainPhone"] == before["mainPhone"] == confirmed["mainPhone"]
    assert after["mainPhoneConfirmedBy"] == confirmed["mainPhoneConfirmedBy"] == "park-lee"
    assert after["mainPhoneConfirmedAt"] == confirmed["mainPhoneConfirmedAt"]
    assert after["mainPhoneConfirmedAt"] is not None
    assert client.get(url + "/activity").json()["data"] == []


def test_phone_missing_changed_and_forbidden_do_not_confirm(records_env):
    """Given 번호 없음·바뀜·담당자 아님 / When 확인 / Then 오류이며 확인 정보는 안 남는다."""
    client, opp_id = records_env
    body = {"expectedPhone": "041-000-0000"}
    assert post(client, opp_id, "main-phone/confirm", body).status_code == 404
    assert post(client, "missing", "main-phone/confirm", body).status_code == 404
    set_test_phone(opp_id, "041-000-0001")
    stale = post(client, opp_id, "main-phone/confirm", body)
    assert stale.status_code == 409 and stale.json()["error"]["kind"] == "STALE_VALUE"
    assert body["expectedPhone"] not in stale.text and "041-000-0001" not in stale.text
    body = {"expectedPhone": "041-000-0001"}
    assert post(client, opp_id, "main-phone/confirm", body, staff="unknown").status_code == 403
    assert post(client, opp_id, "main-phone/confirm", {}).status_code == 400
    assert (
        post(
            client, opp_id, "main-phone/confirm", {**body, "mainPhone": "041-000-0002"}
        ).status_code
        == 400
    )
    header = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["header"]
    assert header["mainPhone"] == "041-000-0001"
    assert header["mainPhoneConfirmedAt"] is None


def test_phone_commit_failure_preserves_confirmation_and_hides_input(records_env, request_logs):
    """Given 대표번호 / When 저장 실패 / Then 확인을 남기거나 재시도하지 않고 번호를 숨긴다."""
    client, opp_id = records_env
    set_test_phone(opp_id)
    attempts = []

    def fail_commit(session):
        attempts.append("commit")
        raise RuntimeError("가상 DB 오류 041-000-0000")

    def failing_session():
        with session_scope() as session:
            event.listen(session, "before_commit", fail_commit)
            yield session

    client.app.dependency_overrides[get_session] = failing_session
    try:
        response = post(client, opp_id, "main-phone/confirm", {"expectedPhone": "041-000-0000"})
    finally:
        client.app.dependency_overrides.pop(get_session)
    assert response.status_code == 500 and attempts == ["commit"]
    assert "041-000-0000" not in response.text
    assert "041-000-0000" not in request_logs.getvalue()
    header = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["header"]
    assert header["mainPhoneConfirmedAt"] is None
    assert header["mainPhoneConfirmedBy"] is None


def test_note_kind_defaults_and_research_are_persisted(records_env):
    """Given 메모·자료 조사 / When 저장 / Then 종류와 이력을 보존하고 잘못된 종류는 거부한다."""
    client, opp_id = records_env
    assert post(client, opp_id, "notes", {"text": "가상 메모"}).status_code == 200
    assert (
        post(
            client, opp_id, "notes", {"text": "가상 공개 자료 확인", "kind": "RESEARCH"}
        ).status_code
        == 200
    )
    assert post(client, opp_id, "notes", {"text": "잘못된 종류", "kind": "CALL"}).status_code == 400
    with session_scope() as session:
        notes = session.scalars(
            select(Note).where(Note.opp_id == opp_id).order_by(Note.version)
        ).all()
        assert [(row.kind, row.text, row.version) for row in notes] == [
            ("MEMO", "가상 메모", 1),
            ("RESEARCH", "가상 공개 자료 확인", 2),
        ]
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    assert any(row["summary"] == "자료 조사 · 가상 공개 자료 확인" for row in activity)
    assert all(row["kind"] == "NOTE" for row in activity)


def test_contact_counts_include_attempt_history_only(records_env):
    """Given 접촉·단계·메모·조사 / When 상세·목록 조회 / Then 접촉 시도만 전부 센다."""
    client, opp_id = records_env
    url = f"/api/v1/opportunities/{opp_id}"
    assert client.get(url).json()["data"]["records"]["contactCount"] == {
        "total": 0,
        "call": 0,
        "email": 0,
        "visit": 0,
    }
    for method in ("CALL", "CALL", "EMAIL", "VISIT"):
        assert (
            post(
                client,
                opp_id,
                "outcomes",
                {
                    "status": "IN_PROGRESS",
                    "method": method,
                    "result": "ABSENT",
                    "attemptedAt": "2026-11-03",
                },
            ).status_code
            == 200
        )
    assert post(client, opp_id, "outcomes", {"status": "ON_HOLD"}).status_code == 200
    for kind in ("MEMO", "RESEARCH"):
        assert post(client, opp_id, "notes", {"kind": kind, "text": "가상 기록"}).status_code == 200
    assert client.get(url).json()["data"]["records"]["contactCount"] == {
        "total": 4,
        "call": 2,
        "email": 1,
        "visit": 1,
    }
    cards = client.get("/api/v1/opportunities").json()["data"]
    assert next(row for row in cards if row["oppId"] == opp_id)["contactCount"] == 4


def test_existing_notes_survive_kind_migration(records_env, tmp_db):
    """Given 이전 메모 / When 새 열 마이그레이션 / Then 기존 메모는 MEMO이고 내용은 그대로다."""
    from geosan.storage.migrate import downgrade, upgrade_to_head

    client, opp_id = records_env
    assert post(client, opp_id, "notes", {"text": "이전 가상 메모"}).status_code == 200
    assert downgrade(tmp_db, "rec_004") == ["rec_004", "web_001"]
    assert upgrade_to_head(tmp_db) == ["rec_008"]
    with session_scope() as session:
        note = session.scalar(select(Note).where(Note.opp_id == opp_id))
        assert (note.kind, note.text, note.version) == ("MEMO", "이전 가상 메모", 1)


@pytest.fixture
def request_logs(records_env):
    """실제 요청 로그를 운영용 JSON 형식으로 수집한다."""
    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("geosan")
    logger.addHandler(handler)
    try:
        yield stream
    finally:
        logger.removeHandler(handler)
        handler.close()


@pytest.mark.parametrize("mode", ["success", "length_error", "type_error"])
def test_note_request_logs_and_errors_hide_contact(records_env, request_logs, mode):
    """Given 가상 연락처 / When 저장·길이·형식 검사 / Then 로그·응답에 원문이 없다."""
    client, opp_id = records_env
    contact = "private-note@example.invalid"
    text = f"가상 연락처 {contact}"
    body = {"text": text}
    if mode == "length_error":
        with session_scope() as session:
            session.get(AppSetting, "records").value = {
                "approvalEnabled": False,
                "noteMaxLength": 5,
            }
    elif mode == "type_error":
        body = {"text": {"private": text}}
    response = post(client, opp_id, "notes", body)
    expected_status = 200 if mode == "success" else 400
    assert response.status_code == expected_status
    logs = [json.loads(line) for line in request_logs.getvalue().splitlines()]
    assert any(row["event"] == "http.request" and row["status"] == expected_status for row in logs)
    assert contact not in request_logs.getvalue()
    assert contact not in response.text
    if mode != "success":
        assert response.json()["error"]["fields"][0]["path"] == "text"
    with session_scope() as session:
        rows = list(session.scalars(select(Note)))
        assert len(rows) == (1 if mode == "success" else 0)
        if rows:
            assert rows[0].text == text


@pytest.mark.parametrize(
    "kind,model,initial,update",
    [
        ("notes", Note, {"text": "보존할 가상 메모"}, {"text": "private-note@example.invalid"}),
        (
            "outcomes",
            Outcome,
            {"status": "IN_PROGRESS"},
            {"status": "SAMPLE_OR_REGISTRATION_APPROVED"},
        ),
    ],
)
def test_record_commit_failure_rolls_back_without_retry(
    records_env, request_logs, kind, model, initial, update
):
    """Given 기존 기록 / When 최종 DB 저장 실패 / Then 이력 보존·재시도 없음·안전한 오류."""
    client, opp_id = records_env
    assert post(client, opp_id, kind, initial).status_code == 200
    with session_scope() as session:
        original = session.execute(select(model.__table__)).all()
    attempts = []
    private_error = "가상 DB 오류 private-note@example.invalid"

    def fail_commit(session):
        # INSERT가 실제 SQLite에 반영된 뒤 COMMIT 직전에 실패시킨다.
        assert session.scalar(select(func.count()).select_from(model)) == 2
        attempts.append("commit")
        raise RuntimeError(private_error)

    def failing_session():
        with session_scope() as session:
            event.listen(session, "before_commit", fail_commit)
            yield session

    client.app.dependency_overrides[get_session] = failing_session
    try:
        response = post(client, opp_id, kind, update)
    finally:
        client.app.dependency_overrides.pop(get_session)
    assert response.status_code == 500
    error = response.json()["error"]
    assert {"message", "nextAction", "ref"} <= error.keys()
    assert error["ref"]
    assert attempts == ["commit"]
    logs = [json.loads(line) for line in request_logs.getvalue().splitlines()]
    assert any(row["event"] == "http.failed" and row["ref"] == error["ref"] for row in logs)
    assert any(row["event"] == "http.request" and row["status"] == 500 for row in logs)
    for private in (private_error, "private-note@example.invalid"):
        assert private not in response.text
        assert private not in request_logs.getvalue()
    with session_scope() as session:
        assert session.execute(select(model.__table__)).all() == original
    recovered = post(client, opp_id, kind, update)
    assert recovered.status_code == 200
    assert recovered.json()["data"]["version"] == 2
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(model)) == 2


def test_notes_append_and_contacts_stay_in_activity(records_env):
    """Given 가상 연락처 메모 / When 두 번 저장 / Then 두 행·담당자·시각이 남는다."""
    client, opp_id = records_env
    text = "가상 메모: sales@example.invalid"
    first = post(client, opp_id, "notes", {"text": text})
    second = post(client, opp_id, "notes", {"text": "다음 상담 준비"}, "kim-gwajang")
    assert first.status_code == second.status_code == 200
    assert second.json()["data"]["version"] == 2
    assert first.json()["data"]["noteId"] != second.json()["data"]["noteId"]
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    notes = [item for item in activity if item["kind"] == "NOTE"]
    assert [item["summary"] for item in notes] == ["다음 상담 준비", text]
    assert notes[0]["actor"] == "kim-gwajang"
    assert notes[0]["at"]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Note)) == 2
    for endpoint in (f"/api/v1/opportunities/{opp_id}", "/api/v1/opportunities"):
        assert text not in client.get(endpoint).text


def test_note_length_comes_from_config_and_rejection_writes_nothing(records_env):
    """Given 상한 5자 / When 5자·6자 저장 / Then 경계 안만 저장한다."""
    client, opp_id = records_env
    with session_scope() as session:
        session.get(AppSetting, "records").value = {"approvalEnabled": False, "noteMaxLength": 5}
    assert post(client, opp_id, "notes", {"text": "가나다라마"}).status_code == 200
    response = post(client, opp_id, "notes", {"text": "가나다라마바"})
    assert response.status_code == 400
    assert response.json()["error"]["fields"][0]["path"] == "text"
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Note)) == 1


@pytest.mark.parametrize(
    "kind,body", [("notes", {"text": "가상 메모"}), ("outcomes", {"status": "IN_PROGRESS"})]
)
def test_staff_permissions_and_missing_opportunity(records_env, kind, body):
    """Given 보기 전용·없는 기회 / When 저장 / Then 권한·존재 오류로 거부한다."""
    client, opp_id = records_env
    assert post(client, opp_id, kind, body, "viewer").status_code == 403
    assert post(client, opp_id, kind, body, "unknown").status_code == 403
    assert client.post(f"/api/v1/opportunities/{opp_id}/{kind}", json=body).status_code == 403
    assert post(client, "missing", kind, body).status_code == 404


def test_outcomes_keep_history_and_filter_latest_stage_without_changing_score(records_env):
    """Given 미접촉 기회 / When 접촉→견적·샘플 기록 / Then 이력·일정 유지, 최신 단계만 거른다."""
    client, opp_id = records_env
    detail_url = f"/api/v1/opportunities/{opp_id}"
    before = client.get(detail_url).json()["data"]["scores"]
    assert client.get("/api/v1/opportunities?stage=NOT_EXECUTED").json()["meta"]["total"] == 1
    first = post(
        client,
        opp_id,
        "outcomes",
        {
            "status": "IN_PROGRESS",
            "nextScheduleAt": "2026-11-12",
            "nextScheduleNote": "견적 준비",
        },
    )
    assert first.status_code == 200
    second = post(
        client,
        opp_id,
        "outcomes",
        {
            "status": "SAMPLE_OR_REGISTRATION_APPROVED",
            "expectedVersion": 0,
            "method": "CALL",
            "result": "ABSENT",
            "attemptedAt": "2026-11-05",
        },
    )
    assert second.status_code == 200
    assert second.json()["meta"]["previousValue"]["status"] == "IN_PROGRESS"
    assert client.get("/api/v1/opportunities?stage=IN_PROGRESS").json()["meta"]["total"] == 0
    stage_url = "/api/v1/opportunities?stage=SAMPLE_OR_REGISTRATION_APPROVED"
    assert client.get(stage_url).json()["meta"]["total"] == 1
    after = client.get(detail_url).json()["data"]
    assert after["scores"] == before
    assert after["records"]["outcome"]["nextScheduleAt"] == "2026-11-12"
    assert after["records"]["outcome"]["nextScheduleNote"] == "견적 준비"
    with session_scope() as session:
        rows = session.scalars(select(Outcome).order_by(Outcome.version)).all()
        assert [r.status for r in rows] == ["IN_PROGRESS", "SAMPLE_OR_REGISTRATION_APPROVED"]
        assert rows[1].next_schedule_note == "견적 준비"
        assert rows[1].method == "CALL" and rows[1].result == "ABSENT"
    activities = client.get(f"{detail_url}/activity?limit=1").json()["data"]
    assert len(activities) == 1 and activities[0]["kind"] == "CONTACT_ATTEMPT"
    assert "전화 부재" in activities[0]["summary"]


@pytest.mark.parametrize(
    "body",
    [
        {"status": "LOST"},
        {"status": "LOST", "reason": " "},
        {"status": "UNKNOWN"},
        {"status": "IN_PROGRESS", "method": "PHONE"},
        {"status": "IN_PROGRESS", "result": "CONNECTED"},
        {"status": "IN_PROGRESS", "attemptedAt": "날짜 아님"},
    ],
)
def test_invalid_outcomes_do_not_write(records_env, body):
    """Given 잘못된 입력 / When 기록 저장 / Then 400이며 DB에 남지 않는다."""
    client, opp_id = records_env
    assert post(client, opp_id, "outcomes", body).status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0


def test_simultaneous_notes_get_distinct_versions(records_env):
    """Given 동시에 두 메모 / When 저장 / Then 버전이 겹치지 않고 둘 다 남는다."""
    client, opp_id = records_env
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda text: post(client, opp_id, "notes", {"text": text}), ["첫 메모", "둘째 메모"]
            )
        )
    assert all(response.status_code == 200 for response in results)
    assert sorted(response.json()["data"]["version"] for response in results) == [1, 2]
