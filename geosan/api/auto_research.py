"""#690: 관심을 켜면 그 회사 조사가 저절로 돈다(PM 결정 2026-11-13, 계약 C1 `/bookmark`).

관심이 켜지는 저장(관심 단추, 메모·영업 기록·검토 의견 저장)이 `queue_on_bookmark`를 부른다.
홈페이지 주소가 있고 아직 조사 전인 회사만, 응답을 보낸 뒤 서버 백그라운드로 한 번 조사한다
(후보 찾기 뒤 자동 조사와 같은 FastAPI BackgroundTasks). 새 표·일꾼은 없다.

- 스위치: 설정 `homepageDiscovery.autoResearch`가 꺼져 있으면 돌지 않는다(#719).
- 하루 금액: 설정 `research.autoOnBookmarkDailyCostUsd`(0이면 꺼짐). 관심 자동 조사가 남긴
  AI 호출 행(요청자 auto-bookmark)의 오늘 비용 합이 설정보다 적을 때만 새 조사를 시작한다.
  비용은 호출 뒤에야 찍히므로 방금 시작한 조사는 예상 비용으로 함께 센다(#719). 실제 비용이
  예상보다 큰 만큼만 넘을 수 있다.
- "조사 중" 표시: 이 프로세스의 메모리에만 둔다. 서버가 다시 켜지면 사라지고, 그 뒤 화면은
  저장된 값으로 정한 상태(읽기 실패 등)를 보인다.
- #744: 찾기로 들어온 회사의 자동 조사 대기 줄(workflows/research_queue.py)과 하루 금액을 함께 쓴다.
  이 서버가 그날 처음 받는 목록 읽기 뒤에 줄을 한 번 이어서 돌린다(다음 날 이어서).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import timedelta
from decimal import Decimal
from threading import Lock

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.config.errors import AppError, RunFailedError
from geosan.config.sales_questions import CLOSED_STAGES
from geosan.evidence.models import Evidence
from geosan.evidence.transfer import (
    KST,
    MONTHLY_LIMIT_REASONS,
    TransferLog,
    record_search_rejection,
)
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Outcome, ReviewOpinion
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows import research_queue
from geosan.workflows.research import research_one
from geosan.workflows.research_queue import (
    BOOKMARK_REQUESTER,
    FAILURE_REASON,
    LIMIT_REASON,
    PAUSED_REASON,
    QUEUE_REQUESTER,
    any_running,
    is_running,
)

logger = logging.getLogger("geosan")

AUTO_REQUESTER = BOOKMARK_REQUESTER
# 아래 이름은 대기 줄(#744)과 함께 쓰려고 workflows/research_queue.py로 옮겼다. 같은 값·같은 함수다.
_RUNNING_SECONDS = research_queue.RUNNING_SECONDS
_started = research_queue._started
_day_start = research_queue.day_start
spent_today = research_queue.spent_today
_pending_starts = research_queue.pending_starts
used_today = research_queue.used_today
__all__ = ["FAILURE_REASON", "LIMIT_REASON", "any_running", "is_running"]

_tasks: ContextVar[BackgroundTasks | None] = ContextVar("geosan_auto_research", default=None)
# #719: 이번 저장으로 영업이 끝나는(성사·거절·보류) 요청은 관심이 켜져도 조사를 예약하지 않는다.
_paused: ContextVar[bool] = ContextVar("geosan_auto_research_paused", default=False)
# #744: 하루 첫 목록 읽기 때 대기 줄을 한 번 이어서 돌린다. 이 프로세스에서 이미 돌린 날(한국 시간).
_queue_day = None
_queue_day_lock = Lock()


@contextmanager
def no_auto_research(paused: bool = True):
    """이 안에서 관심이 켜져도 조사를 예약하지 않는다(기록도 남기지 않는다)."""
    token = _paused.set(paused)
    try:
        yield
    finally:
        _paused.reset(token)


async def attach_background(background_tasks: BackgroundTasks) -> None:
    """기록 창구 요청마다 "응답 뒤에 할 일" 목록을 이 요청의 문맥에 걸어 둔다."""
    _tasks.set(background_tasks)


def _marker(opportunity: Opportunity, *, reject_reason: str | None) -> TransferLog:
    """관심 자동 조사의 시작(허용) 또는 건너뜀(거부) 1행. 호출 수 0, 본문 없음(계약 C4)."""
    return research_queue.start_marker(
        opportunity, requester=AUTO_REQUESTER, reject_reason=reject_reason
    )


def queue_on_bookmark(
    session: Session, opportunity: Opportunity, *, find_homepage: bool = False
) -> bool:
    """관심이 켜진 저장 안에서 부른다. 조사할 회사면 시작 표시를 남기고 응답 뒤 조사를 예약한다.

    홈페이지가 없거나(이 경로에서는 홈페이지 찾기 웹 검색을 하지 않는다) 이미 조사된 회사,
    이미 도는 회사는 아무것도 하지 않는다. 꺼져 있으면(0) 흔적 없이 넘어가고,
    오늘 쓴 금액이 설정 이상이면 거부 1행만 남긴다. 조사를 예약했으면 True.
    #948: 담당자가 이름으로 넣은 회사는 find_homepage=True로 불러, 홈페이지가 없으면 찾기부터 한다
    (이미 "못 찾음"으로 끝난 회사는 다시 찾지 않는다).
    """
    tasks = _tasks.get()
    if tasks is None or opportunity.is_virtual or opportunity.purpose != "NEW_PROPOSAL":
        return False
    if _paused.get():
        return False
    settings = runtime_for(session).app_settings
    # #719: 자동 조사 스위치(후보 찾기 뒤·`geosan research`와 같은 스위치)가 꺼져 있으면
    # 하루 금액이 0일 때처럼 흔적 없이 넘어간다.
    if not settings.homepage_discovery.auto_research:
        return False
    limit = Decimal(str(settings.research.auto_on_bookmark_daily_cost_usd))
    if limit <= 0:
        return False
    customer = session.get(Customer, opportunity.customer_id)
    if (
        customer is None
        or customer.security_grade != "PUBLIC"
        or customer.researched_at is not None
    ):
        return False
    if not customer.homepage_url and (not find_homepage or customer.homepage_status == "NOT_FOUND"):
        return False
    opp_id = opportunity.opp_id
    has_evidence = session.scalar(
        select(Evidence.evidence_id)
        .where(Evidence.opp_id == opp_id, Evidence.superseded_at.is_(None))
        .limit(1)
    )
    if has_evidence is not None or is_running(opp_id):
        return False
    pending = _pending_starts(session)
    if any(row.opp_id == opp_id for row in pending):
        return False
    if used_today(session, settings, pending=pending) >= limit:
        session.add(_marker(opportunity, reject_reason=LIMIT_REASON))
        return False
    session.add(_marker(opportunity, reject_reason=None))
    if find_homepage and not customer.homepage_url:
        tasks.add_task(run_auto_research, opp_id, find_homepage=True)
    else:
        tasks.add_task(run_auto_research, opp_id)
    return True


def run_auto_research(opp_id: str, *, find_homepage: bool = False) -> None:
    """응답 뒤(관심 저장이 확정된 뒤) 한 번 실행. 실패는 숨기지 않는다.

    어떤 이유로 실패하든 전송 기록에 거부 1행이 남는다(#719). "조사 중" 표시는 여기서 켠다:
    저장이 되돌려진 요청은 이 함수가 불리지 않으므로 표시만 남는 일이 없다.
    """
    started_at = utcnow()
    research_queue.mark_running(opp_id)
    try:
        try:
            error = research_one(
                opp_id, find_homepage=find_homepage, transfer_requester=AUTO_REQUESTER
            ).error
        except Exception as raised:
            # 예외 글에는 본문·주소가 섞일 수 있어 종류만 로그에 남긴다.
            error = RunFailedError("회사 조사를 완료하지 못했습니다.")
            logger.error(
                "bookmark.research_crashed",
                extra={"oppId": opp_id, "ref": error.ref, "type": type(raised).__name__},
            )
        if error is not None:
            logger.warning("bookmark.research_failed", extra={"oppId": opp_id, "ref": error.ref})
            _record_failure(opp_id, error, started_at)
    finally:
        research_queue.unmark_running(opp_id)


def _record_failure(opp_id: str, error: AppError, started_at) -> None:
    """실패 이유 1행. 이 조사가 이미 거부 행(읽기 실패·한도 거부)을 남겼으면 더하지 않는다.

    이유 글에는 정해진 문구와 오류 종류만 넣는다(본문·주소·연락처·예외 원문 없음).
    """
    try:
        with session_scope() as session:
            recorded = session.scalar(
                select(TransferLog.transfer_log_id)
                .where(
                    TransferLog.opp_id == opp_id,
                    TransferLog.purpose == "EXTERNAL_AI",
                    TransferLog.decision == "REJECTED",
                    TransferLog.occurred_at >= started_at,
                )
                .limit(1)
            )
        if recorded is None:
            record_search_rejection(
                opp_id,
                f"{FAILURE_REASON} ({error.kind or 'RUN_FAILED'})",
                None,
                purpose="EXTERNAL_AI",
            )
    except Exception as record_error:
        logger.error(
            "bookmark.research_failure_not_recorded",
            extra={"oppId": opp_id, "ref": error.ref, "type": type(record_error).__name__},
        )


def _latest_attempt(session: Session, opp_ids: list[str]):
    """이 회사의 마지막 조사 시도 기록(전송 기록의 AI 용도 행) 1행. 없으면 None."""
    return research_queue.latest_attempt(session, opp_ids)


def just_started(session: Session, opp_ids: list[str]) -> bool:
    """자동 조사(관심·대기 줄)가 방금 시작했고 아직 끝나지 않았는가(researchState RUNNING, #744).

    서버 메모리의 "조사 중" 표시는 조사가 실제로 시작될 때 켜진다. 저장 직후 화면이 상세를
    다시 읽는 사이에는 저장된 시작 표시 행(마지막 기록이 그 행이고 최대 시간 안)으로 안다.
    """
    latest = _latest_attempt(session, opp_ids)
    return (
        latest is not None
        and latest.requested_by in research_queue.AUTO_REQUESTERS
        and (latest.decision, latest.call_count) == ("ALLOWED", 0)
        and latest.occurred_at >= utcnow() - timedelta(seconds=_RUNNING_SECONDS)
    )


def limit_skipped(session: Session, opp_ids: list[str]) -> bool:
    """이 회사의 마지막 조사 시도가 "한도로 건너뜀"인가(researchState LIMIT_SKIPPED).

    관심 자동 조사의 하루 금액 한도, 월 한도 거부(#719: 예전에는 "읽기 실패"로 보였다),
    대기 줄의 멈춤(#744). 그 뒤에 다른 조사(AI 호출·읽기 실패 기록)가 있었으면 더는 아니다.
    """
    latest = _latest_attempt(session, opp_ids)
    if latest is None or latest.decision != "REJECTED":
        return False
    if latest.reject_reason in MONTHLY_LIMIT_REASONS:
        return True
    return (latest.reject_reason, latest.requested_by) in {
        (LIMIT_REASON, AUTO_REQUESTER),
        (PAUSED_REASON, QUEUE_REQUESTER),
    }


# ---------- 찾기 뒤 자동 조사 대기 줄: 다음 날 이어서(#744) ----------


def _closed(session: Session, opp_ids: list[str]) -> set[str]:
    """끝난 회사(#675 "끝난 회사" 묶음 가운데 기록 부품에 있는 것): 제외 의견, 성사·거절·보류.

    거래 중·필수 탈락은 대기 줄 쪽에서 이미 거른다. 최신 값은 목록 묶음과 같은 순서로 읽는다.
    """
    opinions = dict(
        session.execute(
            select(ReviewOpinion.opp_id, ReviewOpinion.opinion)
            .where(ReviewOpinion.opp_id.in_(opp_ids))
            .order_by(ReviewOpinion.version, ReviewOpinion.recorded_at)
        ).all()
    )
    stages = dict(
        session.execute(
            select(Outcome.opp_id, Outcome.status)
            .where(Outcome.opp_id.in_(opp_ids), Outcome.cancelled_at.is_(None))
            .order_by(Outcome.version)
        ).all()
    )
    closed = {status.value for status in CLOSED_STAGES}
    return {
        opp_id
        for opp_id in opp_ids
        if opinions.get(opp_id) == _OPINION_EXCLUDED or stages.get(opp_id) in closed
    }


_OPINION_EXCLUDED = "NOT_TARGET"


def run_waiting_queue(progress_batch_id: str | None = None) -> research_queue.QueueRun:
    """조사 대기 줄을 하루 금액 안에서 돌린다. 끝난 회사는 뺀다. 실패는 줄 안에서 기록한다."""
    return research_queue.run_queue(
        lambda opp_id: research_one(opp_id),
        exclude=_closed,
        progress_batch_id=progress_batch_id,
    )


def continue_queue_today(session: Session, background_tasks: BackgroundTasks) -> None:
    """목록 읽기에서 부른다. 이 서버가 오늘(한국 시간) 아직 줄을 안 돌렸으면 응답 뒤 한 번 돌린다.

    스위치가 꺼져 있거나 하루 금액이 0이면, 외부 AI 설정이 꺼져 있으면 아무것도 하지 않는다.
    """
    global _queue_day
    settings = runtime_for(session).app_settings
    if research_queue.daily_limit(settings) is None or settings.llm.mode != "EXTERNAL":
        return
    today = utcnow().astimezone(KST).date()
    with _queue_day_lock:
        if _queue_day == today:
            return
        _queue_day = today
    background_tasks.add_task(_run_queue_safely)


def _run_queue_safely() -> None:
    try:
        run = run_waiting_queue()
    except Exception as error:
        # 줄이 멈춰도 목록 응답은 이미 나갔다. 숨기지 않고 로그에 남긴다.
        logger.error("queue.run_failed", extra={"type": type(error).__name__})
        return
    logger.info("queue.run_done", extra={"count": len(run.researched), "stopped": run.stopped})


def reset_queue_day() -> None:
    """검사용: 이 서버가 오늘 줄을 돌렸다는 표시를 지운다."""
    global _queue_day
    with _queue_day_lock:
        _queue_day = None
