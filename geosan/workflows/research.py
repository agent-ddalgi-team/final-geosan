"""C8 일괄 조사의 회사 한 곳 처리. 기존 검색과 흐름 ①을 순서대로 연결한다."""

import logging
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select

from geosan.config.errors import AppError, NotFoundError, RunFailedError
from geosan.evidence.homepage import find_case_homepage
from geosan.evidence.public_items import check_opportunity
from geosan.evidence.reader import remaining
from geosan.evidence.research_context import research_context
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_extract import run_extract

logger = logging.getLogger(__name__)


@dataclass
class ResearchResult:
    status: str = "NEEDS_CONFIRMATION"
    evidence_count: int = 0
    cost: Decimal = Decimal(0)
    usage_unconfirmed: bool = False
    error: AppError | None = None


def research_one(opp_id: str) -> ResearchResult:
    result = ResearchResult()
    with research_context() as context:
        try:
            check_opportunity(opp_id)
            with session_scope() as session:
                customer = session.scalar(
                    select(Customer)
                    .join(Opportunity, Opportunity.customer_id == Customer.customer_id)
                    .where(Opportunity.opp_id == opp_id)
                )
                if customer is None:
                    raise NotFoundError("조사할 회사가 없습니다.")
                url = customer.homepage_url
                result.status = customer.homepage_status or "NEEDS_CONFIRMATION"
            remaining(context.deadline)
            if not url:
                found = find_case_homepage(opp_id)
                url = found.url
                with session_scope() as session:
                    result.status = session.get(Customer, customer.customer_id).homepage_status
            if url:
                extracted = run_extract(opp_id, url=url, requested_by="system")
                if not extracted.ok:
                    raise extracted.error or RunFailedError("조사 결과를 저장하지 못했습니다.")
                if extracted.counts is None:
                    raise RunFailedError("조사 결과의 저장 건수를 확인하지 못했습니다.")
                result.evidence_count = extracted.counts["evidenceCount"]
        except AppError as error:
            result.error = error
        except Exception as error:
            result.error = RunFailedError("회사 조사를 완료하지 못했습니다.")
            logger.error("일괄 조사 실패: type=%s ref=%s", type(error).__name__, result.error.ref)
        # 전체 DB의 전후 차이가 아니라 이 실행이 만든 호출만 센다. 동시 조사와 섞이지 않는다.
        with session_scope() as session:
            rows = session.scalars(
                select(TransferLog).where(TransferLog.transfer_log_id.in_(context.log_ids))
            ).all()
            result.cost = sum((row.cost_usd or Decimal(0) for row in rows), Decimal(0))
            result.usage_unconfirmed = any(row.call_count and row.cost_usd is None for row in rows)
    return result
