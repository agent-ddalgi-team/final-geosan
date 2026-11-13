"""홈페이지 → 연락처 제거 → AI 근거 → 한 번의 저장·재평가(C2 흐름 ①)."""

from __future__ import annotations

import logging
import time

from sqlalchemy import select

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, RunFailedError
from geosan.config.registry import load_runtime_config
from geosan.evaluation.call_inputs import call_item_codes
from geosan.evaluation.proposals import store_item_proposals, store_process_link_proposals
from geosan.evaluation.snapshot import _capability_snapshot
from geosan.evidence.contacts import extract_main_phone, scrub_contacts
from geosan.evidence.extraction import extract_evidence
from geosan.evidence.public_items import approve_pages, check_opportunity
from geosan.evidence.reader import (
    MAX_BYTES,
    Page,
    fetch,
    fetch_more,
    remaining,
    validate_url,
)
from geosan.evidence.research_context import current_research
from geosan.evidence.store import store_extraction
from geosan.opportunity.models import Customer, Opportunity
from geosan.opportunity.queries import store_company_research
from geosan.questions.models import ConfirmationQuestion
from geosan.questions.store import upsert_question
from geosan.rules.models import QuestionCandidate
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import evaluate_in_session
from geosan.workflows.models import FlowResult

logger = logging.getLogger(__name__)


def run_extract(
    opp_id: str,
    url: str | None = None,
    pasted_text: str | None = None,
    requested_by: str = "system",
) -> FlowResult:
    deadline = time.monotonic() + 60
    context = current_research.get()
    if context is not None:
        deadline = min(deadline, context.deadline)
    try:
        if context is not None:
            remaining(deadline)
        check_opportunity(opp_id)
        with session_scope() as session:
            opportunity = session.get(Opportunity, opp_id)
            customer = session.get(Customer, opportunity.customer_id)
            settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
            expected = (
                customer.name,
                customer.address,
                customer.normalized_address,
                customer.homepage_url,
                customer.homepage_status,
                customer.homepage_fetched_at,
                customer.researched_at,
                customer.main_phone,
                customer.main_phone_confirmed_at,
            )
            customer_id = customer.customer_id
            url = validate_url(url or customer.homepage_url or "")
            # #286: 점수 8항목(규칙 설정)과 활성 묶음 공정 코드를 AI에 알려 제안을 받는다.
            # #685: 통화에서 확인한 신호로 채우는 항목(구매·외주 의향, 관심)은 AI에 묻지 않는다.
            rule_config = load_runtime_config(session).rule_config
            call_items = call_item_codes(rule_config)
            item_catalog = [
                {
                    "code": item.item_code,
                    "label": item.label,
                    "steps": list(item.match_rate_steps),
                }
                for item in rule_config.new_profile_items
                if item.item_code not in call_items
            ]
            process_codes = sorted(
                row.code
                for row in _capability_snapshot(session, opportunity.dataset_kind).processes
            )
        if pasted_text is not None:
            if not pasted_text.strip() or len(pasted_text.encode("utf-8")) > MAX_BYTES:
                raise InputError("붙여넣을 공개 본문의 길이를 확인해 주세요.")
            pages = [Page(url, pasted_text)]
        else:
            # #557: 첫 화면과 이름이 맞는 같은 사이트 안쪽 페이지를 읽어 AI는 한 번만 부른다.
            discovery = settings.homepage_discovery
            first = fetch(url, deadline)
            pages = [
                first,
                *fetch_more(
                    first,
                    deadline,
                    extra_pages=discovery.extra_pages,
                    hints=discovery.extra_page_hints,
                    max_chars=discovery.extra_page_max_chars,
                ),
            ]
        phone, phone_url = None, None
        for page in pages:
            phone, phone_url = extract_main_phone(
                page.text, page.url, settings.main_phone.allowed_prefixes
            )
            if phone:
                break
        with approve_pages(opp_id, pages) as approved_ids:
            result = extract_evidence(
                approved_ids,
                opp_id,
                deadline=deadline,
                requested_by=requested_by,
                item_catalog=item_catalog,
                process_codes=process_codes,
            )
        remaining(deadline)
        with session_scope() as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            opportunity = session.get(Opportunity, opp_id)
            if (
                opportunity is None
                or opportunity.customer_id != customer_id
                or opportunity.purpose != "NEW_PROPOSAL"
            ):
                raise AppError(
                    "조사하는 동안 기회가 바뀌었습니다.",
                    "현재 기회를 확인해 주세요.",
                    status=409,
                    kind="STALE_VALUE",
                )
            store_company_research(
                session,
                customer_id,
                expected=expected,
                line=result.company_summary.line,
                highlights=result.company_summary.highlights,
                phone=phone,
                phone_source_url=phone_url,
            )
            evidence = store_extraction(
                session,
                opportunity,
                result,
                pages[0].url,
                requested_by,
                source_for=_source_finder(pages),
            )
            # #286: 점수 입력·공정 연결 제안을 AI·확인 전으로 저장한 뒤 재평가한다(사람 값 우선).
            proposal_count = store_item_proposals(
                session,
                opportunity,
                result,
                evidence,
                rule_config=rule_config,
                requested_by=requested_by,
            )
            link_count = store_process_link_proposals(
                session,
                opportunity,
                result,
                allowed_codes=set(process_codes),
                requested_by=requested_by,
            )
            evaluated = evaluate_in_session(session, [opp_id], requested_by)
            if not evaluated.new_eval_ids:
                raise RunFailedError("평가할 입력이 없어 조사 결과를 저장하지 않았습니다.")
            question_count = 0
            for question in result.questions:
                existing = session.scalar(
                    select(ConfirmationQuestion).where(
                        ConfirmationQuestion.target_kind == question.target_kind,
                        ConfirmationQuestion.target_id == opp_id,
                    )
                )
                if existing and (existing.status != "WAITING" or existing.is_user_added):
                    continue
                upsert_question(
                    session,
                    QuestionCandidate(
                        target_kind=question.target_kind,
                        target_id=opp_id,
                        text=question.text,
                        effect_if_answered="공개 근거의 내용을 확인합니다.",
                    ),
                    opp_id,
                    evaluated.new_eval_ids[0],
                    dataset_kind=opportunity.dataset_kind,
                    is_virtual=opportunity.is_virtual,
                    requested_by=requested_by,
                )
                question_count += 1
            remaining(deadline)
        evaluated.summary = (
            f"근거 {len(evidence)}건·질문 {question_count}건·점수 제안 {proposal_count}건·"
            f"공정 제안 {link_count}건 저장, 재평가 완료"
        )
        evaluated.counts = {
            "evidenceCount": len(evidence),
            "requirementCandidateCount": len(result.requirement_candidates),
            "questionCount": question_count,
        }
        return evaluated
    except Exception as exc:
        error = (
            exc
            if isinstance(exc, AppError)
            else RunFailedError("홈페이지 조사 결과를 저장하지 못했습니다.")
        )
        logger.error("근거 추출 실패: ref=%s type=%s", error.ref, type(exc).__name__)
        return FlowResult.failed(error)


def _source_finder(pages: list[Page]):
    """인용문이 그대로 들어 있는 페이지 주소를 돌려준다. 못 찾으면 첫 화면 주소(#557).

    AI에는 연락처를 지운 본문이 갔으므로 같은 방식으로 지운 본문에서 찾는다.
    """
    cleaned = [(page.url, scrub_contacts(page.text)[0]) for page in pages]

    def source_for(quote: str) -> str:
        return next((url for url, text in cleaned if quote and quote in text), pages[0].url)

    return source_for
