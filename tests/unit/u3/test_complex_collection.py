"""#404: 목록 결합 순서·부분 실패. 조회 자체는 대역이며 실제 DB 연결은 시나리오에서 검사."""

import hashlib

import pytest

from geosan.config.app_settings import ComplexListSettings
from geosan.config.errors import InputError
from geosan.opportunity import complex_collection as collection
from geosan.opportunity.complex_rows import ComplexFactoryRow
from geosan.opportunity.complex_source import ComplexLookupResult
from geosan.opportunity.factory_csv import FactoryRow


def row(name, complex_name, *, api=False, number=None, region="충남"):
    values = dict(
        company_name=name,
        complex_name=complex_name,
        product="금속 부품",
        address=f"{region} 가상시 가상로 1",
        region=region,
        product_hash=hashlib.sha256("금속 부품".encode()).hexdigest(),
    )
    if api:
        return ComplexFactoryRow(**values, industry_name="제조업", factory_manage_no=number)
    return FactoryRow(**values)


@pytest.fixture
def context(monkeypatch):
    config = ComplexListSettings(enabled=True, extra_names=["단지A", "단지C"])
    monkeypatch.setattr(collection, "complex_settings", lambda *args: (("충남",), config))
    return config


def stub(monkeypatch, results):
    calls = []
    iterator = iter(results)

    def fetch(batch_id, name, **kwargs):
        calls.append(name)
        return next(iterator)

    monkeypatch.setattr(collection, "fetch_complex_list", fetch)
    return calls


def test_file_names_then_extra_names_are_requested_once_in_order(context, monkeypatch):
    calls = stub(monkeypatch, [ComplexLookupResult()] * 3)
    files = [
        row("첫공장", " 단지A "),
        row("둘째공장", "단지B"),
        row("셋째공장", "단지A"),
        row("단지밖", None),
    ]
    result = collection.collect_complex_rows("batch", files)
    assert calls == ["단지A", "단지B", "단지C"]
    assert result.combined.file_rows == tuple(files) and result.skipped_reason is None


def test_file_wins_and_cross_query_duplicates_are_added_only_once(context, monkeypatch):
    files = [row("기존공장", "단지A")]
    existing = row("기존공장", "단지A", api=True, number="F1")
    new = row("새공장", "단지C", api=True, number="F2")
    stub(monkeypatch, [ComplexLookupResult(rows=(existing, new)), ComplexLookupResult(rows=(new,))])
    result = collection.collect_complex_rows("batch", files)
    assert result.combined.file_rows == tuple(files)
    assert result.combined.added_rows == (new,) and result.combined.duplicate_count == 2


@pytest.mark.parametrize("reason", ["SOURCE_ERROR", "DAILY_LIMIT", "DISABLED"])
def test_partial_failure_keeps_file_and_received_rows_then_stops(context, monkeypatch, reason):
    context.extra_names = ["단지B", "단지C"]
    first = row("새공장1", "단지A", api=True, number="F1")
    partial = row("새공장2", "단지B", api=True, number="F2")
    calls = stub(
        monkeypatch,
        [
            ComplexLookupResult(rows=(first,)),
            ComplexLookupResult(rows=(partial,), skipped_reason=reason),
        ],
    )
    files = [row("기존공장", "단지A")]
    result = collection.collect_complex_rows("batch", files)
    assert result.skipped_reason == reason and calls == ["단지A", "단지B"]
    assert result.combined.file_rows == tuple(files)
    assert result.combined.added_rows == (first, partial)


def test_conflicting_factory_across_queries_does_not_overwrite_previous_row(context, monkeypatch):
    first = row("원공장", "단지A", api=True, number="F1")
    conflicting = row("다른공장", "단지C", api=True, number="F1")
    stub(
        monkeypatch, [ComplexLookupResult(rows=(first,)), ComplexLookupResult(rows=(conflicting,))]
    )
    result = collection.collect_complex_rows("batch", [row("기존공장", "단지A")])
    assert result.skipped_reason == "SOURCE_ERROR" and result.combined.added_rows == (first,)


def test_disabled_collection_returns_file_without_lookup(context, monkeypatch):
    context.enabled = False
    calls = stub(monkeypatch, [])
    file = row("기존공장", "단지A")
    result = collection.collect_complex_rows("batch", [file])
    assert result.skipped_reason == "DISABLED" and result.combined.file_rows == (file,)
    assert calls == []


def test_empty_complex_list_is_complete_without_any_http(context, monkeypatch):
    context.extra_names = []
    calls = stub(monkeypatch, [])
    assert collection.collect_complex_rows("batch", []).skipped_reason is None
    assert calls == []


def test_invalid_extra_name_is_checked_before_any_lookup(context, monkeypatch):
    context.extra_names = ["단지B", ""]
    calls = stub(monkeypatch, [])
    with pytest.raises(InputError):
        collection.collect_complex_rows("batch", [row("기존공장", "단지A")])
    assert calls == []


def test_file_from_another_region_cannot_be_sent(context, monkeypatch):
    calls = stub(monkeypatch, [])
    with pytest.raises(InputError):
        collection.collect_complex_rows("batch", [row("기존공장", "단지A", region="대전")])
    assert calls == []


def test_changed_region_during_request_is_rejected_before_result(context, monkeypatch):
    def change(*args, **kwargs):
        monkeypatch.setattr(collection, "complex_settings", lambda *args: (("대전",), context))
        return ComplexLookupResult()

    monkeypatch.setattr(collection, "fetch_complex_list", change)
    with pytest.raises(InputError, match="지역이나 추가 단지"):
        collection.collect_complex_rows("batch", [row("기존공장", "단지A")])


def test_changed_extra_names_during_request_are_rejected(context, monkeypatch):
    def change(*args, **kwargs):
        context.extra_names.append("새 단지")
        return ComplexLookupResult()

    monkeypatch.setattr(collection, "fetch_complex_list", change)
    with pytest.raises(InputError, match="지역이나 추가 단지"):
        collection.collect_complex_rows("batch", [row("기존공장", "단지A")])
