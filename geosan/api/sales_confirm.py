"""#652: 꼬리 질문 답으로 그 회사의 공정·산업군을 확정한다.

공정은 검토사항의 [확정](#497)과 같은 방식으로 저장한다(AI 행은 이력으로 남기고 담당자 행을 만든다).
재평가와 활동 이력 저장은 창구(`routes/records.py`)가 같은 트랜잭션 안에서 잇는다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.proposal_review import confirm_ai_link
from geosan.evaluation.inputs import AI_PROPOSED
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.storage.base import new_id

# 약속 C6: 회사 산업군은 설정 목록 안 값 3개까지.
MAX_INDUSTRIES = 3
STAFF = "STAFF"


@dataclass(frozen=True)
class ConfirmResult:
    """활동 이력에 남길 한 줄(바뀐 것이 없으면 None)과 다시 평가해야 하는지."""

    summary: str | None
    links_changed: bool


def confirm_processes(
    session: Session,
    opportunity: Opportunity,
    codes: Sequence[str],
    names: Mapping[str, str],
    *,
    staff: str,
    now: datetime,
) -> ConfirmResult:
    """고른 공정을 확정하고, 안 고른 AI 제안은 이력으로만 남겨 이 회사에서 뺀다.

    이미 확정된 연결(사례 파일·담당자)은 고르지 않아도 그대로 둔다. 지우는 행은 없다.
    """
    chosen = set(codes)
    rows = list(
        session.scalars(
            select(OppProcessLink)
            .where(
                OppProcessLink.opp_id == opportunity.opp_id,
                OppProcessLink.superseded_at.is_(None),
            )
            .order_by(OppProcessLink.link_id)
        )
    )
    changed = False
    dropped = 0
    for row in rows:
        if row.source != AI_PROPOSED or row.state != "PENDING":
            continue
        changed = True
        if row.process_code in chosen:
            confirm_ai_link(session, row, staff=staff, now=now)
        else:
            row.superseded_at = now
            dropped += 1
    linked = {row.process_code for row in rows}
    for code in codes:
        if code in linked:
            continue
        changed = True
        linked.add(code)
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=opportunity.opp_id,
                process_code=code,
                source=STAFF,
                state="CONFIRMED",
                confirmed_by=staff,
                confirmed_at=now,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
                created_by=staff,
                created_at=now,
            )
        )
    if not changed:
        return ConfirmResult(None, False)
    summary = "꼬리 질문으로 공정 확정 · " + ", ".join(names.get(code, code) for code in codes)
    if dropped:
        summary += f" · AI 제안 {dropped}개 뺌"
    return ConfirmResult(summary, True)


def confirm_industries(
    session: Session, opportunity: Opportunity, industries: Sequence[str], *, now: datetime
) -> ConfirmResult:
    """산업군을 고른 값으로 바꾸고 출처를 담당자 확정으로 남긴다(평가 입력이 아니라 재평가 없음)."""
    customer = session.get(Customer, opportunity.customer_id)
    values = list(industries)
    if list(customer.industries or []) == values and customer.industries_source == STAFF:
        return ConfirmResult(None, False)
    customer.industries = values
    customer.industries_source = STAFF
    customer.industries_confirmed_at = now
    return ConfirmResult("꼬리 질문으로 산업 확정 · " + ", ".join(values), False)
