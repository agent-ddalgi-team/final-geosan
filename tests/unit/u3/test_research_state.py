"""#596: 점수가 아직 없는 찾은 회사의 조사 상태(researchState)를 정한다.

카드는 RUNNING이면 "조사 중", 나머지는 "조사 중단"만 보이고 상세가 이유를 보인다
(PM 결정 2026-11-12).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from geosan.api.ingest_views import research_state
from geosan.api.schemas import DetailHeader, OpportunityCard

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


def test_scored_and_case_file_companies_have_no_state():
    """Given 점수가 나온 회사·사례 파일 회사 / Then 꼬리표 없음."""
    assert research_state(company(), batch(status="RUNNING"), scored=True) is None
    assert research_state(company(researched_at=NOW), batch(), scored=True) is None
    assert research_state(company(ingest_batch_id=None), batch(), scored=False) is None


@pytest.mark.parametrize(
    "progress",
    [
        batch(status="RUNNING", research_done_count=0),
        batch(status="DONE", new_count=10, research_done_count=3),
    ],
)
def test_company_of_a_batch_still_researching_is_running(progress):
    """Given 마지막 회차가 아직 찾거나 조사하는 중 / Then "조사 중"(목록 머리 "조사 n/m" 기준)."""
    customer = company(homepage_status="NOT_FOUND")
    assert research_state(customer, progress, scored=False) == "RUNNING"


@pytest.mark.parametrize(
    "customer,expected",
    [
        (company(researched_at=NOW, homepage_status="AI_FOUND"), "NO_SCORE_EVIDENCE"),
        (company(homepage_status="NOT_FOUND"), "NOT_FOUND"),
        (company(homepage_status="AI_FOUND", homepage_url="https://a.example/"), "READ_FAILED"),
        (company(), "NOT_TRIED"),
    ],
)
def test_stopped_research_keeps_the_reason_for_the_detail(customer, expected):
    """Given 조사가 멈춘 회사 / Then 이유를 나눠 둔다(카드는 "조사 중단", 상세는 이유)."""
    assert research_state(customer, batch(), scored=False) == expected
    failed = batch(status="FAILED", research_done_count=0)
    assert research_state(customer, failed, scored=False) == expected
    other = batch(status="RUNNING", batch_id="batch-2")
    assert research_state(customer, other, scored=False) == expected
    assert research_state(customer, None, scored=False) == expected


def test_card_and_header_accept_only_contract_values():
    """약속 C1 researchState 값 5개만 받고, 없으면 null이다."""
    for model in (OpportunityCard, DetailHeader):
        assert model.model_fields["research_state"].default is None
        with pytest.raises(ValidationError):
            model.model_validate({"researchState": "DONE"})
