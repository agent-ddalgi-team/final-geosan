"""#404: 가상 제공처 응답과 실제 SQLite로 쪽 넘김·재시도·부분 실패를 검사한다."""

from datetime import date
from xml.etree import ElementTree as ET

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from geosan.config.errors import AppError, InputError, RunFailedError
from geosan.config.models import AppSetting
from geosan.evidence.transfer import TransferLog
from geosan.opportunity import complex_source as source
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import SourceContract
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope


def xml(rows, *, page=1, total=None, code="00"):
    root = ET.Element("response")
    header = ET.SubElement(root, "header")
    ET.SubElement(header, "resultCode").text = code
    ET.SubElement(header, "resultMsg").text = "PRIVATE_ERROR_MARKER"
    body = ET.SubElement(root, "body")
    items = ET.SubElement(body, "items")
    for name, address, number in rows:
        item = ET.SubElement(items, "item")
        for field, value in {
            "cmpnyNm": name,
            "rnAdres": address,
            "fctryManageNo": number,
            "irsttNm": "가상단지",
            "mainProductCn": "금속 부품",
            "indutyNm": "제조업",
            "rprsntvNm": "PRIVATE_PERSON_MARKER",
            "cmpnyTelno": "PRIVATE_PHONE_MARKER",
            "cmpnyFxnum": "PRIVATE_FAX_MARKER",
            "hmpadr": "PRIVATE_HOME_MARKER",
        }.items():
            ET.SubElement(item, field).text = value
    for field, value in {
        "pageNo": page,
        "numOfRows": source.PAGE_SIZE,
        "totalCount": len(rows) if total is None else total,
    }.items():
        ET.SubElement(body, field).text = str(value)
    return ET.tostring(root, encoding="utf-8")


ROWS = [
    ("가상부품", "충남 아산시 가상로 1", "F1"),
    ("가상제조", "충남 천안시 가상로 2", "F2"),
    ("가상공장", "충남 아산시 가상로 3", "F3"),
]


def configure(**changes):
    with session_scope() as session:
        row = session.get(AppSetting, "ingestion")
        row.value = row.value | {"complexList": row.value["complexList"] | changes}


@pytest.fixture
def registry(ingest_batch, monkeypatch):
    monkeypatch.setenv("DATA_GO_KR_SERVICE_KEY", "synthetic")
    monkeypatch.setattr(source, "PAGE_SIZE", 2)
    configure(enabled=True)
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id=source.SOURCE_ID,
                source_name="가상 등록 조회",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
    return ingest_batch


def logs():
    with session_scope() as session:
        return session.scalars(select(TransferLog)).all()


def responses(monkeypatch, *values):
    calls = []
    remaining = iter(values)

    def request(name, key, page):
        calls.append((name, page))
        value = next(remaining)
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(source, "_request_page", request)
    return calls


def test_pages_use_actual_total_and_filter_addresses_without_private_fields(registry, monkeypatch):
    calls = responses(
        monkeypatch,
        xml([ROWS[0], ("다른지역", "전북 고창군 가상로 1", "OTHER")], total=3),
        xml([ROWS[2]], page=2, total=3),
    )
    result = source.fetch_complex_list(registry, "가상단지")
    assert result.skipped_reason is None
    assert [row.company_name for row in result.rows] == ["가상부품", "가상공장"]
    assert (result.pages_read, result.raw_count, result.filtered_count) == (2, 3, 1)
    assert calls == [("가상단지", 1), ("가상단지", 2)]
    assert "PRIVATE_" not in repr(result)
    assert len(logs()) == 2 and all(row.call_count == 1 for row in logs())


def test_retry_is_one_extra_record_for_same_page(registry, monkeypatch):
    calls = responses(monkeypatch, TimeoutError("PRIVATE_KEY_MARKER"), xml([ROWS[0]]))
    result = source.fetch_complex_list(registry, "가상단지")
    assert result.skipped_reason is None and len(result.rows) == 1
    assert calls == [("가상단지", 1), ("가상단지", 1)]
    assert len(logs()) == 2 and all(row.cost_usd == 0 for row in logs())


def test_two_transport_failures_are_not_empty_success_or_a_third_attempt(
    registry, monkeypatch, caplog
):
    calls = responses(monkeypatch, OSError("PRIVATE_KEY_MARKER"), OSError("PRIVATE_BODY_MARKER"))
    result = source.fetch_complex_list(registry, "가상단지")
    assert result.skipped_reason == "SOURCE_ERROR" and result.rows == ()
    assert len(calls) == len(logs()) == 2
    assert "PRIVATE_" not in caplog.text + repr(result)


def test_second_page_failure_preserves_first_page_and_its_counts(registry, monkeypatch):
    responses(monkeypatch, xml(ROWS[:2], total=3), OSError(), OSError())
    result = source.fetch_complex_list(registry, "가상단지")
    assert result.skipped_reason == "SOURCE_ERROR" and len(result.rows) == 2
    assert (result.pages_read, result.raw_count) == (1, 2)
    assert len(logs()) == 3


@pytest.mark.parametrize("status", [301, 302, 307, 400, 401, 403, 404])
def test_permanent_http_error_does_not_retry_or_follow_redirect(registry, monkeypatch, status):
    calls = responses(monkeypatch, source._HttpError(status))
    assert source.fetch_complex_list(registry, "가상단지").skipped_reason == "SOURCE_ERROR"
    assert len(calls) == len(logs()) == 1


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503, 504])
def test_transient_http_error_retries_once(registry, monkeypatch, status):
    calls = responses(monkeypatch, source._HttpError(status), xml([]))
    assert source.fetch_complex_list(registry, "가상단지").skipped_reason is None
    assert len(calls) == len(logs()) == 2


@pytest.mark.parametrize(
    "payload,reason",
    [
        (b"broken PRIVATE_BODY_MARKER", "SOURCE_ERROR"),
        (xml([], code="01"), "SOURCE_ERROR"),
        (xml([], code="22"), "DAILY_LIMIT"),
    ],
)
def test_provider_and_invalid_xml_errors_never_retry(registry, monkeypatch, payload, reason):
    calls = responses(monkeypatch, payload)
    assert source.fetch_complex_list(registry, "가상단지").skipped_reason == reason
    assert len(calls) == len(logs()) == 1


def test_total_change_does_not_claim_a_complete_list(registry, monkeypatch):
    responses(monkeypatch, xml(ROWS[:2], total=3), xml(ROWS[:2], page=2, total=4))
    result = source.fetch_complex_list(registry, "가상단지")
    assert result.skipped_reason == "SOURCE_ERROR" and result.pages_read == 1
    assert len(result.rows) == 2


def test_conflicting_management_number_keeps_only_previous_pages(registry, monkeypatch):
    responses(
        monkeypatch,
        xml(ROWS[:2], total=3),
        xml([("상충공장", "충남 아산시 다른길 1", "F1")], page=2, total=3),
    )
    result = source.fetch_complex_list(registry, "가상단지")
    assert result.skipped_reason == "SOURCE_ERROR" and len(result.rows) == 2


def test_incomplete_row_is_reported_while_other_pages_continue(registry, monkeypatch):
    responses(
        monkeypatch,
        xml([ROWS[0], ("", "충남 아산시 가상로 2", "F2")], total=3),
        xml([ROWS[2]], page=2, total=3),
    )
    result = source.fetch_complex_list(registry, "가상단지")
    assert result.skipped_reason == "SOURCE_ERROR" and len(result.rows) == 2
    assert result.pages_read == 2 and result.skipped_rows[0].row_no == 2


def test_last_daily_slot_cannot_be_reused_for_retry(registry, monkeypatch):
    with session_scope() as session:
        for _ in range(999):
            session.add(
                TransferLog(
                    transfer_log_id=new_id("transfer"),
                    occurred_at=utcnow(),
                    batch_id=registry,
                    purpose="PUBLIC_SOURCE",
                    kind="FACTORY_REGISTRY",
                    mode="NONE",
                    security_grade="PUBLIC",
                    decision="ALLOW",
                    call_count=1,
                    cost_usd=0,
                )
            )
    calls = responses(monkeypatch, OSError())
    assert source.fetch_complex_list(registry, "가상단지").skipped_reason == "DAILY_LIMIT"
    assert len(calls) == 1
    rows = logs()
    assert len([row for row in rows if row.decision == "ALLOW"]) == 1000
    assert len([row for row in rows if row.reject_reason == "DAILY_LIMIT"]) == 1


def test_disabled_and_missing_key_never_reserve_a_call(registry, monkeypatch):
    calls = responses(monkeypatch)
    monkeypatch.delenv("DATA_GO_KR_SERVICE_KEY")
    assert source.fetch_complex_list(registry, "가상단지").skipped_reason == "SOURCE_ERROR"
    configure(enabled=False)
    with session_scope() as session:
        session.delete(session.get(SourceContract, source.SOURCE_ID))
    assert source.fetch_complex_list(registry, "가상단지").skipped_reason == "DISABLED"
    assert calls == logs() == []


@pytest.mark.parametrize("name", ["", "  ", None, "단지\n이름", "https://example.test", "x" * 201])
def test_bad_names_never_reach_provider(registry, monkeypatch, name):
    calls = responses(monkeypatch)
    with pytest.raises(InputError):
        source.fetch_complex_list(registry, name)
    assert calls == logs() == []


def test_source_confirmation_is_required_before_http(registry, monkeypatch):
    calls = responses(monkeypatch)
    with session_scope() as session:
        session.get(SourceContract, source.SOURCE_ID).confirmed_at = None
    with pytest.raises(InputError):
        source.fetch_complex_list(registry, "가상단지")
    assert calls == logs() == []


@pytest.mark.parametrize("change", ["disabled", "region", "finished"])
def test_changed_context_blocks_retry(registry, monkeypatch, change):
    calls = []

    def request(*args):
        calls.append(1)
        with session_scope() as session:
            batch = session.get(IngestBatch, registry)
            if change == "region":
                batch.criteria = {"regions": ["대전"]}
            if change == "finished":
                batch.status = "DONE"
        if change == "disabled":
            configure(enabled=False)
        raise OSError()

    monkeypatch.setattr(source, "_request_page", request)
    if change == "disabled":
        assert source.fetch_complex_list(registry, "가상단지").skipped_reason == "DISABLED"
    else:
        with pytest.raises(AppError):
            source.fetch_complex_list(registry, "가상단지")
    assert len(calls) == len(logs()) == 1


def test_storage_failure_is_not_retried_as_http_failure(registry, monkeypatch, caplog):
    attempts = []
    calls = responses(monkeypatch)

    def fail(**kwargs):
        attempts.append(1)
        raise OperationalError("PRIVATE_SQL_MARKER", {"key": "PRIVATE_KEY_MARKER"}, Exception())

    monkeypatch.setattr(source, "reserve_factory_registry", fail)
    with pytest.raises(RunFailedError) as error:
        source.fetch_complex_list(registry, "가상단지")
    assert attempts == [1] and calls == []
    assert "PRIVATE_" not in caplog.text + str(error.value)
