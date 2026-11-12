"""#596: 카드 "점수 전" 옆 조사 상태(researchState)를 회사 행과 마지막 찾기 회차로 정한다."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from geosan.api.ingest_views import research_state
from geosan.api.schemas import OpportunityCard

NOW = datetime(2026, 11, 12, tzinfo=UTC)


def company(**overrides):
    values = {
        "researched_at": None,
        "ingest_batch_id": "batch-1",
        "homepage_status": None,
        "homepage_url": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def batch(status="DONE", new_count=10, research_done_count=10, batch_id="batch-1"):
    return SimpleNamespace(
        batch_id=batch_id,
        status=status,
        new_count=new_count,
        research_done_count=research_done_count,
    )


def test_finished_research_and_case_file_companies_have_no_state():
    """Given 조사가 끝난 회사·사례 파일 회사 / Then 꼬리표 없음(점수가 보인다)."""
    assert research_state(company(researched_at=NOW), batch()) is None
    assert research_state(company(ingest_batch_id=None), batch()) is None


@pytest.mark.parametrize(
    "progress",
    [
        batch(status="RUNNING", research_done_count=0),
        batch(status="DONE", new_count=10, research_done_count=3),
    ],
)
def test_company_of_a_batch_still_researching_is_running(progress):
    """Given 마지막 회차가 아직 찾거나 조사하는 중 / Then "조사 중"(목록 머리 "조사 n/m" 기준)."""
    assert research_state(company(homepage_status="NOT_FOUND"), progress) == "RUNNING"


@pytest.mark.parametrize(
    "customer,expected",
    [
        (company(homepage_status="NOT_FOUND"), "NOT_FOUND"),
        (company(homepage_status="AI_FOUND", homepage_url="https://a.example/"), "READ_FAILED"),
        (company(), "NOT_TRIED"),
    ],
)
def test_finished_or_other_batch_shows_why_research_is_missing(customer, expected):
    """Given 조사가 끝난 회차(또는 예전 회차) / Then 못 찾음·읽기 실패·시도 안 함을 나눠 보인다."""
    assert research_state(customer, batch()) == expected
    assert research_state(customer, batch(status="FAILED", research_done_count=0)) == expected
    assert research_state(customer, batch(status="RUNNING", batch_id="batch-2")) == expected
    assert research_state(customer, None) == expected


def test_card_accepts_only_contract_values():
    """약속 C1 researchState 값 4개만 받는다."""
    fields = OpportunityCard.model_fields["research_state"]
    assert fields.default is None
    with pytest.raises(ValidationError):
        OpportunityCard.model_validate({"researchState": "DONE"})
