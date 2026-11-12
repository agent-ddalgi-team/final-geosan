"""#549: 예상 금액 단가 설정(C7 ingestion.costEstimate)과 회차의 예상 금액 열(C6) 이관."""

import sqlite3
from pathlib import Path

import pytest
import yaml
from alembic import command

from geosan.config.app_settings import (
    check_app_settings_file,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.config.models import AppSetting
from geosan.storage.migrate import alembic_config, upgrade_to_head
from geosan.storage.session import session_scope

EXAMPLES = [Path("examples/app-settings.yaml"), Path("examples/app-settings-virtual.yaml")]
KEYS = [
    "judgeUsdPerRow",
    "researchUsdPerCompany",
    "researchCallsPerCompany",
    "webSearchUsdPerBatch",
]


@pytest.mark.parametrize("path", EXAMPLES)
def test_example_files_carry_contract_initial_values(path):
    """Given 예시 설정 파일 / When 검사한다 / Then 약속의 초기값 4키가 들어 있고 검사를 통과한다."""
    result = check_app_settings_file(path)
    assert result.ok, result.errors
    assert result.settings.ingestion.cost_estimate.model_dump(by_alias=True) == {
        "judgeUsdPerRow": 0.002,
        "researchUsdPerCompany": 0.04,
        "researchCallsPerCompany": 2,
        "webSearchUsdPerBatch": 0.04,
    }


def _write(tmp_path, change):
    data = yaml.safe_load(EXAMPLES[0].read_text(encoding="utf-8"))
    change(data["ingestion"])
    path = tmp_path / "app-settings.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return path


def test_file_without_cost_estimate_fails_check(tmp_path):
    """Given costEstimate가 없는 설정 파일 / When check-config 검사 / Then 필수 칸 오류로 알린다."""
    result = check_app_settings_file(_write(tmp_path, lambda item: item.pop("costEstimate")))
    assert not result.ok
    assert [error.path for error in result.errors] == ["ingestion.costEstimate"]


@pytest.mark.parametrize("key", KEYS)
@pytest.mark.parametrize("value", [0, -1])
def test_each_price_must_be_above_zero(tmp_path, key, value):
    """Given 단가가 0이거나 음수 / When 검사 / Then 그 칸의 오류로 알린다(모두 0보다 커야 한다)."""
    result = check_app_settings_file(
        _write(tmp_path, lambda item: item["costEstimate"].update({key: value}))
    )
    assert not result.ok
    assert [error.path for error in result.errors] == [f"ingestion.costEstimate.{key}"]


def test_old_db_copy_reads_with_example_values_and_keeps_other_keys(tmp_db):
    """Given #549 전에 만든 DB 사본(costEstimate 없음, 최대 건수는 바꿔 둠) / When 되읽는다
    / Then 빠진 칸만 예시 파일 값으로 채우고 바꿔 둔 값은 그대로다(#591과 같은 방식)."""
    with session_scope() as session:
        sync_app_settings(session, load_app_settings(EXAMPLES[0]))
        row = session.get(AppSetting, "ingestion")
        row.value = {k: v for k, v in row.value.items() if k != "costEstimate"} | {
            "maxCandidates": 7
        }
    with session_scope() as session:
        settings = read_app_settings(session)
        assert settings.ingestion.max_candidates == 7
        assert settings.ingestion.cost_estimate.judge_usd_per_row == 0.002
        # 읽기만 하고 사본을 고쳐 쓰지 않는다.
        assert "costEstimate" not in session.get(AppSetting, "ingestion").value


def _columns(db):
    with sqlite3.connect(db) as con:
        return {row[1] for row in con.execute("PRAGMA table_info(opp_ingest_batch)")}


def _indexes(db):
    with sqlite3.connect(db) as con:
        return {row[1] for row in con.execute("PRAGMA index_list(opp_ingest_batch)")}


def test_migration_adds_nullable_column_and_old_batch_stays_empty(tmp_path, monkeypatch):
    """Given 열이 생기기 전 DB의 옛 회차 / When 이관을 올린다 → 내린다
    / Then 옛 회차의 예상 금액은 비어 있고, 내려도 실행 중 회차 하나만 허용하는 색인이 남는다."""
    db = tmp_path / "old.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(db))
    command.upgrade(alembic_config(db), "rec_012")
    assert "estimated_usd" not in _columns(db)
    with sqlite3.connect(db) as con:
        from tests.unit.u3.test_ingest_tables import _insert_filled

        _insert_filled(con, "opp_ingest_batch", batch_id="batch-old", status="DONE")
    assert upgrade_to_head(db) == ["opp_009"]
    with sqlite3.connect(db) as con:
        assert con.execute("SELECT estimated_usd FROM opp_ingest_batch").fetchall() == [(None,)]
    command.downgrade(alembic_config(db), "rec_012")
    assert "estimated_usd" not in _columns(db)
    assert "uq_opp_ingest_batch_running" in _indexes(db)
