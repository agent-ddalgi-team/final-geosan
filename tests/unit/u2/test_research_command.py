"""C8 일괄 조사: 외부 응답만 가짜이며 명령·전송 보호·저장·재평가는 실제 사용한다."""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.config.errors import AppError
from geosan.evaluation.models import EvaluationRun
from geosan.evidence import openai_search
from geosan.evidence.homepage import find_case_homepage
from geosan.evidence.models import Evidence
from geosan.evidence.reader import Page
from geosan.evidence.research_context import current_research, research_context
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from geosan.workflows.models import FlowResult
from geosan.workflows.research import research_one
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u2 import test_extraction as extraction_support
from tests.unit.u2 import test_search_limits as search_support

extract_env = extraction_support.extract_env
search_env = search_support.search_env
runner = CliRunner()


def _real(case):
    with session_scope() as session:
        session.get(Opportunity, case.opp_id).is_virtual = False
        session.get(Customer, case.customer_id).is_virtual = False
    return case


@pytest.fixture
def batch_env(extract_env):
    case, extraction = extract_env
    return _real(case), extraction


def add_case(tmp_path, name="다음가상기업"):
    data = factories.apjeong_renamed_customer("next", name=name)
    data["customer"]["bizNumber"] = None
    return _real(import_case(_write(tmp_path, f"{name}.json", data)))


def give_address(case, *, researched):
    """회사에 홈페이지 주소를 준다. researched가 False면 조사 날짜·살아 있는 근거를 없앤다."""
    from geosan.storage.base import utcnow

    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.homepage_url = extraction_support.URL
        customer.homepage_status = "AI_FOUND"
        customer.homepage_source = "AI"
        if not researched:
            customer.researched_at = None
            for row in session.scalars(select(Evidence).where(Evidence.opp_id == case.opp_id)):
                row.superseded_at = utcnow()


def _answer(url="https://example.org/", confidence=0.9):
    response = search_support.provider_reply()
    response["output"][-1]["content"][0]["text"] = json.dumps(
        {"url": url, "confidence": confidence, "reason": "가상 검색 응답"}
    )
    return response


def test_default_chains_search_extract_and_evaluation(batch_env):
    case, _ = batch_env
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 0, result.output
    assert "찾음 · 근거 1건 · 확인된 비용 $0.018000" in result.output
    assert "저장·재평가 1건" in result.output
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        assert customer.homepage_url == "https://example.org/"
        assert customer.research_source == "AI"
        assert session.scalar(select(Evidence).where(Evidence.is_llm_proposed.is_(True)))
        assert session.scalar(select(EvaluationRun))
    assert [row.purpose for row in search_support.logs()] == ["EXTERNAL_SEARCH", "EXTERNAL_AI"]


@pytest.mark.parametrize("status", ["CONFIRMED", "AI_FOUND", "NEEDS_CONFIRMATION"])
def test_missing_skips_saved_address_and_all_reuses_it(batch_env, status):
    case, extraction = batch_env
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.homepage_url = extraction_support.URL
        customer.homepage_status = status
        customer.homepage_source = "STAFF" if status == "CONFIRMED" else "AI"
    assert runner.invoke(app, ["research", "--missing-homepage"]).exit_code == 0
    assert not search_support.logs()
    result = runner.invoke(app, ["research", "--all"])
    assert result.exit_code == 0, result.output
    assert extraction.call_count == 1
    assert [row.purpose for row in search_support.logs()] == ["EXTERNAL_AI"]
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_status == status


@pytest.mark.parametrize("url,confidence", [(None, 0.9), ("https://example.org/", 0.2)])
def test_not_found_skips_extraction_but_low_confidence_continues(batch_env, url, confidence):
    case, extraction = batch_env
    openai_search._post_response.side_effect = lambda *_: _answer(url, confidence)
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 0, result.output
    assert extraction.call_count == (0 if url is None else 1)
    assert ("못 찾음 · 근거 0건" if url is None else "확인 필요 · 근거 1건") in result.output
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        assert customer.homepage_status == ("NOT_FOUND" if url is None else "NEEDS_CONFIRMATION")


def test_one_site_failure_preserves_data_and_continues(batch_env, tmp_path, monkeypatch):
    first, _ = batch_env
    second = add_case(tmp_path)
    fetch = Mock(
        side_effect=[
            AppError("본문 읽기 실패", "주소 확인", status=422, kind="UNREACHABLE"),
            Page(extraction_support.URL, extraction_support.BODY),
        ]
    )
    monkeypatch.setattr(flow_extract, "fetch", fetch)
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 2
    assert "저장·재평가 1건" in result.output and "실패 1건" in result.output
    with session_scope() as session:
        assert session.get(Customer, first.customer_id).research_source != "AI"
        assert session.get(Customer, second.customer_id).research_source == "AI"


@pytest.mark.parametrize("setting", ["daily", "monthly", "cost", "config"])
def test_global_block_stops_remaining_companies(batch_env, tmp_path, setting):
    add_case(tmp_path)
    if setting == "daily":
        search_support.change_setting("homepageDiscovery", dailyCallLimit=0)
    elif setting == "monthly":
        search_support.change_setting("llm", monthlyCallLimit=1)
    elif setting == "cost":
        search_support.change_setting("llm", monthlyCostLimitUsd=0.01)
    elif setting == "config":
        search_support.change_setting("llm", mode="NONE")
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 2
    assert "남은 대상 1건" in result.output and "처리 1건" in result.output
    calls = sum(row.call_count for row in search_support.logs())
    assert calls == (1 if setting == "monthly" else 0)


@pytest.mark.parametrize("purpose", ["search", "extract"])
@pytest.mark.parametrize("at_limit", [False, True])
def test_missing_usage_continues_next_company_unless_estimated_budget_is_full(
    batch_env, tmp_path, purpose, at_limit
):
    first, extraction = batch_env
    second = add_case(tmp_path)
    if at_limit:
        search_support.change_setting("llm", monthlyCostLimitUsd=0.1)
    if purpose == "search":
        openai_search._post_response.side_effect = [TimeoutError(), _answer()]
    else:
        extraction.side_effect = [TimeoutError(), extraction_support.reply()]
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 2  # 첫 회사의 실패를 성공으로 숨기지 않는다.
    assert "총비용 미확정" in result.output and "처리 2건" in result.output
    if at_limit:
        assert "이번 달 비용 한도 초과" in result.output
        assert "저장·재평가 0건" in result.output
    else:
        assert "저장·재평가 1건" in result.output and "실패 1건" in result.output
        assert "조사를 멈췄습니다" not in result.output
    with session_scope() as session:
        assert session.get(Customer, first.customer_id).research_source != "AI"
        assert (session.get(Customer, second.customer_id).research_source == "AI") is not at_limit
    rows = search_support.logs()
    assert sum(row.call_count for row in rows) == (
        (1 if purpose == "search" else 2) if at_limit else (3 if purpose == "search" else 4)
    )
    assert sum(row.call_count > 0 and row.cost_usd is None for row in rows) == 1


def test_limit_leaves_unprocessed_count(batch_env, tmp_path):
    add_case(tmp_path)
    result = runner.invoke(app, ["research", "--limit", "1"])
    assert result.exit_code == 0
    assert "처리 1건" in result.output and "미처리 1건" in result.output
    assert len(search_support.logs()) == 2


@pytest.mark.parametrize(
    "args",
    [["--limit", "0"], ["--limit", "-2"], ["--limit", "abc"], ["--all", "--missing-homepage"]],
)
def test_invalid_options_make_no_calls(batch_env, args):
    result = runner.invoke(app, ["research", *args])
    assert result.exit_code == 1
    assert not search_support.logs()


@pytest.mark.parametrize(
    "excluded", ["virtual", "private", "recontact", "other_dataset", "no_case"]
)
def test_only_current_public_real_new_cases_are_selected(batch_env, excluded):
    case, _ = batch_env
    with session_scope() as session:
        opportunity = session.get(Opportunity, case.opp_id)
        if excluded == "virtual":
            opportunity.is_virtual = True
        elif excluded == "private":
            session.get(Customer, case.customer_id).security_grade = "INTERNAL_ONLY"
        elif excluded == "recontact":
            opportunity.purpose = "FOLLOW_UP_PROPOSAL"
        elif excluded == "other_dataset":
            opportunity.dataset_kind = "BROCHURE"
        else:
            opportunity.case_id = None
    result = runner.invoke(app, ["research", "--all"])
    assert result.exit_code == 0 and "처리 0건" in result.output
    assert not search_support.logs()


def test_ingested_company_is_selected_like_a_case(batch_env):
    """후보 찾기로 들어온 회사(사례 파일 아님)도 조사 대상이다(#492)."""
    case, _ = batch_env
    with session_scope() as session:
        session.get(Opportunity, case.opp_id).case_id = None
        customer = session.get(Customer, case.customer_id)
        customer.ingest_batch_id = "batch-test"
        customer.discovery_source = "FACTORY_FILE"
    result = runner.invoke(app, ["research", "--all"])
    assert result.exit_code == 0, result.output
    assert "찾음" in result.output and "저장·재평가 1건" in result.output
    assert search_support.logs()


def test_disabled_auto_research_makes_no_calls(batch_env):
    search_support.change_setting("homepageDiscovery", autoResearch=False)
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 1 and "자동 조사가 꺼져" in result.output
    assert not search_support.logs()


def test_search_time_is_deducted_from_extraction_budget(batch_env, monkeypatch):
    case, extraction = batch_env
    deadlines = []

    def search(*_):
        current_research.get().deadline -= 45
        return _answer()

    def fetch(url, deadline):
        deadlines.append(deadline - time.monotonic())
        return Page(url, extraction_support.BODY)

    openai_search._post_response.side_effect = search
    monkeypatch.setattr(flow_extract, "fetch", fetch)
    result = research_one(case.opp_id)
    assert result.error is None and extraction.call_count == 1
    assert 0 < deadlines[0] < 16
    assert current_research.get() is None


def test_search_deadline_preserves_known_cost_and_prevents_extraction(batch_env):
    case, extraction = batch_env

    def search(*_):
        current_research.get().deadline = time.monotonic() - 1
        return _answer()

    openai_search._post_response.side_effect = search
    result = research_one(case.opp_id)
    assert result.error.kind == "TIMEOUT" and extraction.call_count == 0
    assert result.cost == Decimal("0.014") and not result.usage_unconfirmed


def test_expired_budget_does_not_reserve_a_call(batch_env):
    case, _ = batch_env
    with research_context() as context:
        context.deadline = time.monotonic() - 1
        with pytest.raises(AppError) as exc:
            find_case_homepage(case.opp_id)
        assert exc.value.kind == "TIMEOUT"
    assert not search_support.logs()


def test_cost_excludes_another_context_for_same_company(batch_env, monkeypatch):
    case, _ = batch_env
    with ThreadPoolExecutor(max_workers=1) as pool:

        def fetch(url, deadline):
            def other_call():
                ticket = search_support.transfer.reserve_search(case.opp_id, True, None)
                search_support.transfer.finish_search(ticket, 1000, 200, 1, None)

            pool.submit(other_call).result()
            return Page(url, extraction_support.BODY)

        monkeypatch.setattr(flow_extract, "fetch", fetch)
        result = research_one(case.opp_id)
    assert result.error is None and result.cost == Decimal("0.018")
    assert sum(row.cost_usd for row in search_support.logs()) == Decimal("0.032")


def test_counts_are_structured_and_not_parsed_from_summary(batch_env):
    case, _ = batch_env
    result = flow_extract.run_extract(case.opp_id, extraction_support.URL)
    assert result.counts == {"evidenceCount": 1, "requirementCandidateCount": 0, "questionCount": 1}
    assert result.to_dict()["counts"] == result.counts
    assert FlowResult(ok=True).to_dict()["counts"] is None


def test_company_with_old_dataset_mark_is_researched_when_its_evaluation_is_active(batch_env):
    """#664: 영업 건 원본 표시가 활성 묶음과 달라도 최신 확정 평가가 활성 묶음이면 조사한다.

    Given 원본 표시만 다른 묶음 / When research / Then 평가가 없으면 건너뛰고, 있으면 조사한다.
    """
    from geosan.config.app_settings import read_app_settings
    from tests.unit.u7.test_geocode_target_and_warmup import add_evaluation

    case, _ = batch_env
    with session_scope() as session:
        active = read_app_settings(session).active_dataset_kind.value
        other = "BROCHURE" if active != "BROCHURE" else "COMPANY_CONFIRMED"
        session.get(Opportunity, case.opp_id).dataset_kind = other
    skipped = runner.invoke(app, ["research"])
    assert "조사할 공개 신규 사례가 없습니다" in skipped.output, skipped.output
    assert not search_support.logs()
    add_evaluation(active, number=664, opp_id=case.opp_id)
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 0, result.output
    assert "저장·재평가 1건" in result.output
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_url == "https://example.org/"


# ---------- #690: 기본 대상 ----------


def test_default_also_picks_companies_with_address_but_no_research(batch_env, tmp_path):
    """Given 주소 없는 회사와 주소만 있는 조사 전 회사 / When 기본 실행 / Then 둘 다 조사한다."""
    case, extraction = batch_env
    give_address(case, researched=False)
    missing = add_case(tmp_path, "주소없는가상기업")
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 0, result.output
    assert "처리 2건" in result.output and "저장·재평가 2건" in result.output
    assert extraction.call_count == 2
    # 주소가 있던 회사는 홈페이지 찾기 검색을 타지 않는다: 검색은 주소 없는 회사 한 번뿐이다.
    searches = [row for row in search_support.logs() if row.purpose == "EXTERNAL_SEARCH"]
    assert [row.opp_id for row in searches] == [missing.opp_id]


@pytest.mark.parametrize("left", ["researched_at", "evidence"])
def test_default_skips_address_companies_that_still_have_research_traces(batch_env, left):
    """Given 주소 있는 회사에 조사 날짜나 살아 있는 근거가 남음 / Then 기본 대상이 아니다."""
    case, extraction = batch_env
    give_address(case, researched=True)
    with session_scope() as session:
        if left == "evidence":
            session.get(Customer, case.customer_id).researched_at = None
        else:
            from geosan.storage.base import utcnow

            for row in session.scalars(select(Evidence).where(Evidence.opp_id == case.opp_id)):
                row.superseded_at = utcnow()
    result = runner.invoke(app, ["research"])
    assert result.exit_code == 0 and "처리 0건" in result.output
    assert extraction.call_count == 0 and not search_support.logs()


def test_missing_homepage_flag_still_means_only_companies_without_address(batch_env):
    """Given 주소만 있는 조사 전 회사 / When --missing-homepage / Then 지금처럼 고르지 않는다."""
    case, extraction = batch_env
    give_address(case, researched=False)
    result = runner.invoke(app, ["research", "--missing-homepage"])
    assert result.exit_code == 0 and "처리 0건" in result.output
    assert extraction.call_count == 0
