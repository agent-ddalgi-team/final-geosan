import pytest
from pytest_bdd import given, scenarios, then, when

from geosan.config.errors import AppError
from geosan.evidence.sales_record_gate import (
    DISABLED_MESSAGE,
    NOT_SCRUBBED_MESSAGE,
    ScrubbedRecordText,
    reserve_sales_records,
    scrub_sales_record,
)
from geosan.evidence.transfer import reserve_extraction
from tests.unit.u2 import test_search_limits as support

search_env = support.search_env
scenarios("u2/sales_record_gate.feature")

MEMO = "김철수 과장과 통화. 직통 010-0000-0000, 메일 kim@example.com. 아연도금 월 2톤 외주 중."


@given("영업 기록 전용 스위치가 꺼져 있다")
def switch_off(search_env):
    """예시 설정의 기본값 그대로다(꺼짐)."""


@given("영업 기록 전용 스위치가 켜져 있다")
def switch_on(search_env):
    support.change_setting("llm", salesRecordsEnabled=True)


def _try(search_env, texts):
    try:
        return reserve_sales_records(search_env[0].opp_id, texts, True, None, "park-lee")
    except AppError as error:
        return error


@when("연락처와 이름을 지운 영업 기록 글을 보내려고 한다", target_fixture="outcome")
def send_scrubbed(search_env):
    texts = [scrub_sales_record(MEMO)]
    return texts, _try(search_env, texts)


@when("대표번호가 남아 있는 글을 보내려고 한다", target_fixture="outcome")
def send_with_main_phone(search_env):
    texts = [scrub_sales_record(MEMO), ScrubbedRecordText("대표번호 041-000-0000으로 연락", 0, 0)]
    return texts, _try(search_env, texts)


@when("지우기를 거치지 않은 메모를 그대로 보내려고 한다", target_fixture="outcome")
def send_raw(search_env):
    texts = [MEMO]
    return texts, _try(search_env, texts)


@when("공개 홈페이지 글의 AI 조사를 예약한다", target_fixture="outcome")
def reserve_public(search_env):
    return None, reserve_extraction(search_env[0].opp_id, True, None, "park-lee")


def _only_log():
    (row,) = support.logs()
    return row


@then("설정이 꺼져 있다는 이유로 거부되고 거부 기록 한 줄이 남는다")
def rejected_disabled(outcome):
    error = outcome[1]
    assert isinstance(error, AppError)
    assert (error.status, error.kind, error.message) == (
        422,
        "SALES_RECORDS_DISABLED",
        DISABLED_MESSAGE,
    )
    row = _only_log()
    assert (row.purpose, row.kind, row.decision, row.call_count) == (
        "EXTERNAL_AI",
        "SALES_RECORD",
        "REJECTED",
        0,
    )
    assert row.reject_reason == DISABLED_MESSAGE and row.requested_by == "park-lee"


@then("지우기를 거치지 않았다는 이유로 거부되고 거부 기록 한 줄이 남는다")
def rejected_not_scrubbed(outcome):
    error = outcome[1]
    assert isinstance(error, AppError) and error.status == 422
    assert error.message == NOT_SCRUBBED_MESSAGE
    row = _only_log()
    assert (row.kind, row.decision, row.call_count) == ("SALES_RECORD", "REJECTED", 0)
    assert row.reject_reason == NOT_SCRUBBED_MESSAGE
    assert "041-000-0000" not in str(row.__dict__) and "김철수" not in str(row.__dict__)


@then("호출 한 번이 영업 기록 종류로 기록되고 글에는 연락처와 이름이 없다")
def allowed(outcome):
    texts, ticket = outcome
    assert not isinstance(ticket, AppError)
    (item,) = texts
    assert item.text == (
        "[이름] 과장과 통화. 직통 [연락처 제거], 메일 [연락처 제거]. 아연도금 월 2톤 외주 중."
    )
    assert (item.removed_contacts, item.removed_names) == (2, 1)
    row = _only_log()
    assert row.transfer_log_id == ticket.log_id
    assert (row.purpose, row.kind, row.security_grade, row.decision, row.call_count) == (
        "EXTERNAL_AI",
        "SALES_RECORD",
        "EXTERNAL_AI_OK",
        "ALLOWED",
        1,
    )
    assert "아연도금" not in str(row.__dict__)


@then("호출 한 번이 공개 글 종류로 기록된다")
def public_still_works(outcome):
    assert not isinstance(outcome[1], AppError)
    row = _only_log()
    assert (row.kind, row.security_grade, row.decision, row.call_count) == (
        "PUBLIC_TEXT",
        "PUBLIC",
        "ALLOWED",
        1,
    )


@pytest.fixture(autouse=True)
def _no_real_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
