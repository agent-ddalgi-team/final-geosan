"""#499 시나리오: 보관·판단 연결과 조회 전/만료 보호."""

import pytest
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import func, select

from geosan.config.errors import InputError
from geosan.opportunity import candidate_web
from geosan.opportunity import web_candidate_store as store
from geosan.opportunity.candidate_pick import pick_candidates
from geosan.opportunity.candidate_web import search_candidates
from geosan.opportunity.models import Customer
from geosan.opportunity.source_models import (
    CandidateJudgment,
    SourceFactoryRow,
    WebCandidate,
    WebSearchRun,
)
from geosan.storage.session import session_scope
from tests.fakes.web_candidate_search import BATCH, candidate, logs, response
from tests.fakes.web_candidate_storage import setup_web_storage

scenarios("u3/web_candidate_storage.feature")


@given("웹 후보 검색과 AI 판단을 켠 가상 회차가 있다", target_fixture="context")
def ready(tmp_db, app_settings_path, monkeypatch):
    return {"calls": setup_web_storage(app_settings_path, monkeypatch)}


@given("검색 제공처가 공공 자료 주소를 출처로 돌려준다")
def public_source(context, monkeypatch):
    context["source_url"] = "https://www.data.go.kr/data/15105482/fileData.do"

    def search(body, key):
        context["calls"]["search"].append(body)
        return response([candidate(sourceUrl=context["source_url"])])

    monkeypatch.setattr(candidate_web, "_post_response", search)


@then("공공 자료 출처 주소가 그대로 저장되어 있다")
def saved_source(context):
    with session_scope() as session:
        row = session.get(WebCandidate, context["stored"].candidate_ids[0])
        assert row.source_url == context["source_url"]
        assert row.source_domain == "www.data.go.kr"
        assert row.registry_status == "FOUND"
        assert context["result"].dropped_count == 0


@when("가상 검색과 등록 확인 결과를 저장하고 웹 후보를 판단한다")
def search_store_pick(context):
    context["result"] = search_candidates(BATCH)
    context["stored"] = store.save_web_search(BATCH, context["result"], registry_statuses=["FOUND"])
    context["judgments"] = pick_candidates(
        BATCH, context["stored"].candidate_ids, source_kind="WEB"
    )


@when("같은 조건으로 저장한 검색 결과와 판단을 다시 읽는다")
def reuse(context):
    cached = store.find_cached_web_search(BATCH)
    assert cached.from_cache and cached.candidate_ids == context["stored"].candidate_ids
    assert pick_candidates(BATCH, cached.candidate_ids, source_kind="WEB") == context["judgments"]


@then("검색과 AI 판단은 각각 한 번만 호출된다")
def calls(context):
    assert len(context["calls"]["search"]) == len(context["calls"]["pick"]) == 1


@then("판단은 웹 후보 번호에만 연결되고 공장 행과 회사는 생기지 않는다")
def references(context):
    with session_scope() as session:
        row = session.scalar(select(CandidateJudgment))
        assert row.row_id is None and row.web_candidate_id == context["stored"].candidate_ids[0]
        for model in (SourceFactoryRow, Customer):
            assert session.scalar(select(func.count()).select_from(model)) == 0


@when("등록 조회 전의 빈 상태로 검색 결과 저장을 요청한다")
def no_status(context):
    result = search_candidates(BATCH)
    with pytest.raises(InputError):
        store.save_web_search(BATCH, result, registry_statuses=[None])


@then("결과 저장은 거부되고 검색 비용만 보존된다")
def no_store(context):
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(WebSearchRun)) == 0
    assert len(logs()) == 1 and logs()[0].cost_usd is not None
    assert not context["calls"]["pick"]


@when("저장 결과의 만료 시각이 된다")
def expires(context, monkeypatch):
    monkeypatch.setattr(store, "utcnow", lambda: context["result"].expires_at)


@then("검색 보관 결과는 없고 예전 후보로 하는 판단도 거부된다")
def expired(context):
    assert store.find_cached_web_search(BATCH) is None
    with pytest.raises(InputError):
        pick_candidates(BATCH, context["stored"].candidate_ids, source_kind="WEB")
    assert len(context["calls"]["pick"]) == 1
