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
from geosan.evidence.transfer import TransferLog, record_search_rejection
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_extract import run_extract

logger = logging.getLogger(__name__)

# 이어 가도 소용없거나 비용을 모르는 오류. 나머지 오류는 그 회사만 건너뛴다.
STOP_KINDS = {"LLM_LIMIT", "SEARCH_LIMIT", "USAGE_UNCONFIRMED", "LLM_NOT_CONFIGURED"}
# 홈페이지를 못 읽었거나 시간이 넘어 멈춘 오류. 읽기에서 멈추면 전송 기록이 없어서
# 이유를 거부 1행으로 남긴다(#690).
READ_FAILURE_KINDS = {"UNREACHABLE", "ROBOTS_DISALLOW", "TERMS_DISALLOW", "TIMEOUT"}


@dataclass
class ResearchResult:
    status: str = "NEEDS_CONFIRMATION"
    evidence_count: int = 0
    cost: Decimal = Decimal(0)
    usage_unconfirmed: bool = False
    error: AppError | None = None


def _record_read_failure(opp_id: str, error: AppError) -> None:
    """조사가 멈춘 이유를 전송 기록에 남긴다. 예전에는 서버 로그에도 이유가 남지 않았다(#690)."""
    try:
        record_search_rejection(
            opp_id, f"자동 조사 중단 · {error.message}"[:300], None, purpose="EXTERNAL_AI"
        )
    except Exception as record_error:
        # 기록을 못 남겨도 조사 실패 결과는 그대로 돌려준다. 기록 실패는 로그에 남긴다.
        logger.error(
            "조사 중단 기록 저장 실패: type=%s ref=%s", type(record_error).__name__, error.ref
        )


def research_one(opp_id: str, *, find_homepage: bool = True) -> ResearchResult:
    """회사 한 곳 조사. find_homepage가 False면 주소가 없을 때 홈페이지 찾기 검색을 하지 않는다."""
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
            if not url and find_homepage:
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
        if result.error is not None and result.error.kind in READ_FAILURE_KINDS:
            _record_read_failure(opp_id, result.error)
        # 전체 DB의 전후 차이가 아니라 이 실행이 만든 호출만 센다. 동시 조사와 섞이지 않는다.
        with session_scope() as session:
            rows = session.scalars(
                select(TransferLog).where(TransferLog.transfer_log_id.in_(context.log_ids))
            ).all()
            result.cost = sum((row.cost_usd or Decimal(0) for row in rows), Decimal(0))
            result.usage_unconfirmed = any(row.call_count and row.cost_usd is None for row in rows)
    return result
