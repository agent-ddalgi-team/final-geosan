"""#252: 실제 임시 DB와 공개 조사 흐름으로 실패 종류·보존 동작을 확인한다."""

import time
from decimal import Decimal
from unittest.mock import Mock

import pytest

from geosan.config.errors import AppError
from geosan.evidence import openai_search, reader
from geosan.evidence.homepage import find_case_homepage
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as extraction_support
from tests.unit.u2 import test_search_limits as search_support

search_env = search_support.search_env
extract_env = extraction_support.extract_env
CONFIG_MESSAGE = "AI 조사 설정이 아직 되어 있지 않습니다"
USAGE_MESSAGE = "AI 사용 기록에 문제가 있어 조사를 멈췄습니다"
OPERATOR_ACTION = "문의 번호와 함께 운영자에게 알려 주세요"


def invoke(case, purpose):
    if purpose == "search":
        return find_case_homepage(case.opp_id)
    result = run_extract(case.opp_id, extraction_support.URL)
    if not result.ok:
        raise result.error
    return result


def assert_error(error, kind, message=None):
    body = error.to_error_body()["error"]
    assert error.status == 503
    assert set(body) == {"message", "nextAction", "ref", "kind"}
    assert body["kind"] == kind and body["ref"]
    assert "test-only-placeholder" not in str(body)
    if message:
        assert body["message"] == message
        assert body["nextAction"] == OPERATOR_ACTION


@pytest.mark.parametrize("purpose", ["search", "extract"])
@pytest.mark.parametrize(
    "section,values",
    [
        ("llm", {"mode": "NONE"}),
        ("llm", {"model": "", "allowedModels": []}),
        ("llm", {"allowedModels": []}),
        ("llm", {"inputCostPerMillionTokens": 0}),
        ("llm", {"outputCostPerMillionTokens": 0}),
    ],
)
def test_configuration_failure_never_sends(extract_env, purpose, section, values):
    case, transport = extract_env
    search_support.change_setting(section, **values)
    with pytest.raises(AppError) as caught:
        invoke(case, purpose)
    assert_error(caught.value, "LLM_NOT_CONFIGURED", CONFIG_MESSAGE)
    transport.assert_not_called()
    assert search_support.logs()[0].call_count == 0


@pytest.mark.parametrize("purpose", ["search", "extract"])
def test_missing_key_is_operator_action(extract_env, monkeypatch, purpose):
    case, transport = extract_env
    monkeypatch.delenv("OPENAI_API_KEY")
    with pytest.raises(AppError) as caught:
        invoke(case, purpose)
    assert_error(caught.value, "LLM_NOT_CONFIGURED", CONFIG_MESSAGE)
    transport.assert_not_called()
    assert search_support.logs()[0].call_count == 0


@pytest.mark.parametrize(
    "section,values",
    [
        ("homepageDiscovery", {"enabled": False}),
        ("llm", {"webSearchCostPerThousandCalls": 0}),
    ],
)
def test_search_configuration_errors(search_env, section, values):
    case, transport = search_env
    search_support.change_setting(section, **values)
    with pytest.raises(AppError) as caught:
        invoke(case, "search")
    assert_error(caught.value, "LLM_NOT_CONFIGURED", CONFIG_MESSAGE)
    transport.assert_not_called()


@pytest.mark.parametrize("purpose", ["search", "extract"])
@pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
def test_provider_failure_kind_preserves_retry_and_accounting(
    extract_env, monkeypatch, purpose, status
):
    case, transport = extract_env
    if purpose == "search":
        transport = Mock(side_effect=openai_search._HttpError(status))
        monkeypatch.setattr(openai_search, "_post_response", transport)
    else:
        transport.side_effect = openai_search._HttpError(status)
    before = extraction_support.counts()
    with pytest.raises(AppError) as caught:
        invoke(case, purpose)
    kind = "LLM_NOT_CONFIGURED" if status in (401, 403, 404) else "LLM_FAILED"
    assert_error(caught.value, kind, CONFIG_MESSAGE if kind == "LLM_NOT_CONFIGURED" else None)
    assert transport.call_count == (2 if status == 429 else 1)
    assert extraction_support.counts() == before
    assert all(
        row.cost_usd == (Decimal(0) if status < 500 else None) for row in search_support.logs()
    )


@pytest.mark.parametrize("purpose", ["search", "extract"])
@pytest.mark.parametrize("failure", [TimeoutError("test-only-placeholder"), ValueError("bad JSON")])
def test_failed_response_can_be_repeated_within_budget(extract_env, monkeypatch, purpose, failure):
    # Given: 공개 회사와 외부 호출 설정, 아직 결과가 저장되지 않은 상태.
    case, transport = extract_env
    if purpose == "search":
        transport = Mock(side_effect=failure)
        monkeypatch.setattr(openai_search, "_post_response", transport)
    else:
        transport.side_effect = failure
    before = extraction_support.counts()
    # When: 응답을 받지 못한 뒤 같은 회사를 다시 조사한다.
    with pytest.raises(AppError) as first:
        invoke(case, purpose)
    with pytest.raises(AppError) as second:
        invoke(case, purpose)
    # Then: 두 요청 모두 재시도 가능한 실패이며 실패한 내용을 저장하지 않는다(#538 PM 결정).
    assert_error(first.value, "LLM_FAILED")
    assert_error(second.value, "LLM_FAILED")
    assert transport.call_count == 2
    assert extraction_support.counts() == before
    assert [(row.call_count, row.cost_usd) for row in search_support.logs()] == [
        (1, None),
        (1, None),
    ]


@pytest.mark.parametrize("purpose", ["search", "extract"])
def test_invalid_output_preserves_paid_usage(extract_env, monkeypatch, purpose):
    case, transport = extract_env
    response = (
        extraction_support.reply() if purpose == "extract" else search_support.provider_reply()
    )
    response["output"][-1]["content"][0]["text"] = "invalid JSON"
    if purpose == "search":
        transport = Mock(return_value=response)
        monkeypatch.setattr(openai_search, "_post_response", transport)
    else:
        transport.side_effect = None
        transport.return_value = response
    before = extraction_support.counts()
    with pytest.raises(AppError) as caught:
        invoke(case, purpose)
    assert_error(caught.value, "LLM_FAILED")
    assert search_support.logs()[0].cost_usd > 0
    assert extraction_support.counts() == before


def test_elapsed_deadline_is_timeout():
    with pytest.raises(AppError) as caught:
        reader.remaining(time.monotonic() - 1)
    assert_error(caught.value, "TIMEOUT")


def test_deadline_during_last_read_attempt_is_timeout(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(reader.time, "monotonic", lambda: clock[0])

    def failed_read(*_):
        clock[0] += 31
        raise TimeoutError("test-only-placeholder")

    monkeypatch.setattr(reader, "_get", failed_read)
    with pytest.raises(AppError) as caught:
        reader._read("https://example.org/", 60)
    assert_error(caught.value, "TIMEOUT")


def test_extraction_deadline_error_is_not_hidden(extract_env, monkeypatch):
    case, transport = extract_env
    clock = [0.0]
    monkeypatch.setattr(reader.time, "monotonic", lambda: clock[0])

    def timed_out(*_):
        clock[0] = 61
        raise TimeoutError("test-only-placeholder")

    transport.side_effect = timed_out
    with pytest.raises(AppError) as caught:
        invoke(case, "extract")
    assert_error(caught.value, "TIMEOUT")
    transport.assert_called_once()
