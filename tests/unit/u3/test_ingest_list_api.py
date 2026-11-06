"""#317 실제 임시 DB와 API로 회차 진행·새 후보의 목록 표시를 확인한다."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1 import test_api_routes as support
from tests.unit.u1.test_snapshot_ledger import _write

api_env = support.api_env
PATH = "/api/v1/opportunities"
NOW = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)


def save_batch(batch_id="find-latest", **overrides):
    values = dict(
        batch_id=batch_id,
        source_id="kicox-factory-csv",
        requested_by="park-lee",
        started_at=NOW,
        status="DONE",
        dataset_kind="VIRTUAL_REVIEWED",
        is_virtual=True,
        criteria={"processCodes": ["ANODIZING"], "regions": ["충남"], "industries": []},
    )
    values.update(overrides)
    with session_scope() as session:
        session.add(IngestBatch(**values))
    return batch_id


def listed(client, **params):
    response = client.get(PATH, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def add_candidate(tmp_path, key, *, batch_id="find-latest", fit="HIGH", own=False, offset=0):
    case = factories.apjeong_renamed_customer(key, f"가상후보 {key}")
    opp_id = import_case(_write(tmp_path, f"{key}.json", case)).opp_id
    assert run_evaluation(opp_ids=[opp_id]).ok
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id)
        customer.ingest_batch_id = batch_id
        customer.ingested_at = NOW + timedelta(seconds=offset)
        customer.discovery_source = "WEB_SEARCH"
        customer.discovery_source_url = "https://example.com/candidate"
        customer.registry_status = "NOT_FOUND"
        customer.fit_level = fit
        customer.pick_reason = "알루미늄 부품을 생산해 아노다이징 공정 확인이 필요함"
        customer.own_plating_line_suspected = own
        customer.own_plating_line_basis = "홈페이지에 자체 도금 설비가 표시됨" if own else None
        run = latest_confirmed_evaluation(session, opp_id)
        # 점수 입력 제안 전 상태를 재현한다. 기존 A정밀의 기대값은 바꾸지 않는다.
        run.score_s = None
        run.score_display = "--"
    return opp_id


def test_progress_is_available_without_any_evaluation(tmp_db):
    """Given 평가 없음 / When 목록 조회 / Then 실제 회차 조건과 진행 건수를 제공한다."""
    save_batch(
        status="RUNNING",
        scanned_count=123,
        judged_count=20,
        picked_count=7,
        judge_pending_count=103,
        research_done_count=2,
        new_count=5,
        merge_candidate_count=1,
        web_search_used=True,
        web_candidate_count=4,
        web_dropped_count=2,
        web_from_cache=True,
        web_skipped_reason="DAILY_LIMIT",
        complex_list_skipped_reason="SOURCE_ERROR",
    )
    with TestClient(create_app()) as client:
        body = listed(client)
    assert body["data"] == [] and body["meta"]["total"] == 0
    progress = body["meta"]["latestIngest"]
    assert progress["status"] == "RUNNING" and progress["finishedAt"] is None
    assert progress["scannedCount"] == 123 and progress["judgedCount"] == 20
    assert progress["pickedCount"] == 7 and progress["judgePendingCount"] == 103
    assert progress["researchDoneCount"] == 2 and progress["newCount"] == 5
    assert progress["mergeCandidateCount"] == 1 and progress["webCandidateCount"] == 4
    assert progress["webDroppedCount"] == 2 and progress["webFromCache"] is True
    assert progress["webSearchUsed"] is True and progress["webSkippedReason"] == "DAILY_LIMIT"
    assert progress["complexListSkippedReason"] == "SOURCE_ERROR"
    assert progress["criteria"]["processCodes"] == ["ANODIZING"]


@pytest.mark.parametrize("status", ["DONE", "FAILED"])
def test_latest_batch_is_dataset_scoped_and_not_limited_to_success(tmp_db, status):
    save_batch("find-old", started_at=NOW - timedelta(days=1))
    save_batch(status=status, finished_at=NOW, criteria=None)
    save_batch("other-dataset", started_at=NOW + timedelta(days=1), dataset_kind="BROCHURE")
    with TestClient(create_app()) as client:
        progress = listed(client)["meta"]["latestIngest"]
    assert progress["batchId"] == "find-latest" and progress["status"] == status
    assert progress["criteria"] is None and progress["newCount"] == 0


def test_no_batch_latest_filter_is_empty(api_env):
    client, _, _ = api_env
    assert listed(client, batch="latest")["data"] == []
    assert listed(client)["meta"]["latestIngest"] is None


def test_candidates_follow_scored_company_and_preserve_its_values(api_env, tmp_path):
    """Given 기존 평가+점수 전 후보 / When 목록 조회 / Then 기존 점수 보존·적합도 순."""
    client, original_id, _ = api_env
    original = listed(client)["data"][0]
    save_batch()
    medium = add_candidate(tmp_path, "medium", fit="MEDIUM")
    own = add_candidate(tmp_path, "own", own=True)
    high2 = add_candidate(tmp_path, "high-second", offset=2)
    high1 = add_candidate(tmp_path, "high-first", offset=1)
    body = listed(client)
    assert [card["oppId"] for card in body["data"]] == [original_id, high1, high2, medium, own]
    assert [card["rank"] for card in body["data"]] == [1, 2, 3, 4, 5]
    first = body["data"][0]
    for name in ("evalId", "scoreS", "scoreDisplay", "classificationCode", "rank"):
        assert first[name] == original[name]
    assert first["discoverySource"] == "CASE_FILE" and not first["isNewInLatestBatch"]
    assert all(card["scoreState"] == "NONE" for card in body["data"][1:])
    assert body["meta"]["total"] == 5 and body["meta"]["notEvaluatedCount"] == 0
    assert [card["oppId"] for card in listed(client, page=2, pageSize=2)["data"]] == [high2, medium]


def test_latest_and_explicit_batch_filter_and_detail_fields(api_env, tmp_path):
    client, _, _ = api_env
    save_batch("find-old", started_at=NOW - timedelta(days=1))
    old = add_candidate(tmp_path, "old", batch_id="find-old")
    save_batch()
    new = add_candidate(tmp_path, "new", own=True)
    body = listed(client, batch="latest", process="ANODIZING", region="천안시", q="가상후보")
    assert [row["oppId"] for row in body["data"]] == [new]
    assert body["meta"]["total"] == 1
    assert body["meta"]["notEvaluatedCount"] == 0
    card = body["data"][0]
    assert card["ingestBatchId"] == "find-latest" and card["isNewInLatestBatch"] is True
    assert card["ingestedAt"] == NOW.isoformat().replace("+00:00", "Z")
    header = client.get(f"{PATH}/{new}").json()["data"]["header"]
    for name in (
        "discoverySource",
        "discoverySourceUrl",
        "registryStatus",
        "fitLevel",
        "pickReason",
        "ownPlatingLineSuspected",
        "ownPlatingLineBasis",
    ):
        assert header[name] == card[name]
    old_card = listed(client, batch="find-old")["data"][0]
    assert old_card["oppId"] == old and old_card["isNewInLatestBatch"] is False
    assert listed(client, batch="unknown")["data"] == []


def test_partial_candidate_without_full_batch_is_shown(tmp_db, tmp_path):
    from geosan.capability.importer import import_capability

    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    save_batch()
    candidate = add_candidate(tmp_path, "first")
    with TestClient(create_app()) as client:
        body = listed(client)
    assert [card["oppId"] for card in body["data"]] == [candidate]
    assert body["data"][0]["rank"] == 1


def test_candidate_in_full_evaluation_is_not_duplicated(api_env, tmp_path):
    client, _, _ = api_env
    save_batch()
    candidate = add_candidate(tmp_path, "evaluated")
    assert run_evaluation().ok
    assert run_evaluation(opp_ids=[candidate]).ok
    rows = listed(client)["data"]
    assert len(rows) == 2 and sum(row["oppId"] == candidate for row in rows) == 1
