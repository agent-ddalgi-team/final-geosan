"""#304: 실제 임시 DB·API와 가짜 외부 응답으로 홈페이지 연결을 확인한다."""

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.config.errors import AppError
from geosan.evidence.models import Evidence
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u2 import test_extraction as support

search_env = support.search_env
extract_env = support.extract_env
URL = support.URL


@pytest.fixture
def homepage_env(extract_env):
    case, transport = extract_env
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.homepage_url = URL
        customer.homepage_status = "AI_FOUND"
        customer.homepage_source = "AI"
    with TestClient(create_app()) as client:
        yield client, case, transport


def post(env, body, staff="park-lee"):
    client, case, _ = env
    return client.post(
        f"/api/v1/opportunities/{case.opp_id}/homepage",
        json=body,
        headers={"X-Staff-Key": staff} if staff is not None else {},
    )


def test_confirm_only_keeps_address_and_never_runs_research(homepage_env, monkeypatch):
    """Given AI 주소 / When 맞음 / Then 표시만 확정하고 근거·질문·점수는 보존한다."""
    before = support.counts()
    run = Mock(side_effect=AssertionError("확인만 할 때 조사를 실행하면 안 됩니다"))
    monkeypatch.setattr(flow_extract, "run_extract", run)
    response = post(homepage_env, {"url": URL, "confirmOnly": True})
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {
        "homepageUrl": URL,
        "homepageStatus": "CONFIRMED",
        "homepageSource": "STAFF",
    }
    assert response.json()["meta"]["reevaluated"] is False
    assert support.counts() == before
    assert homepage_env[2].call_count == 0 and run.call_count == 0
    with session_scope() as session:
        row = session.get(Customer, homepage_env[1].customer_id)
        assert (row.homepage_url, row.homepage_status, row.homepage_source) == (
            URL,
            "CONFIRMED",
            "STAFF",
        )


def test_research_returns_real_counts_and_new_evaluation(homepage_env):
    """Given 가짜 AI·실제 DB / When 조사 / Then 저장한 건수와 실제 새 평가 번호를 돌려준다."""
    before = support.counts()
    response = post(homepage_env, {"url": URL})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data == {
        "evidenceCount": 1,
        "requirementCandidateCount": 0,
        "questionCount": 1,
        "evalId": data["evalId"],
    }
    assert data["evalId"] and response.json()["meta"]["reevaluated"] is True
    assert support.counts()[0] == before[0] + 1
    assert homepage_env[2].call_count == 1
    detail = homepage_env[0].get(f"/api/v1/opportunities/{homepage_env[1].opp_id}").json()
    assert detail["data"]["evalId"] == data["evalId"]
    assert detail["data"]["header"]["summaryLine"] == "정밀 볼트 생산 기업"
    # [다시 조사]는 주소 [맞음]과 다르다. 같은 주소의 AI 판정을 담당자 확정으로 바꾸지 않는다.
    with session_scope() as session:
        customer = session.get(Customer, homepage_env[1].customer_id)
        assert (customer.homepage_status, customer.homepage_source) == ("AI_FOUND", "AI")


def test_corrected_address_is_used_for_research_and_detail(homepage_env, monkeypatch):
    changed = "https://example.org/new-company"
    fetch = Mock(return_value=flow_extract.Page(changed, support.BODY))
    monkeypatch.setattr(flow_extract, "fetch", fetch)
    response = post(homepage_env, {"url": changed})
    assert response.status_code == 200, response.text
    assert fetch.call_count == 1 and fetch.call_args.args[0] == changed
    with session_scope() as session:
        customer = session.get(Customer, homepage_env[1].customer_id)
        assert (customer.homepage_url, customer.homepage_status, customer.homepage_source) == (
            changed,
            "CONFIRMED",
            "STAFF",
        )


def test_pasted_text_skips_fetch_and_external_payload_excludes_contacts(homepage_env, monkeypatch):
    fetch = Mock(side_effect=AssertionError("붙여넣기 때 홈페이지를 다시 읽으면 안 됩니다"))
    monkeypatch.setattr(flow_extract, "fetch", fetch)
    response = post(homepage_env, {"pastedText": support.BODY + "\nmail@example.org"})
    assert response.status_code == 200, response.text
    assert fetch.call_count == 0 and homepage_env[2].call_count == 1
    assert "mail@example.org" not in str(homepage_env[2].call_args)


@pytest.mark.parametrize("staff", [None, "viewer", "unknown"])
def test_staff_required_before_any_research(homepage_env, staff):
    before = support.counts()
    response = post(homepage_env, {"url": URL}, staff)
    assert response.status_code == 403
    assert homepage_env[2].call_count == 0 and support.counts() == before


@pytest.mark.parametrize(
    "body",
    [
        {"confirmOnly": True, "pastedText": support.BODY},
        {"confirmOnly": True, "pastedText": ""},
        {"confirmOnly": "true"},
        {"url": 1},
        {"pastedText": 1},
        {"url": URL, "extra": True},
    ],
)
def test_invalid_request_saves_and_sends_nothing(homepage_env, body):
    before = support.counts()
    response = post(homepage_env, body)
    assert response.status_code == 400
    assert homepage_env[2].call_count == 0 and support.counts() == before


def test_confirm_only_rejects_a_changed_address(homepage_env):
    response = post(homepage_env, {"url": "https://example.org/changed", "confirmOnly": True})
    assert response.status_code == 409 and response.json()["error"]["kind"] == "STALE_VALUE"
    assert homepage_env[2].call_count == 0
    with session_scope() as session:
        assert session.get(Customer, homepage_env[1].customer_id).homepage_url == URL


@pytest.mark.parametrize("kind,status", [("ROBOTS_DISALLOW", 422), ("TIMEOUT", 503)])
def test_reader_error_passes_through_without_new_business_rows(
    homepage_env, monkeypatch, kind, status
):
    error = AppError("본문을 읽을 수 없습니다.", "공개 본문을 붙여넣어 주세요.", status, kind)
    monkeypatch.setattr(flow_extract, "fetch", Mock(side_effect=error))
    before = support.counts()
    response = post(homepage_env, {"url": URL})
    assert response.status_code == status
    for key in ("message", "nextAction", "kind"):
        assert response.json()["error"][key] == error.to_error_body()["error"][key]
    assert support.counts() == before and homepage_env[2].call_count == 0


def test_research_auth_session_is_closed_before_flow_and_flow_called_once(
    homepage_env, monkeypatch
):
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    active = set()

    def begun(session, transaction):
        if transaction.parent is None:
            active.add(id(session))

    def ended(session, transaction):
        if transaction.parent is None:
            active.discard(id(session))

    real_run = flow_extract.run_extract

    def run(*args, **kwargs):
        assert not active, "외부 조사 전에 API 검사 세션이 끝나야 합니다"
        return real_run(*args, **kwargs)

    wrapped = Mock(side_effect=run)
    event.listen(Session, "after_transaction_create", begun)
    event.listen(Session, "after_transaction_end", ended)
    monkeypatch.setattr(flow_extract, "run_extract", wrapped)
    try:
        assert post(homepage_env, {"url": URL}).status_code == 200
    finally:
        event.remove(Session, "after_transaction_create", begun)
        event.remove(Session, "after_transaction_end", ended)
    assert wrapped.call_count == 1


def test_missing_opportunity_returns_404_without_call(homepage_env):
    response = homepage_env[0].post(
        "/api/v1/opportunities/unknown/homepage", json={}, headers={"X-Staff-Key": "park-lee"}
    )
    assert response.status_code == 404 and homepage_env[2].call_count == 0


def test_candidate_count_is_returned_without_registering_requirements(homepage_env):
    data = support.answer()
    data["requirementCandidates"] = [
        {
            "name": "인증",
            "reqLevelProposed": "UNKNOWN",
            "quote": "납품 전 검사가 필요합니다.",
        }
    ]
    homepage_env[2].side_effect = lambda *_: support.reply(data)
    before = support.counts()
    response = post(homepage_env, {"url": URL})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["requirementCandidateCount"] == 1
    assert response.json()["data"]["evidenceCount"] == 2
    assert support.counts()[3] == before[3]
    with session_scope() as session:
        candidate = session.scalar(
            select(Evidence).where(
                Evidence.subject == "REQUIREMENT", Evidence.is_llm_proposed.is_(True)
            )
        )
        assert candidate.certainty_confirmed is None


def test_access_protection_rejects_before_staff_or_research(homepage_env):
    from geosan.config.models import AppSetting

    with session_scope() as session:
        row = session.get(AppSetting, "accessProtection")
        row.value = {**row.value, "enabled": True}
    assert post(homepage_env, {"url": URL}).status_code == 401
    assert homepage_env[2].call_count == 0


def test_private_case_keeps_address_and_records_rejection_without_external_call(homepage_env):
    from geosan.evidence.transfer import TransferLog

    with session_scope() as session:
        session.get(Customer, homepage_env[1].customer_id).security_grade = "INTERNAL_ONLY"
    before = support.counts()
    response = post(homepage_env, {"url": "https://example.org/changed"})
    assert response.status_code == 422
    assert homepage_env[2].call_count == 0 and support.counts() == before
    with session_scope() as session:
        assert session.get(Customer, homepage_env[1].customer_id).homepage_url == URL
        log = session.scalar(select(TransferLog))
        assert log.decision == "REJECTED" and log.call_count == 0


def test_address_confirmation_failure_never_starts_external_research(homepage_env):
    from sqlalchemy.orm import Session

    def fail_commit(session):
        raise RuntimeError("test commit failure")

    from sqlalchemy import event

    event.listen(Session, "before_commit", fail_commit)
    try:
        response = post(homepage_env, {"url": URL})
    finally:
        event.remove(Session, "before_commit", fail_commit)
    assert response.status_code == 500 and homepage_env[2].call_count == 0
    with session_scope() as session:
        assert session.get(Customer, homepage_env[1].customer_id).homepage_status == "AI_FOUND"


@pytest.mark.parametrize(
    "kind", ["LLM_LIMIT", "SEARCH_LIMIT", "USAGE_UNCONFIRMED", "LLM_NOT_CONFIGURED", "LLM_FAILED"]
)
def test_provider_failure_kind_and_instructions_are_not_replaced(homepage_env, monkeypatch, kind):
    from geosan.workflows.models import FlowResult

    error = AppError("조사를 멈췄습니다.", "운영자에게 문의해 주세요.", 503, kind)
    run = Mock(return_value=FlowResult.failed(error))
    monkeypatch.setattr(flow_extract, "run_extract", run)
    response = post(homepage_env, {})
    assert response.status_code == 503
    assert response.json()["error"]["kind"] == kind
    assert response.json()["error"]["message"] == error.message
    assert response.json()["error"]["nextAction"] == error.next_action
    assert run.call_count == 1 and homepage_env[2].call_count == 0
