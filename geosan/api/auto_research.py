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
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, timedelta
from decimal import Decimal
from threading import Lock

from fastapi import BackgroundTasks
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.config.errors import AppError, RunFailedError
from geosan.evidence.models import Evidence
from geosan.evidence.transfer import KST, TransferLog, accounted_cost, record_search_rejection
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows.research import research_one

logger = logging.getLogger("geosan")

AUTO_REQUESTER = "auto-bookmark"
LIMIT_REASON = "관심 자동 조사 하루 금액 한도 초과"
FAILURE_REASON = "자동 조사 중단 · 조사를 끝내지 못했습니다"

# 조사 한 곳의 60초 한도에 여유를 더한 시간. 조사가 끝맺지 못해도(서버가 꺼짐 등)
# "조사 중" 표시와 "방금 시작한 조사" 셈이 이 시간 뒤에는 저절로 풀린다. 영업 규칙이 아니다.
_RUNNING_SECONDS = 90

_tasks: ContextVar[BackgroundTasks | None] = ContextVar("geosan_auto_research", default=None)
# #719: 이번 저장으로 영업이 끝나는(성사·거절·보류) 요청은 관심이 켜져도 조사를 예약하지 않는다.
_paused: ContextVar[bool] = ContextVar("geosan_auto_research_paused", default=False)
_started: dict[str, float] = {}
_lock = Lock()


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


def is_running(opp_id: str) -> bool:
    with _lock:
        started = _started.get(opp_id)
        if started is None:
            return False
        if time.monotonic() - started > _RUNNING_SECONDS:
            del _started[opp_id]
            return False
        return True


def any_running() -> bool:
    with _lock:
        return bool(_started)


def _day_start():
    local = utcnow().astimezone(KST)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def _marker(opportunity: Opportunity, *, reject_reason: str | None) -> TransferLog:
    """관심 자동 조사의 시작(허용) 또는 건너뜀(거부) 1행. 호출 수 0, 본문 없음(계약 C4)."""
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
        requested_by=AUTO_REQUESTER,
        call_count=0,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )


def queue_on_bookmark(session: Session, opportunity: Opportunity) -> None:
    """관심이 켜진 저장 안에서 부른다. 조사할 회사면 시작 표시를 남기고 응답 뒤 조사를 예약한다.

    홈페이지가 없거나(이 경로에서는 홈페이지 찾기 웹 검색을 하지 않는다) 이미 조사된 회사,
    이미 도는 회사는 아무것도 하지 않는다. 꺼져 있으면(0) 흔적 없이 넘어가고,
    오늘 쓴 금액이 설정 이상이면 거부 1행만 남긴다.
    """
    tasks = _tasks.get()
    if tasks is None or opportunity.is_virtual or opportunity.purpose != "NEW_PROPOSAL":
        return
    if _paused.get():
        return
    settings = runtime_for(session).app_settings
    # #719: 자동 조사 스위치(후보 찾기 뒤·`geosan research`와 같은 스위치)가 꺼져 있으면
    # 하루 금액이 0일 때처럼 흔적 없이 넘어간다.
    if not settings.homepage_discovery.auto_research:
        return
    limit = Decimal(str(settings.research.auto_on_bookmark_daily_cost_usd))
    if limit <= 0:
        return
    customer = session.get(Customer, opportunity.customer_id)
    if (
        customer is None
        or customer.security_grade != "PUBLIC"
        or not customer.homepage_url
        or customer.researched_at is not None
    ):
        return
    opp_id = opportunity.opp_id
    has_evidence = session.scalar(
        select(Evidence.evidence_id)
        .where(Evidence.opp_id == opp_id, Evidence.superseded_at.is_(None))
        .limit(1)
    )
    if has_evidence is not None or is_running(opp_id):
        return
    pending = _pending_starts(session)
    if any(row.opp_id == opp_id for row in pending):
        return
    if used_today(session, settings, pending=pending) >= limit:
        session.add(_marker(opportunity, reject_reason=LIMIT_REASON))
        return
    session.add(_marker(opportunity, reject_reason=None))
    tasks.add_task(run_auto_research, opp_id)


def spent_today(session: Session, llm) -> Decimal:
    """관심 자동 조사가 오늘(한국 시간) 쓴 AI 비용. 월 한도와 같은 계산(미확정 호출은 추정)이다."""
    rows = session.scalars(
        select(TransferLog).where(
            TransferLog.requested_by == AUTO_REQUESTER,
            TransferLog.occurred_at >= _day_start(),
            TransferLog.call_count > 0,
        )
    ).all()
    return sum((accounted_cost(row, llm) for row in rows), Decimal(0))


def _pending_starts(session: Session) -> list[TransferLog]:
    """방금 시작해 아직 끝나지 않은 관심 자동 조사의 시작 표시 행(#719).

    조사 한 곳 최대 시간("조사 중" 표시와 같은 시간) 안에 남았고, 그 뒤 그 회사의 AI 호출 행이나
    거부 행이 아직 없는 것만이다. 서버가 꺼져 끝나지 못한 조사는 시간이 지나면 빠진다.
    """
    since = max(_day_start(), utcnow() - timedelta(seconds=_RUNNING_SECONDS))
    starts = session.scalars(
        select(TransferLog).where(
            TransferLog.requested_by == AUTO_REQUESTER,
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
                TransferLog.purpose == "EXTERNAL_AI",
                TransferLog.transfer_log_id != row.transfer_log_id,
                TransferLog.occurred_at >= row.occurred_at,
                or_(TransferLog.call_count > 0, TransferLog.decision == "REJECTED"),
            )
            .limit(1)
        )
        is None
    ]


def used_today(session: Session, settings, *, pending: list[TransferLog] | None = None) -> Decimal:
    """하루 금액과 견줄 값: 오늘 쓴 금액 + 방금 시작한 조사 1곳마다 예상 비용(#719).

    비용은 AI 호출이 끝나야 찍혀서, 연달아 관심을 켜면 모두 "아직 0원"으로 보여 한꺼번에
    시작됐다. 예상 비용은 후보 찾기 예상 금액과 같은 설정(회사 1곳 조사 실측 평균)을 쓴다.
    """
    if pending is None:
        pending = _pending_starts(session)
    estimate = Decimal(str(settings.ingestion.cost_estimate.research_usd_per_company))
    return spent_today(session, settings.llm) + estimate * len(pending)


def run_auto_research(opp_id: str) -> None:
    """응답 뒤(관심 저장이 확정된 뒤) 한 번 실행. 실패는 숨기지 않는다.

    어떤 이유로 실패하든 전송 기록에 거부 1행이 남는다(#719). "조사 중" 표시는 여기서 켠다:
    저장이 되돌려진 요청은 이 함수가 불리지 않으므로 표시만 남는 일이 없다.
    """
    started_at = utcnow()
    with _lock:
        _started[opp_id] = time.monotonic()
    try:
        try:
            error = research_one(
                opp_id, find_homepage=False, transfer_requester=AUTO_REQUESTER
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
        with _lock:
            _started.pop(opp_id, None)


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


def limit_skipped(session: Session, opp_ids: list[str]) -> bool:
    """이 회사의 마지막 관심 자동 조사 표시가 "한도로 건너뜀"인가(researchState LIMIT_SKIPPED)."""
    if not opp_ids:
        return False
    # 그 뒤에 다른 조사(AI 호출·읽기 실패 기록)가 있었으면 더는 "한도로 건너뜀"이 아니다.
    latest = session.execute(
        select(TransferLog.reject_reason, TransferLog.requested_by)
        .where(TransferLog.opp_id.in_(opp_ids), TransferLog.purpose == "EXTERNAL_AI")
        .order_by(TransferLog.occurred_at.desc(), TransferLog.transfer_log_id.desc())
        .limit(1)
    ).one_or_none()
    return latest is not None and tuple(latest) == (LIMIT_REASON, AUTO_REQUESTER)
