"""#437: 실제 SQLite 저장·재사용, 가상 제공처. 외부 네트워크는 공통 픽스처가 차단한다."""

from dataclasses import replace
from datetime import date, timedelta

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import OperationalError

from geosan.config.errors import AppError, InputError
from geosan.opportunity.complex_collection import collect_complex_rows
from geosan.opportunity.complex_store import store_complex_rows
from geosan.opportunity.factory_store import store_factory_csv
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import ComplexFetch, IngestionRun, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.test_complex_source import ROWS, configure, logs, responses, xml
from tests.unit.u3.test_complex_source import registry as registry


@pytest.fixture
def batch(registry):
    configure(extraNames=["가상단지"])
    return registry


def saved(model):
    with session_scope() as session:
        return session.scalars(select(model)).all()


def run(batch, files=()):
    collected = collect_complex_rows(batch, files)
    return store_complex_rows(batch, collected)


def test_first_lookup_then_reuse_needs_no_key_or_new_call_and_keeps_expiry(batch, monkeypatch):
    calls = responses(monkeypatch, xml(ROWS[:2]))
    first = run(batch)
    (fetch,) = saved(ComplexFetch)
    assert fetch.row_ids == list(first.row_ids) and fetch.row_count == 2
    assert fetch.expires_at - fetch.fetched_at == timedelta(days=15)
    assert (first.fetched_count, first.reused_count, first.skipped_reason) == (2, 0, None)
    monkeypatch.delenv("DATA_GO_KR_SERVICE_KEY")
    second = run(batch)
    assert second.row_ids == first.row_ids
    assert (second.fetched_count, second.reused_count, second.skipped_reason) == (0, 2, None)
    assert len(calls) == len(logs()) == len(saved(ComplexFetch)) == 1
    assert saved(ComplexFetch)[0].expires_at == fetch.expires_at
    assert "PRIVATE_" not in repr([vars(row) for row in saved(SourceFactoryRow)])
    assert all(row.file_date is None and row.fetched_at for row in saved(SourceFactoryRow))


def test_all_regions_saved_and_different_selection_reuses_same_lookup(batch, monkeypatch):
    calls = responses(monkeypatch, xml([ROWS[0], ("다른공장", "대전 유성구 가상길 1", "D1")]))
    first = run(batch)
    assert len(first.row_ids) == 1 and len(saved(SourceFactoryRow)) == 2
    assert saved(ComplexFetch)[0].row_count == 2
    with session_scope() as session:
        session.get(IngestBatch, batch).criteria = {"regions": ["대전"]}
    second = run(batch)
    assert len(second.row_ids) == second.reused_count == 1
    assert second.row_ids != first.row_ids and len(calls) == 1
    with session_scope() as session:
        assert session.get(SourceFactoryRow, second.row_ids[0]).region == "대전"


@pytest.mark.parametrize(
    "fault",
    ["expired", "legacy", "missing", "duplicate", "failed", "removed", "dataset", "corrupt"],
)
def test_incomplete_or_expired_record_is_refetched(batch, monkeypatch, fault):
    calls = responses(monkeypatch, xml(ROWS[:1]), xml(ROWS[:1]))
    first = run(batch)
    with session_scope() as session:
        fetch = session.scalars(select(ComplexFetch)).one()
        row = session.get(SourceFactoryRow, first.row_ids[0])
        if fault == "expired":
            fetch.expires_at = utcnow()
        elif fault == "legacy":
            fetch.row_ids = []
        elif fault == "missing":
            fetch.row_ids = ["missing-public-row"]
        elif fault == "duplicate":
            fetch.row_ids *= 2
            fetch.row_count = 2
        elif fault == "failed":
            fetch.status = "FAILED"
        elif fault == "removed":
            row.missing_since = date(2026, 1, 1)
        elif fault == "dataset":
            fetch.dataset_kind = "BROCHURE"
        else:
            row.product_hash = "broken"
    second = run(batch)
    assert second.fetched_count == 1 and second.reused_count == 0 and len(calls) == 2
    assert len(saved(ComplexFetch)) == 2


def test_empty_success_reuses_without_call(batch, monkeypatch):
    calls = responses(monkeypatch, xml([]))
    assert run(batch).row_ids == ()
    assert run(batch).skipped_reason is None
    (fetch,) = saved(ComplexFetch)
    assert fetch.status == "OK" and fetch.row_count == 0 and fetch.row_ids == []
    assert len(calls) == 1


def test_partial_failure_stores_received_rows_but_does_not_reuse(batch, monkeypatch):
    calls = responses(
        monkeypatch, xml(ROWS[:2], total=3), xml([], page=2, code="22"), xml(ROWS[:2])
    )
    first = run(batch)
    (failed,) = saved(ComplexFetch)
    assert len(first.row_ids) == 2 and first.skipped_reason == "DAILY_LIMIT"
    assert failed.status == "FAILED" and failed.row_count == 2
    second = run(batch)
    assert second.row_ids == first.row_ids and second.fetched_count == 2
    assert second.skipped_reason is None and len(calls) == 3


def test_csv_original_and_ids_win_over_api_without_new_duplicate(batch, factory_file, monkeypatch):
    original = store_factory_csv(
        batch,
        factory_file(
            [
                [1, "가상부품", "가상단지", "파일 원문", ROWS[0][1]],
                [2, "가상부품", "가상단지", "별도 생산품", ROWS[0][1]],
            ]
        ),
        date(2026, 1, 1),
    )
    calls = responses(monkeypatch, xml(ROWS[:2]))
    first = run(batch, original.csv.rows)
    second = run(batch, original.csv.rows)
    assert first.row_ids[:2] == original.row_ids and second.row_ids == first.row_ids
    assert len(first.row_ids) == len(saved(SourceFactoryRow)) == 3
    assert len(calls) == 1 and saved(ComplexFetch)[0].row_count == 3
    with session_scope() as session:
        assert [session.get(SourceFactoryRow, value).product for value in original.row_ids] == [
            "파일 원문",
            "별도 생산품",
        ]


def test_overlapping_queries_keep_membership_and_read_latest_public_contents(batch, monkeypatch):
    responses(
        monkeypatch,
        xml(ROWS[:2]),
        xml([ROWS[1]]).replace("금속 부품".encode(), "새 생산품".encode()),
    )
    first = run(batch)
    configure(extraNames=["다른단지"])
    second = run(batch)
    assert second.row_ids == (first.row_ids[1],)
    configure(extraNames=["가상단지"])
    collected = collect_complex_rows(batch, ())
    assert [row.product for row in collected.lookups[0][1].rows] == ["금속 부품", "새 생산품"]
    assert store_complex_rows(batch, collected).row_ids == first.row_ids
    assert [row.row_ids for row in saved(ComplexFetch)] == [
        list(first.row_ids),
        list(second.row_ids),
    ]


def test_disabled_preserves_csv_without_lookup_records(batch, factory_file, monkeypatch):
    original = store_factory_csv(
        batch, factory_file([[1, "가상부품", "가상단지", "부품", ROWS[0][1]]]), date(2026, 1, 1)
    )
    configure(enabled=False)
    calls = responses(monkeypatch)
    result = run(batch, original.csv.rows)
    assert result.row_ids == original.row_ids and result.skipped_reason == "DISABLED"
    assert not calls and not saved(ComplexFetch)


@pytest.mark.parametrize("change", ["region", "names", "finished", "expired", "wrong_batch"])
def test_context_changes_between_collection_and_store_are_rejected(batch, monkeypatch, change):
    responses(monkeypatch, xml(ROWS[:1]))
    run(batch)
    collected = collect_complex_rows(batch, ())
    with session_scope() as session:
        if change == "region":
            session.get(IngestBatch, batch).criteria = {"regions": ["대전"]}
        elif change == "finished":
            session.get(IngestBatch, batch).status = "COMPLETED"
        elif change == "expired":
            session.scalars(select(ComplexFetch)).one().expires_at = utcnow()
    if change == "names":
        configure(extraNames=["다른단지"])
    if change == "wrong_batch":
        collected = replace(collected, batch_id="other-batch")
    with pytest.raises(AppError):
        store_complex_rows(batch, collected)
    assert len(saved(ComplexFetch)) == 1


def test_store_failure_rolls_back_rows_and_fetch_but_keeps_external_call_record(batch, monkeypatch):
    responses(monkeypatch, xml(ROWS[:1]))
    collected = collect_complex_rows(batch, ())

    def fail(*args):
        raise OperationalError("PRIVATE_SQL", {}, Exception("PRIVATE_VALUE"))

    event.listen(ComplexFetch, "before_insert", fail)
    try:
        with pytest.raises(AppError) as error:
            store_complex_rows(batch, collected)
        assert "PRIVATE_" not in str(error.value)
    finally:
        event.remove(ComplexFetch, "before_insert", fail)
    assert not saved(SourceFactoryRow) and not saved(ComplexFetch) and len(logs()) == 1


def test_skipped_row_record_survives_later_public_row_storage_failure(batch, monkeypatch):
    responses(monkeypatch, xml([ROWS[0], ("", "충남 아산시 가상로 2", "F2")]))
    collected = collect_complex_rows(batch, ())

    def fail(*args):
        raise OperationalError("PRIVATE_SQL", {}, Exception("PRIVATE_VALUE"))

    event.listen(ComplexFetch, "before_insert", fail)
    try:
        with pytest.raises(AppError):
            store_complex_rows(batch, collected)
    finally:
        event.remove(ComplexFetch, "before_insert", fail)
    assert not saved(SourceFactoryRow) and not saved(ComplexFetch)
    (run,) = saved(IngestionRun)
    assert run.batch_id == batch and run.raw_count == 2 and run.status == "OK"
    assert run.skipped_rows == [
        {"rowNo": 2, "reason": "가상단지: 회사명 또는 공장주소가 비어 있음"}
    ]
    assert len(logs()) == 1


def test_cache_duration_comes_from_settings(batch, monkeypatch):
    configure(cacheDays=3)
    responses(monkeypatch, xml(ROWS[:1]))
    run(batch)
    (fetch,) = saved(ComplexFetch)
    assert fetch.expires_at - fetch.fetched_at == timedelta(days=3)


@pytest.mark.parametrize(
    "bad",
    [
        {"product_hash": "bad"},
        {"address": " "},
        {"company_name": None},
        {"factory_manage_no": 3},
        {"product": "연락 010-1234-5678"},
    ],
)
def test_unvalidated_or_private_public_row_is_not_stored(batch, monkeypatch, bad):
    responses(monkeypatch, xml(ROWS[:1]))
    collected = collect_complex_rows(batch, ())
    name, lookup = collected.lookups[0]
    invalid = replace(lookup.all_rows[0], **bad)
    collected = replace(collected, lookups=((name, replace(lookup, all_rows=(invalid,))),))
    with pytest.raises(InputError):
        store_complex_rows(batch, collected)
    assert not saved(SourceFactoryRow) and not saved(ComplexFetch)
