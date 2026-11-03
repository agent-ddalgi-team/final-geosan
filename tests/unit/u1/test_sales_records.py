"""#209: 가상 입력을 실제 SQLite와 API로 저장·조회한다."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.models import AppSetting
from geosan.opportunity.importer import import_case
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
    "kind,body", [("notes", {"text": "가상 메모"}), ("outcomes", {"status": "INTERESTED"})]
)
def test_staff_permissions_and_missing_opportunity(records_env, kind, body):
    """Given 보기 전용·없는 기회 / When 저장 / Then 권한·존재 오류로 거부한다."""
    client, opp_id = records_env
    assert post(client, opp_id, kind, body, "viewer").status_code == 403
    assert post(client, opp_id, kind, body, "unknown").status_code == 403
    assert client.post(f"/api/v1/opportunities/{opp_id}/{kind}", json=body).status_code == 403
    assert post(client, "missing", kind, body).status_code == 404


def test_outcomes_keep_history_and_filter_latest_stage_without_changing_score(records_env):
    """Given 미접촉 기회 / When 관심→접촉 기록 / Then 이력·일정 유지, 최신 단계만 거른다."""
    client, opp_id = records_env
    detail_url = f"/api/v1/opportunities/{opp_id}"
    before = client.get(detail_url).json()["data"]["scores"]
    assert client.get("/api/v1/opportunities?stage=NOT_EXECUTED").json()["meta"]["total"] == 1
    first = post(
        client,
        opp_id,
        "outcomes",
        {
            "status": "INTERESTED",
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
            "status": "IN_PROGRESS",
            "expectedVersion": 0,
            "method": "CALL",
            "result": "ABSENT",
            "attemptedAt": "2026-11-05",
        },
    )
    assert second.status_code == 200
    assert second.json()["meta"]["previousValue"]["status"] == "INTERESTED"
    assert client.get("/api/v1/opportunities?stage=INTERESTED").json()["meta"]["total"] == 0
    assert client.get("/api/v1/opportunities?stage=IN_PROGRESS").json()["meta"]["total"] == 1
    after = client.get(detail_url).json()["data"]
    assert after["scores"] == before
    assert after["records"]["outcome"]["nextScheduleAt"] == "2026-11-12"
    with session_scope() as session:
        rows = session.scalars(select(Outcome).order_by(Outcome.version)).all()
        assert [r.status for r in rows] == ["INTERESTED", "IN_PROGRESS"]
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
        {"status": "INTERESTED", "method": "PHONE"},
        {"status": "INTERESTED", "result": "CONNECTED"},
        {"status": "INTERESTED", "attemptedAt": "날짜 아님"},
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
