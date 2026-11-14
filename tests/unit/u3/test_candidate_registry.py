"""웹 후보 등록 대조: 완전한 응답·동명이사·비밀 제외·공통 호출 장부."""

from dataclasses import asdict

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from geosan.config.errors import InputError, RunFailedError
from geosan.evidence import public_source
from geosan.evidence.public_source import reserve_factory_registry
from geosan.opportunity import candidate_registry as registry
from geosan.opportunity import complex_source as transport
from geosan.opportunity.models import Customer, IngestBatch
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow, WebCandidate
from geosan.storage.session import session_scope
from tests.fakes.candidate_registry import MATCH, candidate, responses, setup_registry, xml
from tests.fakes.web_candidate_search import BATCH, logs, settings


@pytest.fixture
def ready(tmp_db, app_settings_path, monkeypatch):
    setup_registry(app_settings_path, monkeypatch)
    return tmp_db


def test_all_pages_then_exact_name_and_address_match(ready, monkeypatch, caplog):
    monkeypatch.setattr(transport, "PAGE_SIZE", 2)
    calls = responses(
        monkeypatch,
        xml(
            [("가상볼트상사", MATCH[1], "F2"), ("가상볼트", "경기 수원시 가상로 3", "F3")], total=3
        ),
        xml([MATCH], page=2, total=3),
    )
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.registry_status == "FOUND" and result.matched_row.company_name == MATCH[0]
    assert result.raw_count == 3 and result.pages_read == 2 and not result.needs_confirmation
    assert calls == [("가상볼트", 1), ("가상볼트", 2)]
    assert "PRIVATE_" not in repr(asdict(result)) + caplog.text
    assert len(logs()) == 2 and all(r.decision == "ALLOW" for r in logs())
    with session_scope() as session:
        for model in (Customer, SourceFactoryRow, WebCandidate):
            assert session.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize(
    "address,rows",
    [
        (None, [MATCH]),
        ("충남", [MATCH]),
        ("충남 천안시 가상로 9", [MATCH]),
        (MATCH[1], [MATCH, (MATCH[0], MATCH[1], "F2")]),
        ("충남 아산시", [MATCH, (MATCH[0], "충남 아산시 가상로 7", "F2")]),
        ("경기 수원시 가상로 1", [(MATCH[0], "경기 수원시 가상로 1", "F1")]),
    ],
)
def test_missing_partial_different_or_multiple_addresses_need_confirmation(
    ready, monkeypatch, address, rows
):
    responses(monkeypatch, xml(rows))
    result = registry.lookup_candidate_registry(BATCH, candidate(address=address))
    assert result.registry_status is None and result.matched_row is None
    assert result.needs_confirmation and result.skipped_reason is None


@pytest.mark.parametrize(
    "address",
    [
        "충남 아산시",
        "충청남도 아산시 가상로 1 외 1필지",
        "(31421) 충남 아산시가상구 다른로 9",
        "충남 아산",
    ],
)
def test_same_name_in_the_same_city_is_found_even_when_address_text_differs(
    ready, monkeypatch, address
):
    """#706 PM 결정: 이름과 시·군이 같은 등록 행이 하나면 확인됨. 글자 차이로 떨어뜨리지 않는다."""
    responses(monkeypatch, xml([MATCH, (MATCH[0], "충남 천안시 가상로 1", "F2")]))
    result = registry.lookup_candidate_registry(BATCH, candidate(address=address))
    assert result.registry_status == "FOUND" and result.matched_row.factory_manage_no == MATCH[2]
    assert not result.needs_confirmation


def test_two_factories_in_one_city_are_told_apart_only_by_the_full_address(ready, monkeypatch):
    rows = [MATCH, (MATCH[0], "충남 아산시 가상로 7", "F2")]
    responses(monkeypatch, xml(rows))
    result = registry.lookup_candidate_registry(BATCH, candidate(address="충남 아산시 가상로 7"))
    assert result.registry_status == "FOUND" and result.matched_row.factory_manage_no == "F2"


def test_only_complete_empty_response_is_not_found(ready, monkeypatch):
    responses(monkeypatch, xml([]))
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.registry_status == "NOT_FOUND" and result.matched_row is None
    assert not result.needs_confirmation and result.skipped_reason is None


def test_partial_name_match_is_not_an_absence_or_identity_proof(ready, monkeypatch):
    responses(monkeypatch, xml([("가상볼트상사", MATCH[1], "F2")]))
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.registry_status is None and result.needs_confirmation


def test_changed_setting_stops_retry_after_one_reservation(ready, monkeypatch):
    def request(*args, **kwargs):
        settings(enabled=False)
        raise TimeoutError()

    monkeypatch.setattr(transport, "_request_page", request)
    with pytest.raises(InputError, match="바뀌었습니다"):
        registry.lookup_candidate_registry(BATCH, candidate())
    assert len(logs()) == 1


def test_transient_retry_is_recorded_once_more(ready, monkeypatch):
    calls = responses(monkeypatch, TimeoutError("PRIVATE_KEY_MARKER"), xml([MATCH]))
    assert registry.lookup_candidate_registry(BATCH, candidate()).registry_status == "FOUND"
    assert calls == [("가상볼트", 1)] * 2 and len(logs()) == 2


@pytest.mark.parametrize("status", [301, 401, 403, 404])
def test_permanent_http_error_is_not_followed_or_retried(ready, monkeypatch, status):
    calls = responses(monkeypatch, transport._HttpError(status))
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.skipped_reason == "SOURCE_ERROR" and result.registry_status is None
    assert len(calls) == len(logs()) == 1


@pytest.mark.parametrize("status", [408, 429, 503])
def test_retryable_http_status_has_only_one_retry(ready, monkeypatch, status):
    calls = responses(monkeypatch, transport._HttpError(status), transport._HttpError(status))
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.registry_status is None and result.skipped_reason == "SOURCE_ERROR"
    assert len(calls) == len(logs()) == 2


def test_shared_limit_includes_other_registry_calls_and_retry(ready, monkeypatch):
    monkeypatch.setattr(public_source, "_DAILY_LIMIT", 2)
    reserve_factory_registry(batch_id=BATCH)
    calls = responses(monkeypatch, OSError("PRIVATE_KEY_MARKER"))
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.registry_status is None and result.skipped_reason == "DAILY_LIMIT"
    assert len(calls) == 1 and [r.decision for r in logs()] == ["ALLOW", "ALLOW", "REJECT"]


def test_second_page_failure_does_not_confirm_first_page_match(ready, monkeypatch):
    monkeypatch.setattr(transport, "PAGE_SIZE", 1)
    responses(monkeypatch, xml([MATCH], total=2), OSError(), OSError())
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.pages_read == result.raw_count == 1 and len(result.rows) == 1
    assert result.registry_status is None and result.skipped_reason == "SOURCE_ERROR"


@pytest.mark.parametrize(
    "payload,reason",
    [
        (b"<broken>PRIVATE_BODY_MARKER", "SOURCE_ERROR"),
        (xml(code="22"), "DAILY_LIMIT"),
        (xml(code="30"), "SOURCE_ERROR"),
        (xml([MATCH], fields={"mainProductCn": "문의 010-1234-5678"}), "SOURCE_ERROR"),
        (xml([MATCH], fields={"mainProductCn": "담당자 비공개이름"}), "SOURCE_ERROR"),
    ],
)
def test_invalid_response_never_becomes_not_found_or_leaks(
    ready, monkeypatch, caplog, payload, reason
):
    calls = responses(monkeypatch, payload)
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.registry_status is None and result.skipped_reason == reason and not result.rows
    assert len(calls) == 1 and "PRIVATE_" not in repr(result) + caplog.text


@pytest.mark.parametrize("second", ["repeat", "changed_total", "conflicting_number"])
def test_inconsistent_pages_are_not_success(ready, monkeypatch, second):
    monkeypatch.setattr(transport, "PAGE_SIZE", 1)
    row = MATCH if second != "conflicting_number" else (MATCH[0], "충남 천안시 가상로 2", "F1")
    responses(
        monkeypatch,
        xml([MATCH], total=2),
        xml([row], page=2, total=3 if second == "changed_total" else 2),
    )
    result = registry.lookup_candidate_registry(BATCH, candidate())
    assert result.registry_status is None and result.pages_read == 1
    assert result.skipped_reason == "SOURCE_ERROR"


def test_disabled_and_missing_key_make_no_call(ready, monkeypatch):
    calls = responses(monkeypatch)
    monkeypatch.delenv("DATA_GO_KR_SERVICE_KEY")
    assert registry.lookup_candidate_registry(BATCH, candidate()).skipped_reason == "SOURCE_ERROR"
    settings(enabled=False)
    assert registry.lookup_candidate_registry(BATCH, candidate()).skipped_reason == "DISABLED"
    assert not calls and not logs()


def test_source_confirmation_required(ready, monkeypatch):
    calls = responses(monkeypatch)
    with session_scope() as session:
        session.get(SourceContract, transport.SOURCE_ID).confirmed_at = None
    with pytest.raises(InputError, match="이용·저장 확인"):
        registry.lookup_candidate_registry(BATCH, candidate())
    assert not calls and not logs()


@pytest.mark.parametrize(
    "changes",
    [
        {"company_name": ""},
        {"company_name": "가상\n회사"},
        {"company_name": "전화 010-1234-5678"},
        {"source_url": "https://jobs.saramin.co.kr/ad"},
        {"snippet": "대표자 비공개이름"},
    ],
)
def test_unapproved_candidate_never_leaves_machine(ready, monkeypatch, changes):
    calls = responses(monkeypatch)
    with pytest.raises(InputError):
        registry.lookup_candidate_registry(BATCH, candidate(**changes))
    assert not calls and not logs()


def test_settings_change_during_response_invalidates_result(ready, monkeypatch):
    def request(*args, **kwargs):
        settings(enabled=False)
        return xml([MATCH])

    monkeypatch.setattr(transport, "_request_page", request)
    with pytest.raises(InputError, match="바뀌었습니다"):
        registry.lookup_candidate_registry(BATCH, candidate())
    assert len(logs()) == 1


def test_source_confirmation_revoked_during_response_invalidates_result(ready, monkeypatch):
    def request(*args, **kwargs):
        with session_scope() as session:
            session.get(SourceContract, transport.SOURCE_ID).confirmed_at = None
        return xml([MATCH])

    monkeypatch.setattr(transport, "_request_page", request)
    with pytest.raises(InputError, match="이용·저장 확인"):
        registry.lookup_candidate_registry(BATCH, candidate())
    assert len(logs()) == 1


def test_database_failure_is_never_retried_or_exposed(ready, monkeypatch, caplog):
    calls = responses(monkeypatch)
    attempts = []

    def fail(**kwargs):
        attempts.append(1)
        raise OperationalError("PRIVATE_SQL", {"body": "PRIVATE_BODY"}, OSError())

    monkeypatch.setattr(registry, "reserve_factory_registry", fail)
    with pytest.raises(RunFailedError) as error:
        registry.lookup_candidate_registry(BATCH, candidate())
    assert len(attempts) == 1 and not calls and "PRIVATE_" not in str(error.value) + caplog.text


def test_finished_batch_cannot_call(ready, monkeypatch):
    calls = responses(monkeypatch)
    with session_scope() as session:
        session.get(IngestBatch, BATCH).status = "DONE"
    with pytest.raises(InputError):
        registry.lookup_candidate_registry(BATCH, candidate())
    assert not calls and not logs()


@pytest.mark.parametrize(
    "address,expected",
    [
        ("충남 천안시 동남구 성남면 가상길 1", ("충남", "천안")),
        ("(31246) 충청남도 천안시서북구 가상로 2", ("충남", "천안")),
        ("충남 천안", ("충남", "천안")),
        ("충청남도 홍성군 은하면", ("충남", "홍성")),
        ("대전광역시 유성구 가상로 3", ("대전", "유성")),
        ("세종특별자치시 가상로 4", ("세종", "")),
        ("충남", None),
        ("", None),
        (None, None),
    ],
)
def test_city_of_an_address_is_read_the_same_way_for_web_and_registry_text(address, expected):
    from geosan.opportunity.factory_csv import address_district

    assert address_district(address) == expected


@pytest.mark.parametrize(
    "address,inside",
    [
        ("(31246) 충남 천안시 동남구 가상길 87", True),
        ("(31246)충청남도 아산시 가상로 1", True),
        ("(06000) 서울특별시 강남구 가상로 1", False),
        ("(31246)", True),
    ],
)
def test_postcode_in_front_of_a_web_address_does_not_put_it_outside_the_region(address, inside):
    """실제 검색(2026-11-13)에서 우편번호가 붙은 천안 회사가 '선택 지역 밖'으로 버려졌다."""
    from geosan.opportunity.web_candidate_store import address_in_regions

    assert address_in_regions(address, ("충남",)) is inside
