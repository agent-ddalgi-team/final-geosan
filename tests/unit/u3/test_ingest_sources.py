"""#427: 원본 기준일의 PM 결정과 실제 임시 DB 저장을 확인한다."""

from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from geosan.config.errors import AppError, InputError
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.storage.session import session_scope
from geosan.workflows import flow_ingest as flow
from geosan.workflows import ingest_sources as sources
from tests.unit.u3 import test_flow_ingest as support

ingest_env = support.ingest_env
load_source_rows = flow.load_source_rows


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("factory_20251231.csv", date(2025, 12, 31)),
        ("공장현황_20240229.CSV", date(2024, 2, 29)),
        ("20251231.csv", date(2025, 12, 31)),
        ("20251231/factories.csv", date(2025, 12, 31)),
        ("20240101/factory_20251231.csv", date(2025, 12, 31)),
    ],
)
def test_reference_date_uses_filename_before_parent_folder(path, expected):
    """Given 원본 이름 / When 기준일 읽기 / Then 파일명 우선·바로 위 날짜 폴더 순서다."""
    assert sources.factory_file_date(Path(path)) == expected


@pytest.mark.parametrize(
    "path",
    [
        "factories.csv",
        "20251231/other/factories.csv",
        "factory_120251231.csv",
        "factory_20251231_copy.csv",
        "２０２５１２３１/factories.csv",
    ],
)
def test_missing_reference_date_never_uses_modification_time(path):
    with pytest.raises(InputError, match="파일명이나 폴더명에 기준일"):
        sources.factory_file_date(Path(path))


@pytest.mark.parametrize(
    "path",
    ["factory_20250229.csv", "20251301/factories.csv", "20251231/factory_20250230.csv"],
)
def test_invalid_date_does_not_fall_back_to_other_date(path):
    with pytest.raises(InputError, match="올바른 날짜"):
        sources.factory_file_date(Path(path))


@pytest.mark.parametrize("use_folder", [False, True])
def test_valid_date_is_stored_in_real_temporary_database(ingest_batch, factory_file, use_folder):
    path = factory_file([[1, "가상 회사", "", "가상 볼트", "충청남도 당진시 가상길 1"]])
    if use_folder:
        dated = path.parent / "20251231" / path.name
        dated.parent.mkdir()
    else:
        dated = path.with_name("factories_20251231.csv")
    dated.write_bytes(path.read_bytes())
    result = sources.store_dated_factory_csv(ingest_batch, dated)
    with session_scope() as session:
        row = session.get(SourceFactoryRow, result.row_ids[0])
        assert row.file_date == date(2025, 12, 31)
    assert result.csv.raw_count == 1


def test_missing_date_stops_before_reading_or_writing(ingest_batch, factory_file, monkeypatch):
    path = factory_file([[1, "가상 회사", "", "가상 볼트", "충청남도 당진시 가상길 1"]])

    def unexpected_store(*args, **kwargs):
        pytest.fail("기준일 없는 파일은 읽기·저장 부품에 넘기면 안 된다")

    monkeypatch.setattr(sources, "store_factory_csv", unexpected_store)
    with pytest.raises(InputError, match="파일명이나 폴더명에 기준일"):
        sources.store_dated_factory_csv(ingest_batch, path)
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(SourceFactoryRow)) == 0


def test_storage_failure_is_not_retried_or_returned_as_success(monkeypatch):
    calls = []

    def failed_store(batch_id, path, file_date):
        calls.append((batch_id, path, file_date))
        raise InputError("가상 저장 실패")

    monkeypatch.setattr(sources, "store_factory_csv", failed_store)
    path = Path("factories_20251231.csv")
    with pytest.raises(InputError, match="가상 저장 실패"):
        sources.store_dated_factory_csv("batch-test", path)
    assert calls == [("batch-test", path, date(2025, 12, 31))]


@pytest.fixture
def source_runtime(ingest_env, monkeypatch):
    """#425 먼저 병합 결정에 따라 공통 설정은 바꾸지 않고 검사에서 경로만 주입한다."""
    path = ingest_env.path.with_name("factories_20251231.csv")
    path.write_bytes(ingest_env.path.read_bytes())
    settings = SimpleNamespace(
        factory_csv_path=str(path), complex_list=SimpleNamespace(enabled=False)
    )
    monkeypatch.setattr(
        flow,
        "load_runtime_config",
        lambda session: SimpleNamespace(app_settings=SimpleNamespace(ingestion=settings)),
    )
    return settings


def test_file_only_source_uses_real_storage_without_complex_calls(source_runtime, monkeypatch):
    def unexpected_call(*args):
        pytest.fail("단지 조회가 꺼져 있으면 조회·조회 저장을 부르면 안 된다")

    monkeypatch.setattr(flow, "collect_complex_rows", unexpected_call)
    monkeypatch.setattr(flow, "store_complex_rows", unexpected_call)
    result = load_source_rows(support.new_batch())
    assert len(result.row_ids) == result.scanned_count == 3
    assert result.complex_skipped_reason == "DISABLED"
    with session_scope() as session:
        assert all(
            session.get(SourceFactoryRow, row_id).file_date == date(2025, 12, 31)
            for row_id in result.row_ids
        )


def test_enabled_complex_source_combines_ids_in_file_order_and_preserves_partial_reason(
    source_runtime, monkeypatch
):
    source_runtime.complex_list.enabled = True
    batch_id = support.new_batch()
    calls = []
    collected = object()

    def collect(actual_batch_id, rows):
        calls.append(("collect", actual_batch_id))
        assert len(rows) == 3
        return collected

    def store(actual_batch_id, actual_collected):
        calls.append(("store", actual_batch_id))
        assert actual_collected is collected
        with session_scope() as session:
            file_ids = session.scalars(select(SourceFactoryRow.row_id)).all()
        return SimpleNamespace(row_ids=(file_ids[0], "factory-extra"), skipped_reason="PARTIAL")

    monkeypatch.setattr(flow, "collect_complex_rows", collect)
    monkeypatch.setattr(flow, "store_complex_rows", store)
    result = load_source_rows(batch_id)
    assert calls == [("collect", batch_id), ("store", batch_id)]
    assert len(result.row_ids) == result.scanned_count == 4
    assert result.row_ids[-1] == "factory-extra"
    assert result.complex_skipped_reason == "PARTIAL"


def test_complex_failure_does_not_fall_back_to_file_success(source_runtime, monkeypatch):
    source_runtime.complex_list.enabled = True

    def failed_collect(*args):
        raise InputError("가상 조회 실패")

    monkeypatch.setattr(flow, "collect_complex_rows", failed_collect)
    with pytest.raises(InputError, match="가상 조회 실패"):
        load_source_rows(support.new_batch())


def test_missing_path_setting_stops_before_reading(source_runtime, monkeypatch):
    source_runtime.factory_csv_path = None

    def unexpected_store(*args):
        pytest.fail("경로 설정이 없으면 파일을 읽으면 안 된다")

    monkeypatch.setattr(flow, "store_dated_factory_csv", unexpected_store)
    with pytest.raises(InputError, match="파일 경로 설정"):
        load_source_rows(support.new_batch())


def test_batch_failure_keeps_safe_date_guidance_and_does_not_judge(ingest_env, monkeypatch):
    def load_without_date(batch_id):
        return sources.store_dated_factory_csv(batch_id, ingest_env.path)

    monkeypatch.setattr(flow, "load_source_rows", load_without_date)
    batch_id = support.new_batch()
    message = "파일명이나 폴더명에 기준일(YYYYMMDD)이 있어야 합니다."
    with pytest.raises(AppError, match="파일명이나 폴더명에 기준일"):
        flow.run_ingest(batch_id)
    batch = support.saved(batch_id)
    assert batch.status == "FAILED" and batch.failure_reason == message
    assert str(ingest_env.path) not in batch.failure_reason
    assert ingest_env.picker.calls == 0
