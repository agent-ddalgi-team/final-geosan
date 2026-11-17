"""#406: 같은 저장 시각에도 재투입 파일의 공정 순서를 보존한다."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, select

from geosan.capability.importer import import_capability
from geosan.capability.models import FieldEvidence, Process
from geosan.storage.session import session_scope
from tests.unit.u1 import test_process_filter as support
from tests.unit.u1.test_snapshot_ledger import _write

process_env = support.process_env


def reordered_capability(capability):
    """이전 공정 번호의 역순을 써서 번호 정렬로 우연히 통과하지 않게 한다."""
    with session_scope() as session:
        codes = session.scalars(
            select(Process.code)
            .where(Process.dataset_kind == "VIRTUAL_REVIEWED")
            .order_by(Process.process_id.desc())
        ).all()
    by_code = {row["code"]: row for row in capability["processes"]}
    capability["processes"] = [by_code[code] for code in codes]
    return capability


def reimport_with_shared_times(capability, tmp_path, group_size):
    """실제 저장은 유지하고 공정 검수 시각만 두 개씩 또는 전부 같게 만든다."""
    written = []

    def same_time(mapper, connection, row):
        if row.target_table == Process.__tablename__ and row.target_field == "reviewStatus":
            row.created_at = datetime(2050, 1, 1, tzinfo=UTC) + timedelta(
                seconds=len(written) // group_size
            )
            written.append(row.created_at)

    event.listen(FieldEvidence, "before_insert", same_time)
    try:
        import_capability(_write(tmp_path, "reordered.json", capability))
    finally:
        event.remove(FieldEvidence, "before_insert", same_time)
    assert len(written) == len(capability["processes"])
    assert len(set(written)) < len(written)


@pytest.mark.parametrize("group_size", [2, 9])
def test_equal_review_times_preserve_file_order_and_existing_results(
    process_env, tmp_path, group_size
):
    """Given 같은 저장 시각 / When 순서 변경 재투입 / Then 파일 순서·기존 평가를 보존한다."""
    client, _, capability = process_env
    before = client.get("/api/v1/opportunities").json()
    capability = reordered_capability(capability)
    reimport_with_shared_times(capability, tmp_path, group_size)
    after = client.get("/api/v1/opportunities").json()
    expected = [row["code"] for row in capability["processes"]]
    assert [row["processCode"] for row in after["meta"]["processCounts"]] == expected
    assert {row["processCode"]: row["count"] for row in after["meta"]["processCounts"]} == {
        row["processCode"]: row["count"] for row in before["meta"]["processCounts"]
    }
    assert len(expected) == 9
    assert {row["oppId"]: row["evalId"] for row in after["data"]} == {
        row["oppId"]: row["evalId"] for row in before["data"]
    }
    assert [row["oppId"] for row in after["data"]] == [row["oppId"] for row in before["data"]]
    for old, new in zip(before["data"], after["data"], strict=True):
        # 공정 순서를 따르는 두 칸(#659의 확정 공정 포함)은 아래에서 새 파일 순서로 따로 본다.
        ordered_keys = {"processCodes", "confirmedProcessCodes"}
        assert {key: value for key, value in old.items() if key not in ordered_keys} == {
            key: value for key, value in new.items() if key not in ordered_keys
        }
        assert new["processCodes"] == [code for code in expected if code in old["processCodes"]]
        assert new["confirmedProcessCodes"] == [
            code for code in expected if code in old["confirmedProcessCodes"]
        ]


def test_repeated_reimports_with_same_time_use_latest_file_order(process_env, tmp_path):
    """Given 같은 시각에 재투입 두 번 / When 파일 순서를 다시 변경 / Then 마지막 파일 순서다."""
    client, _, capability = process_env
    capability = reordered_capability(capability)
    reimport_with_shared_times(capability, tmp_path, len(capability["processes"]))
    capability["processes"].reverse()
    reimport_with_shared_times(capability, tmp_path, len(capability["processes"]))
    after = client.get("/api/v1/opportunities").json()
    assert [row["processCode"] for row in after["meta"]["processCounts"]] == [
        row["code"] for row in capability["processes"]
    ]
