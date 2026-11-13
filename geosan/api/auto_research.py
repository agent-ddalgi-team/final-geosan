"""#690: 관심을 켜면 그 회사 조사가 저절로 돈다(PM 결정 2026-11-13, 계약 C1 `/bookmark`).

관심이 켜지는 저장(관심 단추, 메모·영업 기록·검토 의견 저장)이 `queue_on_bookmark`를 부른다.
홈페이지 주소가 있고 아직 조사 전인 회사만, 응답을 보낸 뒤 서버 백그라운드로 한 번 조사한다
(후보 찾기 뒤 자동 조사와 같은 FastAPI BackgroundTasks). 새 표·일꾼은 없다.

- 하루 건수: 설정 `research.autoOnBookmarkPerDay`(0이면 꺼짐). 전송 기록의 시작 표시 행으로 센다.
- "조사 중" 표시: 이 프로세스의 메모리에만 둔다. 서버가 다시 켜지면 사라지고, 그 뒤 화면은
  저장된 값으로 정한 상태(읽기 실패 등)를 보인다.
"""

from __future__ import annotations

import logging
import time
from contextvars import ContextVar
from datetime import UTC
from threading import Lock

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.evidence.models import Evidence
from geosan.evidence.transfer import KST, TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import new_id, utcnow
from geosan.workflows.research import research_one

logger = logging.getLogger("geosan")

AUTO_REQUESTER = "auto-bookmark"
LIMIT_REASON = "관심 자동 조사 하루 한도 초과"
OFF_REASON = "관심 자동 조사 꺼짐"

# 조사 한 곳의 60초 한도에 여유를 더한 시간. 응답이 실패해 조사가 시작되지 못해도
# "조사 중" 표시가 이 시간 뒤에는 저절로 풀린다. 영업 규칙이 아니라 표시용 시간이다.
_RUNNING_SECONDS = 90

_tasks: ContextVar[BackgroundTasks | None] = ContextVar("geosan_auto_research", default=None)
_started: dict[str, float] = {}
_lock = Lock()


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
    이미 도는 회사는 아무것도 하지 않는다. 하루 건수를 넘거나 꺼져 있으면 거부 1행만 남긴다.
    """
    tasks = _tasks.get()
    if tasks is None or opportunity.is_virtual or opportunity.purpose != "NEW_PROPOSAL":
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
    limit = runtime_for(session).app_settings.research.auto_on_bookmark_per_day
    used = session.scalar(
        select(func.count())
        .select_from(TransferLog)
        .where(
            TransferLog.requested_by == AUTO_REQUESTER,
            TransferLog.decision == "ALLOWED",
            TransferLog.occurred_at >= _day_start(),
        )
    )
    if used >= limit:
        session.add(_marker(opportunity, reject_reason=LIMIT_REASON if limit else OFF_REASON))
        return
    session.add(_marker(opportunity, reject_reason=None))
    with _lock:
        _started[opp_id] = time.monotonic()
    tasks.add_task(run_auto_research, opp_id)


def run_auto_research(opp_id: str) -> None:
    """응답 뒤 한 번 실행. 실패는 숨기지 않는다: 읽기 실패는 전송 기록에, 나머지는 로그에 남는다."""
    try:
        result = research_one(opp_id, find_homepage=False)
        if result.error is not None:
            logger.warning(
                "bookmark.research_failed", extra={"oppId": opp_id, "ref": result.error.ref}
            )
    finally:
        with _lock:
            _started.pop(opp_id, None)


def limit_skipped(session: Session, opp_ids: list[str]) -> bool:
    """이 회사의 마지막 관심 자동 조사 표시가 "한도로 건너뜀"인가(researchState LIMIT_SKIPPED)."""
    if not opp_ids:
        return False
    # 그 뒤에 다른 조사(AI 호출·읽기 실패 기록)가 있었으면 더는 "한도로 건너뜀"이 아니다.
    latest = session.execute(
        select(TransferLog.decision, TransferLog.requested_by)
        .where(TransferLog.opp_id.in_(opp_ids), TransferLog.purpose == "EXTERNAL_AI")
        .order_by(TransferLog.occurred_at.desc(), TransferLog.transfer_log_id.desc())
        .limit(1)
    ).one_or_none()
    return latest is not None and tuple(latest) == ("REJECTED", AUTO_REQUESTER)
