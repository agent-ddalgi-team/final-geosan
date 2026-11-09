"""공개 검색의 입력 거부·응답 오류가 '못 찾음'으로 숨지 않는지 확인한다."""

from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from geosan.capability.importer import import_capability
from geosan.config.errors import AppError, InputError
from geosan.config.models import AppSetting
from geosan.evidence.homepage import HomepageSearchResult, find_case_homepage
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope

REPLY = {
    "provider": "OPENAI_WEB_SEARCH",
    "url": "https://example.org/products",
    "confidence": 0.8,
    "reason": "시험용 공식 홈페이지",
    "fetchedAt": "2026-11-03T09:00:00+09:00",
}


@pytest.fixture
def imported(tmp_db, capability_file_path, apjeong_case_path):
    import_capability(capability_file_path)
    return import_case(apjeong_case_path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("security_grade", "INTERNAL_ONLY"),
        ("security_grade", "EXTERNAL_AI_OK"),
        ("security_grade", "UNKNOWN"),
        ("normalized_address", None),
        ("name", " "),
        ("name", "가상회사 test@example.invalid"),
        ("normalized_address", "가상주소 ０２１２３４５６７８"),
        ("name", "가상회사 010-0000-0000"),
        ("name", "가상회사 0507-0000-0000"),
        ("name", "가상회사 1588-0000"),
        ("normalized_address", "가상주소 +82 10 00000000"),
    ],
)
def test_disallowed_case_never_calls_adapter(imported, field, value):
    with session_scope() as session:
        setattr(session.get(Customer, imported.customer_id), field, value)
    search = Mock()
    with pytest.raises(InputError) as exc:
        find_case_homepage(imported.opp_id, search=search)
    search.assert_not_called()
    if isinstance(value, str) and value.strip():
        assert value not in exc.value.message


def test_unidentified_source_never_searches(imported):
    with session_scope() as session:
        session.get(Opportunity, imported.opp_id).case_id = None
    search = Mock()
    for opp_id in (imported.opp_id, "missing"):
        with pytest.raises(InputError):
            find_case_homepage(opp_id, search=search)
    search.assert_not_called()


def _as_ingested(imported, *, batch_id="batch-test"):
    """사례 파일이 아니라 후보 찾기 회차로 들어온 회사 모양으로 바꾼다(#492)."""
    with session_scope() as session:
        session.get(Opportunity, imported.opp_id).case_id = None
        customer = session.get(Customer, imported.customer_id)
        customer.ingest_batch_id = batch_id
        customer.discovery_source = "FACTORY_FILE"


def test_ingested_company_is_searched_and_stored(imported):
    """후보 찾기로 들어온 회사(사례 파일 아님)도 공개 출처로 보고 검색·저장한다(#492)."""
    _as_ingested(imported)
    search = Mock(return_value=REPLY)
    result = find_case_homepage(imported.opp_id, search=search)
    search.assert_called_once()
    with session_scope() as session:
        customer = session.get(Customer, imported.customer_id)
        assert customer.homepage_url == REPLY["url"] == result.url
        assert customer.homepage_source == "AI"


def test_ingested_company_still_requires_public_grade(imported):
    """출처가 있어도 보안 등급이 PUBLIC이 아니면 검색하지 않는다(#492)."""
    _as_ingested(imported)
    with session_scope() as session:
        session.get(Customer, imported.customer_id).security_grade = "INTERNAL_ONLY"
    search = Mock()
    with pytest.raises(InputError):
        find_case_homepage(imported.opp_id, search=search)
    search.assert_not_called()


@pytest.mark.parametrize(
    "changes",
    [
        {"url": "javascript:alert(1)"},
        {"url": "https:///broken"},
        {"url": "https://test@example.org"},
        {"confidence": "0.8"},
        {"confidence": True},
        {"confidence": 1.1},
        {"confidence": float("nan")},
        {"reason": " "},
        {"fetchedAt": "2026-11-03T09:00:00"},
        {"provider": "다른 응답"},
        {"memo": "응답에 섞이면 안 되는 값"},
    ],
)
def test_invalid_reply_is_a_failure(changes):
    with pytest.raises(ValidationError):
        HomepageSearchResult.model_validate({**REPLY, **changes})


def test_result_uses_supplied_threshold():
    result = HomepageSearchResult.model_validate(REPLY)
    assert result.status(0.8) == "AI_FOUND"
    assert result.status(0.81) == "NEEDS_CONFIRMATION"
    with pytest.raises(ValidationError):
        result.status(-1)


def test_missing_result_fields_do_not_become_not_found(imported):
    find_case_homepage(imported.opp_id, search=Mock(return_value=REPLY))
    with pytest.raises(AppError) as exc:
        find_case_homepage(imported.opp_id, search=Mock(return_value={"reason": "시험용 원문"}))
    assert exc.value.status == 503
    assert "시험용 원문" not in exc.value.message
    with session_scope() as session:
        assert session.get(Customer, imported.customer_id).homepage_url == REPLY["url"]


def test_store_uses_registered_threshold_and_preserves_reply(imported):
    with session_scope() as session:
        row = session.get(AppSetting, "homepageDiscovery")
        row.value = {**row.value, "minConfidence": 0.85}
    for _ in range(2):
        result = find_case_homepage(imported.opp_id, search=Mock(return_value=REPLY))
    with session_scope() as session:
        customer = session.get(Customer, imported.customer_id)
        assert customer.homepage_status == "NEEDS_CONFIRMATION"
        assert customer.homepage_source == "AI"
        assert customer.homepage_url == result.url
        assert customer.homepage_confidence == result.confidence
        assert customer.homepage_reason == result.reason
        assert customer.homepage_fetched_at == result.fetched_at


def test_older_search_cannot_replace_newer_result(imported):
    find_case_homepage(imported.opp_id, search=Mock(return_value=REPLY))
    older = {**REPLY, "url": None, "fetchedAt": "2026-11-02T09:00:00+09:00"}
    with pytest.raises(AppError) as exc:
        find_case_homepage(imported.opp_id, search=Mock(return_value=older))
    assert exc.value.status == 409
    with session_scope() as session:
        assert session.get(Customer, imported.customer_id).homepage_url == REPLY["url"]


def test_newer_not_found_clears_previous_ai_url(imported):
    find_case_homepage(imported.opp_id, search=Mock(return_value=REPLY))
    missing = {**REPLY, "url": None, "fetchedAt": "2026-11-04T09:00:00+09:00"}
    find_case_homepage(imported.opp_id, search=Mock(return_value=missing))
    with session_scope() as session:
        customer = session.get(Customer, imported.customer_id)
        assert customer.homepage_status == "NOT_FOUND"
        assert customer.homepage_url is None


def test_reply_not_stored_if_case_is_no_longer_public(imported):
    def change_grade(name, address):
        with session_scope() as session:
            session.get(Customer, imported.customer_id).security_grade = "INTERNAL_ONLY"
        return REPLY

    with pytest.raises(AppError) as exc:
        find_case_homepage(imported.opp_id, search=change_grade)
    assert exc.value.status == 409
    with session_scope() as session:
        assert session.get(Customer, imported.customer_id).homepage_status is None


def test_staff_confirmation_during_search_is_preserved(imported):
    def confirm_during_search(name, address):
        with session_scope() as session:
            customer = session.get(Customer, imported.customer_id)
            customer.homepage_status = "CONFIRMED"
            customer.homepage_source = "STAFF"
            customer.homepage_url = "https://confirmed.example.org/"
        return REPLY

    with pytest.raises(AppError) as exc:
        find_case_homepage(imported.opp_id, search=confirm_during_search)
    assert exc.value.kind == "STALE_VALUE"
    search = Mock()
    with pytest.raises(InputError):
        find_case_homepage(imported.opp_id, search=search)
    search.assert_not_called()
    with session_scope() as session:
        customer = session.get(Customer, imported.customer_id)
        assert customer.homepage_source == "STAFF"
        assert customer.homepage_url == "https://confirmed.example.org/"


def test_adapter_failure_does_not_become_not_found(imported):
    failure = AppError(
        message="이번 달 검색 한도에 도달했습니다.",
        next_action="다음 달에 다시 조사하세요.",
        status=503,
        kind="LLM_LIMIT",
    )
    with pytest.raises(AppError) as exc:
        find_case_homepage(imported.opp_id, search=Mock(side_effect=failure))
    assert exc.value is failure
