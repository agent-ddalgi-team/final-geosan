"""실제 SQLite·규칙 엔진과 가짜 OpenAI 응답으로 흐름 ①의 원자성을 확인한다."""

import json
import time
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select

from geosan.config.errors import AppError
from geosan.evaluation.models import EvaluationRun
from geosan.evidence import extraction, public_items
from geosan.evidence.models import Evidence
from geosan.evidence.openai_search import _HttpError
from geosan.evidence.reader import Page
from geosan.opportunity.models import Customer, Opportunity, Requirement
from geosan.questions.models import ConfirmationQuestion
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u2 import test_search_limits as support

search_env = support.search_env
BODY = "정밀 볼트를 생산합니다.\n자동차용 부품을 가공합니다.\n납품 전 검사가 필요합니다."
URL = "https://example.org/company"


def answer():
    return {
        "evidence": [
            {
                "quote": "정밀 볼트를 생산합니다.",
                "subject": "PRODUCT",
                "occurredAtCandidate": None,
                "sourceGradeProposed": "B",
                "certaintyProposed": "STRONG",
            }
        ],
        "questions": [{"text": "직접 생산 여부를 확인했나요?", "targetKind": "OPPORTUNITY"}],
        "requirementCandidates": [],
        "companySummary": {"line": "정밀 볼트 생산 기업", "highlights": ["자동차용 부품 가공"]},
        "itemInputProposals": [],
        "processLinkProposals": [],
    }


def reply(result=None):
    return {
        "status": "completed",
        "usage": {"input_tokens": 1000, "output_tokens": 200},
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": json.dumps(result or answer())}],
            }
        ],
    }


@pytest.fixture
def extract_env(search_env, monkeypatch):
    case, _ = search_env
    with session_scope() as session:
        from geosan.config.models import AppSetting

        opportunity = session.get(Opportunity, case.opp_id)
        session.get(AppSetting, "activeDatasetKind").value = opportunity.dataset_kind
    transport = Mock(side_effect=lambda *_: reply())
    monkeypatch.setattr(extraction, "_post", transport)
    monkeypatch.setattr(flow_extract, "fetch", lambda url, deadline: Page(url, BODY))
    return case, transport


def counts():
    with session_scope() as session:
        return tuple(
            session.scalar(select(func.count()).select_from(model))
            for model in (Evidence, EvaluationRun, ConfirmationQuestion, Requirement)
        )


def test_frame_only_page_never_calls_ai_or_changes_saved_case(extract_env, monkeypatch):
    from geosan.evidence import reader
    from tests.unit.u2.test_homepage_reader import FRAME_PAGE

    case, transport = extract_env
    before = counts()
    with session_scope() as session:
        summary = session.get(Customer, case.customer_id).summary_line
    monkeypatch.setattr(flow_extract, "fetch", reader.fetch)
    monkeypatch.setattr(
        reader,
        "_get",
        lambda url, _: (
            (404, {}, "")
            if url.endswith("robots.txt")
            else (200, {"content-type": "text/html"}, FRAME_PAGE)
        ),
    )
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "UNREACHABLE"
    assert transport.call_count == 0 and support.logs() == []
    assert counts() == before
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        assert customer.summary_line == summary and customer.research_source == "CASE_FILE"


def test_body_extract_store_and_real_reevaluation(extract_env):
    case, transport = extract_env
    before = counts()
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok, result.error
    assert result.new_eval_ids and counts()[0] == before[0] + 1
    with session_scope() as session:
        row = session.scalar(select(Evidence).where(Evidence.is_llm_proposed.is_(True)))
        assert row.certainty_confirmed is None and row.extraction_method == "LLM"
        customer = session.get(Customer, case.customer_id)
        assert customer.summary_line == "정밀 볼트 생산 기업"
        assert customer.research_source == "AI" and customer.researched_at
        assert session.get(EvaluationRun, result.new_eval_ids[0])
    payload = transport.call_args.args[0]
    assert payload["store"] is False and payload["input"] == BODY
    assert "tools" not in payload and "companyMainPhone" not in json.dumps(payload)
    assert support.logs()[0].purpose == "EXTERNAL_AI"
    assert not public_items._items


def test_contacts_removed_before_send_and_phone_kept_locally(extract_env):
    case, transport = extract_env
    phone = "031" + "-123-4567"
    email = "test" + "@example.invalid"
    result = flow_extract.run_extract(case.opp_id, URL, BODY + "\n대표전화 " + phone + "\n" + email)
    assert result.ok, result.error
    payload = transport.call_args.args[0]
    assert phone not in str(payload) and email not in str(payload)
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        assert customer.main_phone == phone and customer.main_phone_source_url == URL
        assert customer.main_phone_confirmed_at is None
    assert phone not in str(support.logs()[0].__dict__)


@pytest.mark.parametrize(
    "grade,purpose",
    [
        ("INTERNAL_ONLY", "NEW_PROPOSAL"),
        ("UNKNOWN", "NEW_PROPOSAL"),
        ("PUBLIC", "FOLLOW_UP_PROPOSAL"),
    ],
)
def test_private_or_recontact_sends_nothing(extract_env, grade, purpose):
    case, transport = extract_env
    with session_scope() as session:
        session.get(Customer, case.customer_id).security_grade = grade
        session.get(Opportunity, case.opp_id).purpose = purpose
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and transport.call_count == 0
    assert support.logs()[0].call_count == 0


def test_only_approved_item_ids_are_accepted(extract_env):
    case, transport = extract_env
    with pytest.raises(AppError):
        extraction.extract_evidence(["ev-private"], case.opp_id, deadline=time.monotonic() + 60)
    assert transport.call_count == 0


def test_reevaluation_failure_rolls_back_every_business_change(extract_env, monkeypatch):
    case, _ = extract_env
    before = counts()
    monkeypatch.setattr(
        flow_extract, "evaluate_in_session", Mock(side_effect=RuntimeError("failure"))
    )
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and counts() == before
    assert support.logs()[0].cost_usd > 0
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).research_source != "AI"
    assert not public_items._items


def test_research_history_keeps_manual_and_previous_ai_evidence(extract_env):
    case, _ = extract_env
    assert flow_extract.run_extract(case.opp_id, URL).ok
    assert flow_extract.run_extract(case.opp_id, URL).ok
    with session_scope() as session:
        rows = session.scalars(select(Evidence)).all()
        assert sum(row.is_llm_proposed and row.superseded_at is None for row in rows) == 1
        assert sum(row.is_llm_proposed and row.superseded_at is not None for row in rows) == 1
        assert all(row.superseded_at is None for row in rows if not row.is_llm_proposed)


def test_answered_question_is_not_rewritten_by_research(extract_env):
    case, _ = extract_env
    assert flow_extract.run_extract(case.opp_id, URL).ok
    with session_scope() as session:
        row = session.scalar(
            select(ConfirmationQuestion).where(
                ConfirmationQuestion.target_kind == "OPPORTUNITY",
                ConfirmationQuestion.target_id == case.opp_id,
            )
        )
        row.status = "APPLIED"
        row.question_text = "담당자가 이미 답을 반영한 질문"
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok
    assert result.counts["questionCount"] == 0
    with session_scope() as session:
        row = session.scalar(
            select(ConfirmationQuestion).where(
                ConfirmationQuestion.target_kind == "OPPORTUNITY",
                ConfirmationQuestion.target_id == case.opp_id,
            )
        )
        assert row.question_text == "담당자가 이미 답을 반영한 질문"


def test_requirement_candidates_are_unconfirmed_evidence(extract_env):
    case, transport = extract_env
    data = answer()
    data["requirementCandidates"] = [
        {
            "name": "납품 전 검사",
            "reqLevelProposed": "REQUIRED_STRONG",
            "quote": "납품 전 검사가 필요합니다.",
        }
    ]
    transport.side_effect = lambda *_: reply(data)
    before = counts()
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok, result.error
    assert counts()[3] == before[3]
    assert result.counts == {
        "evidenceCount": 2,
        "requirementCandidateCount": 1,
        "questionCount": 1,
    }
    with session_scope() as session:
        row = session.scalar(
            select(Evidence).where(
                Evidence.is_llm_proposed.is_(True), Evidence.subject == "REQUIREMENT"
            )
        )
        assert row.certainty_proposed == "UNKNOWN" and row.certainty_confirmed is None
        assert "납품 전 검사" in row.quote


@pytest.mark.parametrize("fault", ["quote", "contact", "usage", "refusal", "incomplete"])
def test_invalid_ai_response_does_not_save(extract_env, fault):
    case, transport = extract_env
    response = reply()
    if fault == "quote":
        data = answer()
        data["evidence"][0]["quote"] = "본문에 없는 인증을 받았습니다."
        response = reply(data)
    elif fault == "contact":
        data = answer()
        data["companySummary"]["line"] = "연락처 " + "010" + "12345678"
        response = reply(data)
    elif fault == "usage":
        response["usage"] = {"input_tokens": -1, "output_tokens": 2}
    elif fault == "refusal":
        response["output"][0]["content"] = [{"type": "refusal"}]
    else:
        response["status"] = "incomplete"
    transport.side_effect = lambda *_: response
    before = counts()
    assert not flow_extract.run_extract(case.opp_id, URL).ok
    assert counts() == before
    assert support.logs()[0].call_count == 1


@pytest.mark.parametrize(
    "field,value", [("homepage_status", "CONFIRMED"), ("address", "바뀐 공개 주소")]
)
def test_changed_customer_is_not_overwritten(extract_env, field, value):
    case, transport = extract_env

    def change(*_):
        with session_scope() as session:
            setattr(session.get(Customer, case.customer_id), field, value)
        return reply()

    transport.side_effect = change
    before = counts()
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "STALE_VALUE" and counts() == before
    assert support.logs()[0].cost_usd > 0


def test_same_phone_updates_source_without_losing_confirmation(extract_env):
    from geosan.storage.base import utcnow

    case, _ = extract_env
    phone = "031" + "-123-4567"
    confirmed_at = utcnow()
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.main_phone = phone
        customer.main_phone_source = "CSV"
        customer.main_phone_confirmed_at = confirmed_at
        customer.main_phone_confirmed_by = "staff-test"
    result = flow_extract.run_extract(case.opp_id, URL, BODY + "\n대표전화 " + phone)
    assert result.ok, result.error
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        assert customer.main_phone_source == "HOMEPAGE" and customer.main_phone_source_url == URL
        assert customer.main_phone_confirmed_at == confirmed_at


def test_search_and_extraction_share_monthly_limit(extract_env):
    case, _ = extract_env
    support.change_setting("llm", monthlyCallLimit=1)
    from geosan.evidence.homepage import find_case_homepage

    find_case_homepage(case.opp_id)
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "LLM_LIMIT"


def test_retry_has_separate_usage_and_stops_at_limit(extract_env):
    case, transport = extract_env
    transport.side_effect = [_HttpError(429), reply()]
    assert flow_extract.run_extract(case.opp_id, URL).ok
    assert len(support.logs()) == 2 and transport.call_count == 2


def test_timeout_allows_next_call_within_budget(extract_env):
    case, transport = extract_env
    transport.side_effect = TimeoutError()
    assert not flow_extract.run_extract(case.opp_id, URL).ok
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "LLM_FAILED" and transport.call_count == 2
    assert all(row.cost_usd is None and row.call_count == 1 for row in support.logs())


def test_none_mode_and_missing_key_never_send(extract_env, monkeypatch):
    case, transport = extract_env
    support.change_setting("llm", mode="NONE")
    assert not flow_extract.run_extract(case.opp_id, URL).ok
    support.change_setting("llm", mode="EXTERNAL")
    monkeypatch.delenv("OPENAI_API_KEY")
    assert not flow_extract.run_extract(case.opp_id, URL).ok
    assert transport.call_count == 0


def test_robots_failure_never_sends_or_saves(extract_env, monkeypatch):
    case, transport = extract_env
    monkeypatch.setattr(
        flow_extract,
        "fetch",
        Mock(
            side_effect=AppError("자동 읽기 금지", "붙여넣기", status=422, kind="ROBOTS_DISALLOW")
        ),
    )
    before = counts()
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.error.kind == "ROBOTS_DISALLOW" and counts() == before
    assert transport.call_count == 0


def test_expired_deadline_rolls_back_but_keeps_usage(extract_env, monkeypatch):
    case, _ = extract_env
    before = counts()
    monkeypatch.setattr(
        flow_extract, "remaining", Mock(side_effect=AppError("60초 초과", "재시도", status=503))
    )
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and counts() == before and support.logs()[0].cost_usd > 0
