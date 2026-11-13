"""#688(#314): 웹 검색 갈래를 후보 찾기 흐름에 잇는다.

웹 검색·공장등록 조회의 바깥 통신만 가짜로 바꾸고, 보관·판단 기록·등록·평가는 실제 부품이다.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.config.errors import AppError, RunFailedError
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.candidate_registry import RegistryLookupResult
from geosan.opportunity.candidate_web import CandidateSearchResult, load_search_context
from geosan.opportunity.candidate_web_results import WebSearchCandidate
from geosan.opportunity.complex_rows import ComplexFactoryRow
from geosan.opportunity.models import Customer, Opportunity
from geosan.opportunity.source_models import SourceContract, WebCandidate
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows import flow_ingest as flow
from geosan.workflows import ingest_web
from geosan.workflows.research import ResearchResult
from tests.unit.u3.test_flow_ingest import _brochure_runtime, new_batch, saved
from tests.unit.u3.test_flow_ingest import ingest_env as ingest_env

WEB_ADDRESS = "충청남도 아산시 가상길 9"


def web_company(name="가상 웹볼트사", address=WEB_ADDRESS, snippet="가상 볼트"):
    return WebSearchCandidate(name, address, "https://web.example/products", snippet)


@pytest.fixture
def web_env(ingest_env, monkeypatch):
    """웹 검색을 켜고 공장등록 조회 소스의 이용 확인을 기록한다. 바깥 통신 두 곳만 가짜다."""
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.candidate_web_search.enabled = True
        sync_app_settings(session, settings)
        session.add(
            SourceContract(
                source_id="kicox-production-api",
                source_name="가상 조회",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
    state = SimpleNamespace(searches=0, lookups=[], found=[web_company()], skipped=None, answers={})

    def search(batch_id):
        context = load_search_context(batch_id)
        now = utcnow()
        if state.skipped:
            return CandidateSearchResult((), 0, context.criteria_hash, now, now, state.skipped)
        state.searches += 1
        return CandidateSearchResult(
            tuple(state.found), 2, context.criteria_hash, now, now + timedelta(days=1)
        )

    def lookup(batch_id, candidate):
        state.lookups.append(candidate.company_name)
        answer = state.answers.get(candidate.company_name, "FOUND")
        if isinstance(answer, RegistryLookupResult):
            return answer
        return RegistryLookupResult(registry_status=answer)

    monkeypatch.setattr(ingest_web, "search_candidates", search)
    monkeypatch.setattr(ingest_web, "lookup_candidate_registry", lookup)
    return state


def customers():
    with session_scope() as session:
        return {
            row.name: (row.discovery_source, row.discovery_source_url, row.registry_status)
            for row in session.scalars(select(Customer))
        }


def web_rows():
    with session_scope() as session:
        return {
            row.company_name: (row.registry_status, row.dropped_reason)
            for row in session.scalars(select(WebCandidate))
        }


def registered_row(name, address):
    return ComplexFactoryRow(
        company_name=name,
        complex_name=None,
        product="가상 볼트",
        address=address,
        region="충남",
        product_hash="hash",
        industry_name=None,
        factory_manage_no="F1",
    )


def test_setting_off_makes_no_web_search(web_env):
    """Given 웹 검색 끔 / When 후보 찾기 / Then 검색 0건, 공공자료 회사는 그대로 들어온다."""
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.candidate_web_search.enabled = False
        sync_app_settings(session, settings)
    batch = saved_after(new_batch())
    assert web_env.searches == 0 and not web_env.lookups and not web_rows()
    assert (batch.status, batch.new_count) == ("DONE", 1)
    assert (batch.web_search_used, batch.web_skipped_reason) == (False, "DISABLED")


def saved_after(batch_id):
    flow.run_ingest(batch_id)
    return saved(batch_id)


def test_registered_web_company_joins_the_same_batch_with_its_source(web_env):
    """Given 등록 확인된 웹 회사 / When 후보 찾기 / Then 공공자료 회사 뒤에 출처와 함께 들어온다."""
    batch = saved_after(new_batch())
    assert (batch.status, batch.new_count, batch.skipped_count) == ("DONE", 2, 0)
    assert (batch.web_search_used, batch.web_from_cache, batch.web_skipped_reason) == (
        True,
        False,
        None,
    )
    assert (batch.web_candidate_count, batch.web_dropped_count) == (1, 2)
    listed = customers()
    assert listed["가상 볼트사"][0] == "FACTORY_FILE"
    assert listed["가상 웹볼트사"] == ("WEB_SEARCH", "https://web.example/products", "FOUND")
    assert web_rows() == {"가상 웹볼트사": ("FOUND", None)}
    with session_scope() as session:
        opp_id = session.scalar(
            select(Opportunity.opp_id)
            .join(Customer, Customer.customer_id == Opportunity.customer_id)
            .where(Customer.name == "가상 웹볼트사")
        )
        assert session.scalar(select(EvaluationRun.opp_id).where(EvaluationRun.opp_id == opp_id))


def test_daily_limit_skips_only_the_web_branch(web_env):
    web_env.skipped = "DAILY_LIMIT"
    batch = saved_after(new_batch())
    assert (batch.status, batch.new_count) == ("DONE", 1)
    assert (batch.web_search_used, batch.web_skipped_reason) == (False, "DAILY_LIMIT")
    assert not web_rows() and not web_env.lookups


def test_same_conditions_reuse_the_stored_search(web_env):
    saved_after(new_batch())
    second = saved_after(new_batch())
    assert web_env.searches == 1 and web_env.lookups == ["가상 웹볼트사"]
    assert (second.web_search_used, second.web_from_cache) == (True, True)
    assert (second.new_count, second.skipped_count) == (0, 2)


def test_failed_public_branch_never_starts_web_search(web_env, monkeypatch):
    def failed(batch_id):
        raise RunFailedError("가상 실패")

    monkeypatch.setattr(flow, "load_source_rows", failed)
    batch_id = new_batch()
    with pytest.raises(RunFailedError):
        flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert batch.status == "FAILED" and web_env.searches == 0
    assert (batch.web_search_used, batch.web_skipped_reason) == (False, None)


@pytest.mark.parametrize("reason", ["DAILY_LIMIT", "SOURCE_ERROR"])
def test_unfinished_lookup_stays_pending_and_resumes_without_another_search(web_env, reason):
    """조회를 끝내지 못한 회사는 목록에 넣지 않고, 다음에 검색 없이 조회만 잇는다."""
    web_env.found = [web_company(), web_company("가상 웹너트사", "충청남도 아산시 가상길 10")]
    for name in ("가상 웹볼트사", "가상 웹너트사"):
        web_env.answers[name] = RegistryLookupResult(skipped_reason=reason)
    first = saved_after(new_batch())
    assert first.status == "DONE" and set(customers()) == {"가상 볼트사"}
    assert set(web_rows().values()) == {("PENDING", None)}
    # 한도면 남은 후보도 조회하지 않는다. 일시 오류면 다음 후보로 넘어간다.
    assert len(web_env.lookups) == (1 if reason == "DAILY_LIMIT" else 2)
    web_env.answers.clear()
    second = saved_after(new_batch())
    assert web_env.searches == 1 and second.web_from_cache is True
    assert {"가상 웹볼트사", "가상 웹너트사"} <= set(customers())
    assert web_rows() == {"가상 웹볼트사": ("FOUND", None), "가상 웹너트사": ("FOUND", None)}


def test_company_already_listed_keeps_its_first_source(web_env):
    """Given 공장현황 파일로 들어온 회사 / When 웹에서도 나옴 / Then 새로 넣지 않고 출처 그대로."""
    web_env.found = [web_company("가상 볼트사", "충청남도 당진시 가상길 1")]
    batch = saved_after(new_batch())
    assert (batch.new_count, batch.skipped_count) == (1, 1)
    assert customers() == {"가상 볼트사": ("FACTORY_FILE", None, None)}
    assert web_rows() == {"가상 볼트사": ("FOUND", None)}


def test_uncertain_or_out_of_region_companies_are_kept_out_with_a_reason(web_env):
    web_env.found = [
        web_company("가상 주소다름사"),
        web_company("가상 주소없음사", None),
        web_company("가상 부분이름사"),
        web_company("가상 다른지역사", "경기도 화성시 가상길 1"),
        web_company("가상 요약없음사", "충청남도 아산시 가상길 11", None),
    ]
    other = "충청남도 천안시 다른길 1"
    for name in ("가상 주소다름사", "가상 주소없음사"):
        web_env.answers[name] = RegistryLookupResult(
            rows=(registered_row(name, other),), needs_confirmation=True
        )
    web_env.answers["가상 부분이름사"] = RegistryLookupResult(
        rows=(registered_row("가상 부분이름사상사", other),), needs_confirmation=True
    )
    batch = saved_after(new_batch())
    assert batch.status == "DONE" and set(customers()) == {"가상 볼트사"}
    assert web_rows() == {
        "가상 주소다름사": ("NOT_FOUND", "등록 주소 불일치"),
        "가상 주소없음사": ("NOT_FOUND", "주소 없음 · 확인 필요"),
        "가상 부분이름사": ("NOT_FOUND", None),
        "가상 다른지역사": ("PENDING", "선택 지역 밖"),
        "가상 요약없음사": ("FOUND", "생산품 요약 확인 불가"),
    }
    assert "가상 다른지역사" not in web_env.lookups
    assert (batch.web_candidate_count, batch.web_dropped_count) == (5, 2 + 4)


def test_web_company_fills_only_the_room_left_by_the_public_branch(web_env):
    batch = saved_after(new_batch(maximum=1))
    assert batch.new_count == 1 and set(customers()) == {"가상 볼트사"}
    assert web_rows() == {"가상 웹볼트사": ("FOUND", None)}


def test_missing_registry_approval_fails_before_spending_a_search(web_env):
    with session_scope() as session:
        session.get(SourceContract, "kicox-production-api").confirmed_at = None
    batch_id = new_batch()
    with pytest.raises(RunFailedError, match="공장등록 조회 소스"):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "FAILED" and web_env.searches == 0
    # 공공자료 갈래에서 이미 들어간 회사는 되돌리지 않는다.
    assert set(customers()) == {"가상 볼트사"}


def test_research_runs_after_both_branches_are_registered(web_env, monkeypatch):
    _brochure_runtime()
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.candidate_web_search.enabled = True
        sync_app_settings(session, settings)
    batch_id = new_batch(dataset="BROCHURE")
    seen = []

    def research(opp_id):
        batch = saved(batch_id)
        seen.append((batch.status, batch.new_count))
        return ResearchResult(status="NOT_FOUND")

    monkeypatch.setattr(flow, "research_one", research)
    flow.run_ingest(batch_id)
    assert seen == [("DONE", 2), ("DONE", 2)] and saved(batch_id).research_done_count == 2


def test_web_failure_is_reported_after_public_companies_are_researched(web_env, monkeypatch):
    """웹 검색이 실패해도 공공자료로 들어온 회사의 자동 조사는 마치고, 회차는 실패로 남긴다."""
    _brochure_runtime()
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.candidate_web_search.enabled = True
        sync_app_settings(session, settings)

    def broken(batch_id):
        raise AppError("가상 검색 실패", "다시 시도", status=503, kind="LLM_FAILED")

    researched = []
    monkeypatch.setattr(ingest_web, "search_candidates", broken)
    monkeypatch.setattr(
        flow,
        "research_one",
        lambda opp_id: researched.append(opp_id) or ResearchResult("NOT_FOUND"),
    )
    batch_id = new_batch(dataset="BROCHURE")
    with pytest.raises(RunFailedError, match="웹 후보 검색을 마치지 못했습니다"):
        flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert (batch.status, batch.new_count, batch.research_done_count) == ("FAILED", 1, 1)
    assert len(researched) == 1 and (batch.web_search_used, batch.web_skipped_reason) == (
        False,
        None,
    )
