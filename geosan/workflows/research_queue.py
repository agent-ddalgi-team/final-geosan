"""#744: 찾기로 들어온 회사의 자동 조사 대기 줄과, 관심 자동 조사(#690)와 함께 쓰는 하루 금액.

- 줄에 넣는 회사: 후보 찾기로 들어온 회사 가운데 적합도 상(HIGH)·중(MEDIUM)이고, 표면처리를
  직접 하는 회사 표시가 없고, 거래 중·필수 탈락이 아니고, 아직 조사하지 않았고, 자동 조사가
  시작한 적이 없는 회사. 관심 의견·영업 단계로 끝난 회사는 기록 부품을 읽는 창구(api)가 더 거른다.
- 순서: 적합도 상 → 중, 같으면 점수 전 목록 순서(들어온 시각 → 만든 시각 → 기회 번호).
- 하루 금액: 설정 `research.autoOnBookmarkDailyCostUsd`를 관심 자동 조사와 함께 쓴다(새 숫자 없음).
  닿으면 줄을 멈추고 남은 회사는 그대로 둔다. 다음 날 창구가 다시 돌린다.
- 새 표·일꾼은 없다. "시작했다"는 전송 기록의 시작 표시 행으로 안다(#690과 같은 모양).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, timedelta
from decimal import Decimal
from threading import Lock

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    AppSettings,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, RunFailedError
from geosan.evaluation.ledger import latest_confirmed_evaluations
from geosan.evidence.models import Evidence
from geosan.evidence.research_context import research_context
from geosan.evidence.transfer import (
    KST,
    MONTHLY_LIMIT_REASONS,
    TransferLog,
    accounted_cost,
    record_search_rejection,
)
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows.research import STOP_KINDS, ResearchResult

logger = logging.getLogger("geosan")

# 전송 기록의 요청자(C4). 두 자동 조사의 호출 비용을 합쳐 하루 금액과 견준다.
BOOKMARK_REQUESTER = "auto-bookmark"
QUEUE_REQUESTER = "auto-ingest"
AUTO_REQUESTERS = (BOOKMARK_REQUESTER, QUEUE_REQUESTER)
# 관심 자동 조사가 하루 금액 때문에 건너뛴 회사의 거부 이유(#690, 문구 그대로).
LIMIT_REASON = "관심 자동 조사 하루 금액 한도 초과"
FAILURE_REASON = "자동 조사 중단 · 조사를 끝내지 못했습니다"
# 대기 줄이 월 한도·검색 한도·설정 문제로 멈췄을 때 그 회사에 남기는 이유(C4 #744). 다시 줄에 든다.
PAUSED_REASON = "자동 조사 줄 멈춤 · 다음에 이어서 조사"
# 마지막 기록이 이 이유면 "아직 조사하지 못한 회사"로 보고 다시 줄에 넣는다.
RETRY_REASONS = frozenset({LIMIT_REASON, PAUSED_REASON, *MONTHLY_LIMIT_REASONS})
# 줄에 넣는 적합도와 그 순서(점수 전 목록 순서와 같다).
QUEUE_FITS = ("HIGH", "MEDIUM")
_EXISTING_RELATION = "EXISTING_CONFIRMED"
_FILTER_EXCLUDED = "FILTER_EXCLUDED"

# 조사 한 곳의 60초 한도에 여유를 더한 시간. 조사가 끝맺지 못해도(서버가 꺼짐 등)
# "조사 중" 표시와 "방금 시작한 조사" 셈이 이 시간 뒤에는 저절로 풀린다. 영업 규칙이 아니다.
RUNNING_SECONDS = 90

_started: dict[str, float] = {}
_lock = Lock()
# 대기 줄은 한 번에 하나만 돈다(찾기 회차 뒤와 하루 첫 목록 읽기가 겹쳐도 두 번 조사하지 않음).
_queue_lock = Lock()


# ---------- "조사 중" 표시(서버 메모리) ----------


def is_running(opp_id: str) -> bool:
    with _lock:
        started = _started.get(opp_id)
        if started is None:
            return False
        if time.monotonic() - started > RUNNING_SECONDS:
            del _started[opp_id]
            return False
        return True


def any_running() -> bool:
    with _lock:
        return bool(_started)


def mark_running(opp_id: str) -> None:
    with _lock:
        _started[opp_id] = time.monotonic()


def unmark_running(opp_id: str) -> None:
    with _lock:
        _started.pop(opp_id, None)


# ---------- 하루 금액(관심 자동 조사와 함께 씀) ----------


def day_start():
    local = utcnow().astimezone(KST)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def daily_limit(settings: AppSettings) -> Decimal | None:
    """자동 조사가 하루에 쓸 금액. 스위치가 꺼져 있거나 0이면 None(돌지 않음)."""
    if not settings.homepage_discovery.auto_research:
        return None
    limit = Decimal(str(settings.research.auto_on_bookmark_daily_cost_usd))
    return limit if limit > 0 else None


def start_marker(
    opportunity: Opportunity, *, requester: str, reject_reason: str | None = None
) -> TransferLog:
    """자동 조사의 시작(허용) 또는 건너뜀(거부) 1행. 호출 수 0, 본문 없음(계약 C4)."""
    return TransferLog(
        transfer_log_id=new_id("transfer"),
        occurred_at=utcnow(),
        opp_id=opportunity.opp_id,
        purpose="EXTERNAL_AI",
        kind="PUBLIC_TEXT",
        mode="NONE",
        security_grade="PUBLIC",
        decision="REJECTED" if reject_reason else "ALLOWED",
        reject_reason=reject_reason,
        requested_by=requester,
        call_count=0,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )


def spent_today(session: Session, llm) -> Decimal:
    """자동 조사(관심·대기 줄)가 오늘(한국 시간) 쓴 AI 비용. 월 한도와 같은 계산(미확정은 추정)."""
    rows = session.scalars(
        select(TransferLog).where(
            TransferLog.requested_by.in_(AUTO_REQUESTERS),
            TransferLog.occurred_at >= day_start(),
            TransferLog.call_count > 0,
        )
    ).all()
    return sum((accounted_cost(row, llm) for row in rows), Decimal(0))


def pending_starts(session: Session) -> list[TransferLog]:
    """방금 시작해 아직 끝나지 않은 자동 조사의 시작 표시 행(#719).

    조사 한 곳 최대 시간 안에 남았고, 그 뒤 그 회사의 AI 호출 행이나 거부 행이 아직 없는 것만이다.
    """
    since = max(day_start(), utcnow() - timedelta(seconds=RUNNING_SECONDS))
    starts = session.scalars(
        select(TransferLog).where(
            TransferLog.requested_by.in_(AUTO_REQUESTERS),
            TransferLog.purpose == "EXTERNAL_AI",
            TransferLog.decision == "ALLOWED",
            TransferLog.call_count == 0,
            TransferLog.occurred_at >= since,
        )
    ).all()
    return [
        row
        for row in starts
        if session.scalar(
            select(TransferLog.transfer_log_id)
            .where(
                TransferLog.opp_id == row.opp_id,
                TransferLog.purpose.in_(["EXTERNAL_AI", "EXTERNAL_SEARCH"]),
                TransferLog.transfer_log_id != row.transfer_log_id,
                TransferLog.occurred_at >= row.occurred_at,
                or_(TransferLog.call_count > 0, TransferLog.decision == "REJECTED"),
            )
            .limit(1)
        )
        is None
    ]


def used_today(session: Session, settings, *, pending: list[TransferLog] | None = None) -> Decimal:
    """하루 금액과 견줄 값: 오늘 쓴 금액 + 방금 시작한 조사 1곳마다 예상 비용(#719)."""
    if pending is None:
        pending = pending_starts(session)
    estimate = Decimal(str(settings.ingestion.cost_estimate.research_usd_per_company))
    return spent_today(session, settings.llm) + estimate * len(pending)


# ---------- 마지막 조사 시도 ----------


def latest_attempt(session: Session, opp_ids: list[str], *, with_search: bool = False):
    """이 회사의 마지막 조사 시도 기록 1행. 없으면 None.

    기본은 AI 용도 행만 본다(#690 상태 계산 그대로). 대기 줄은 홈페이지 찾기 검색 행도 본다.
    """
    if not opp_ids:
        return None
    purposes = ["EXTERNAL_AI", "EXTERNAL_SEARCH"] if with_search else ["EXTERNAL_AI"]
    return session.execute(
        select(
            TransferLog.reject_reason,
            TransferLog.requested_by,
            TransferLog.decision,
            TransferLog.call_count,
            TransferLog.occurred_at,
        )
        .where(TransferLog.opp_id.in_(opp_ids), TransferLog.purpose.in_(purposes))
        .order_by(TransferLog.occurred_at.desc(), TransferLog.transfer_log_id.desc())
        .limit(1)
    ).one_or_none()


def started_before(session: Session, opp_id: str) -> bool:
    """자동 조사(관심·대기 줄)가 이 회사를 시작한 적이 있고, 한도·멈춤으로 끝난 것이 아닌가."""
    marker = session.scalar(
        select(TransferLog.transfer_log_id)
        .where(
            TransferLog.opp_id == opp_id,
            TransferLog.requested_by.in_(AUTO_REQUESTERS),
            TransferLog.purpose == "EXTERNAL_AI",
            TransferLog.decision == "ALLOWED",
            TransferLog.call_count == 0,
        )
        .limit(1)
    )
    if marker is None:
        return False
    latest = latest_attempt(session, [opp_id], with_search=True)
    return not (
        latest is not None
        and latest.decision == "REJECTED"
        and latest.reject_reason in RETRY_REASONS
    )


# ---------- 대기 줄 ----------


def queue_order(customer: Customer, opportunity: Opportunity) -> tuple:
    """적합도 상 → 중, 같으면 점수 전 목록 순서(api `candidate_order`의 점수 전 쪽과 같은 차례)."""
    return (
        QUEUE_FITS.index(customer.fit_level),
        customer.ingested_at or customer.created_at,
        customer.created_at,
        opportunity.opp_id,
    )


def waiting_opportunities(
    session: Session, settings: AppSettings, *, opp_ids: list[str] | None = None
) -> list[str]:
    """조사 대기 줄에 선 기회 번호(차례대로). opp_ids를 주면 그 안에서만 고른다."""
    query = (
        select(Opportunity, Customer)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .where(
            Customer.ingest_batch_id.is_not(None),
            Customer.is_virtual.is_(False),
            Opportunity.is_virtual.is_(False),
            Opportunity.dataset_kind == settings.active_dataset_kind.value,
            Customer.fit_level.in_(QUEUE_FITS),
            Customer.own_plating_line_suspected.is_(False),
            Customer.researched_at.is_(None),
            or_(Customer.homepage_status.is_(None), Customer.homepage_status != "NOT_FOUND"),
            Customer.relation_status != _EXISTING_RELATION,
        )
    )
    if opp_ids is not None:
        if not opp_ids:
            return []
        query = query.where(Opportunity.opp_id.in_(opp_ids))
    rows = session.execute(query).all()
    if not rows:
        return []
    ids = [opportunity.opp_id for opportunity, _ in rows]
    with_evidence = set(
        session.scalars(
            select(Evidence.opp_id).where(
                Evidence.opp_id.in_(ids), Evidence.superseded_at.is_(None)
            )
        )
    )
    evaluations = latest_confirmed_evaluations(session, ids)
    waiting = [
        (opportunity, customer)
        for opportunity, customer in rows
        if opportunity.opp_id not in with_evidence
        and getattr(evaluations.get(opportunity.opp_id), "classification_code", None)
        != _FILTER_EXCLUDED
        and not is_running(opportunity.opp_id)
        and not started_before(session, opportunity.opp_id)
    ]
    waiting.sort(key=lambda pair: queue_order(pair[1], pair[0]))
    return [opportunity.opp_id for opportunity, _ in waiting]


@dataclass
class QueueRun:
    """대기 줄 한 번의 결과. stopped: EMPTY(빔) / LIMIT(하루 금액) / OFF(꺼짐) / BUSY / STOP."""

    researched: list[str] = field(default_factory=list)
    stopped: str = "EMPTY"
    error: AppError | None = None


def run_queue(
    research: Callable[[str], ResearchResult],
    *,
    exclude: Callable[[Session, list[str]], set[str]] | None = None,
    opp_ids: list[str] | None = None,
    progress_batch_id: str | None = None,
) -> QueueRun:
    """대기 줄을 하루 금액 안에서 한 곳씩 조사한다. 회사마다 줄과 금액을 다시 본다.

    research는 회사 한 곳 조사(기본 `research_one`). 요청자는 바깥 조사 문맥으로 넘겨 호출 행에
    auto-ingest가 남는다. exclude는 창구가 기록 부품으로 더 거를 회사(끝난 회사)를 돌려준다.
    opp_ids를 주면 그 회사들만 본다(찾기 회차 직후). progress_batch_id 회차는 끝난 시각도 늦춘다.
    """
    if not _queue_lock.acquire(blocking=False):
        return QueueRun(stopped="BUSY")
    run = QueueRun()
    tried: set[str] = set()
    try:
        while True:
            with session_scope() as session:
                settings = read_app_settings(session) or load_app_settings(
                    DEFAULT_APP_SETTINGS_PATH
                )
                limit = daily_limit(settings)
                if limit is None:
                    run.stopped = "OFF"
                    return run
                waiting = [
                    opp_id
                    for opp_id in waiting_opportunities(session, settings, opp_ids=opp_ids)
                    if opp_id not in tried
                ]
                if exclude is not None and waiting:
                    skipped = exclude(session, waiting)
                    waiting = [opp_id for opp_id in waiting if opp_id not in skipped]
                if not waiting:
                    run.stopped = "EMPTY"
                    return run
                if used_today(session, settings) >= limit:
                    run.stopped = "LIMIT"
                    return run
                opp_id = waiting[0]
                session.add(
                    start_marker(session.get(Opportunity, opp_id), requester=QUEUE_REQUESTER)
                )
            tried.add(opp_id)
            error = _research(research, opp_id).error
            if error is not None and error.kind in STOP_KINDS:
                # 그 회사 탓이 아니므로 다음에 다시 줄에 넣는다(조사한 수에 세지 않음).
                _record(opp_id, PAUSED_REASON, error, only_if_new=False)
                run.stopped, run.error = "STOP", error
                return run
            run.researched.append(opp_id)
            _count_progress(opp_id, progress_batch_id)
            if error is not None:
                logger.warning("queue.research_failed", extra={"oppId": opp_id, "ref": error.ref})
                _record(opp_id, f"{FAILURE_REASON} ({error.kind or 'RUN_FAILED'})", error)
    finally:
        _queue_lock.release()


def _research(research: Callable[[str], ResearchResult], opp_id: str) -> ResearchResult:
    mark_running(opp_id)
    try:
        with research_context(QUEUE_REQUESTER):
            return research(opp_id)
    except Exception as raised:
        # 예외 글에는 본문·주소가 섞일 수 있어 종류만 로그에 남긴다.
        error = RunFailedError("회사 조사를 완료하지 못했습니다.")
        logger.error(
            "queue.research_crashed",
            extra={"oppId": opp_id, "ref": error.ref, "type": type(raised).__name__},
        )
        return ResearchResult(error=error)
    finally:
        unmark_running(opp_id)


def _count_progress(opp_id: str, progress_batch_id: str | None) -> None:
    """그 회사가 들어온 회차의 "조사 n/m"을 1 올린다. 찾기 회차 직후면 끝난 시각도 늦춘다."""
    with session_scope() as session:
        batch_id = session.scalar(
            select(Customer.ingest_batch_id)
            .join(Opportunity, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id == opp_id)
        )
        batch = session.get(IngestBatch, batch_id) if batch_id else None
        if batch is None:
            return
        batch.research_done_count += 1
        if batch.batch_id == progress_batch_id:
            batch.finished_at = utcnow()


def _record(opp_id: str, reason: str, error: AppError, *, only_if_new: bool = True) -> None:
    """이유 1행(C4). 이유 글에는 정해진 문구와 오류 종류만 넣는다(본문·주소·예외 원문 없음).

    only_if_new면 이 조사가 이미 거부 행(읽기 실패 등)을 남긴 경우 더하지 않는다(#719와 같음).
    """
    try:
        with session_scope() as session:
            opportunity = session.get(Opportunity, opp_id)
            if only_if_new:
                latest = latest_attempt(session, [opp_id], with_search=True)
                if latest is not None and latest.decision == "REJECTED":
                    return
            if opportunity is not None and reason == PAUSED_REASON:
                session.add(
                    start_marker(opportunity, requester=QUEUE_REQUESTER, reject_reason=reason)
                )
                return
        record_search_rejection(opp_id, reason, None, purpose="EXTERNAL_AI")
    except Exception as record_error:
        logger.error(
            "queue.failure_not_recorded",
            extra={"oppId": opp_id, "ref": error.ref, "type": type(record_error).__name__},
        )
