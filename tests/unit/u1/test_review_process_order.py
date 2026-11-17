"""#483: 검수 복사 뒤에도 목록·후보 선택지가 최신 역량 파일의 공정 순서를 보존한다."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from geosan.api.app import create_app
from geosan.capability.models import FieldEvidence, Process
from geosan.storage.session import session_scope
from tests.unit.u1 import test_review_set as support
from tests.unit.u1.test_process_order import reimport_with_shared_times

review_db = support.review_db


def brochure():
    return json.loads(Path("tests/data/capability-brochure.json").read_text(encoding="utf-8"))


def reordered_brochure(tmp_path, group_size):
    """두 번 재투입해 최초 순서·이전 순서·최신 순서가 서로 다르게 한다."""
    capability = brochure()
    capability["processes"].reverse()
    # 첫 재투입은 모두 같은 시각으로 두어 다음 재투입의 시각이 과거로 가지 않게 한다.
    reimport_with_shared_times(capability, tmp_path, len(capability["processes"]))
    capability["processes"] = capability["processes"][2:] + capability["processes"][:2]
    reimport_with_shared_times(capability, tmp_path, group_size)
    return capability


def visible_processes(client):
    options = client.get("/api/v1/config/ui")
    listing = client.get("/api/v1/opportunities")
    assert options.status_code == listing.status_code == 200
    return (
        options.json()["data"]["ingestOptions"]["processes"],
        [row["processCode"] for row in listing.json()["meta"]["processCounts"]],
    )


def copy_and_assert_order(capability):
    expected = [{"code": row["code"], "name": row["name"]} for row in capability["processes"]]
    with session_scope() as session:
        original = support.snapshot(support.catalogue(session, "BROCHURE"))
    with TestClient(create_app()) as client:
        before = visible_processes(client)
        assert before == (expected, [row["code"] for row in expected])
        result = support.invoke("--all", "REVIEWED")
        assert result.exit_code == 0, result.output
        assert visible_processes(client) == before
    with session_scope() as session:
        assert support.snapshot(support.catalogue(session, "BROCHURE")) == original


def test_review_preserves_original_file_order_in_list_and_ingest_options(review_db):
    """Given 소개서 파일 / When 전체 검수 전환 / Then 두 선택지와 원본은 그대로다."""
    copy_and_assert_order(brochure())


@pytest.mark.parametrize("group_size", [2, 9])
def test_review_preserves_latest_reimport_order_with_equal_times(review_db, tmp_path, group_size):
    """Given 같은 시각의 재투입 두 번 / When 검수 복사 / Then 마지막 파일 순서다."""
    copy_and_assert_order(reordered_brochure(tmp_path, group_size))


def test_review_preserves_order_when_copied_review_times_are_equal(review_db, tmp_path):
    """Given 바뀐 파일 순서 / When 복사 이력 시각도 동일 / Then 저장 순서가 보존된다."""
    capability = reordered_brochure(tmp_path, 9)

    def same_time(mapper, connection, row):
        if row.target_table == Process.__tablename__ and row.dataset_kind == "COMPANY_CONFIRMED":
            row.created_at = datetime(2051, 1, 1, tzinfo=UTC)

    event.listen(FieldEvidence, "before_insert", same_time)
    try:
        copy_and_assert_order(capability)
    finally:
        event.remove(FieldEvidence, "before_insert", same_time)
