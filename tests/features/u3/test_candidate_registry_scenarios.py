"""#512: 실제 DB·가상 제공처로 등록 대조의 세 경로를 확인한다."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import func, select

from geosan.opportunity.candidate_registry import lookup_candidate_registry
from geosan.opportunity.models import Customer
from geosan.opportunity.source_models import WebCandidate
from geosan.storage.session import session_scope
from tests.fakes.candidate_registry import MATCH, candidate, responses, setup_registry, xml
from tests.fakes.web_candidate_search import BATCH, logs

scenarios("u3/candidate_registry.feature")


@given("웹 후보와 공장등록 조회 승인이 준비되어 있다", target_fixture="context")
def ready(tmp_db, app_settings_path, monkeypatch):
    setup_registry(app_settings_path, monkeypatch)
    return {}


@when("회사명 조회에 같은 이름과 주소의 공장 한 곳이 응답한다")
def lookup(context, monkeypatch):
    responses(monkeypatch, xml([MATCH]))
    context["result"] = lookup_candidate_registry(BATCH, candidate())


@then("등록 확인 결과와 호출 한 건만 남고 회사는 아직 등록하지 않는다")
def found(context):
    assert context["result"].registry_status == "FOUND" and len(logs()) == 1
    assert "PRIVATE_" not in repr(context["result"])
    with session_scope() as session:
        for model in (Customer, WebCandidate):
            assert session.scalar(select(func.count()).select_from(model)) == 0


@when("주소 없는 웹 후보를 같은 이름의 공장과 대조한다")
def missing(context, monkeypatch):
    responses(monkeypatch, xml([MATCH]))
    context["result"] = lookup_candidate_registry(BATCH, candidate(address=None))


@then("등록 여부를 확정하지 않고 담당자 확인을 기다린다")
def confirm(context):
    assert context["result"].registry_status is None and context["result"].needs_confirmation


@when("회사명 조회가 재시도까지 실패한다")
def fails(context, monkeypatch):
    responses(monkeypatch, OSError(), OSError())
    context["result"] = lookup_candidate_registry(BATCH, candidate())


@then("등록 여부를 확정하지 않고 두 호출 기록과 실패 사유를 남긴다")
def failed(context):
    assert context["result"].registry_status is None
    assert context["result"].skipped_reason == "SOURCE_ERROR" and len(logs()) == 2


@when("시·군까지만 적힌 웹 후보를 같은 시의 같은 이름 공장 한 곳과 대조한다")
def same_city(context, monkeypatch):
    """#706 PM 결정 2026-11-13: 실제 검색은 "충남 아산시"처럼 시·군까지만 주는 일이 많다."""
    responses(monkeypatch, xml([MATCH]))
    context["result"] = lookup_candidate_registry(BATCH, candidate(address="충청남도 아산시"))


@then("그 공장으로 등록을 확인한다")
def same_city_found(context):
    result = context["result"]
    assert result.registry_status == "FOUND" and result.matched_row.factory_manage_no == MATCH[2]


@when("웹 후보를 다른 시에 있는 같은 이름의 공장과 대조한다")
def other_city(context, monkeypatch):
    responses(monkeypatch, xml([(MATCH[0], "충남 천안시 가상로 1", "F9")]))
    context["result"] = lookup_candidate_registry(BATCH, candidate())
