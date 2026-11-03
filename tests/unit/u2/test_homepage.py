"""공개 검색의 입력 거부·응답 오류가 '못 찾음'으로 숨지 않는지 확인한다."""

from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from geosan.capability.importer import import_capability
from geosan.config.errors import AppError, InputError
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
    with pytest.raises(AppError) as exc:
        find_case_homepage(imported.opp_id, search=Mock(return_value={"reason": "시험용 원문"}))
    assert exc.value.status == 503
    assert "시험용 원문" not in exc.value.message


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
