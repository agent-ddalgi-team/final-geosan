"""#652: 꼬리 질문 답으로 그 회사의 공정·산업군을 확정한다.

공정은 검토사항의 [확정](#497)과 같은 방식으로 저장한다(AI 행은 이력으로 남기고 담당자 행을 만든다).
#720: 답에 실린 공정 목록이 확정 공정 전체다 — 안 고른 확정 공정은 이력으로 남기고 뺀다.
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
    """고른 공정을 확정하고, 안 고른 AI 제안과 안 고른 확정 공정은 이력으로만 남겨 뺀다.

    (바뀜 2026-11-14 #720 — PM 결정: 통화에서 공정을 바꿀 수 있게) 답에 실린 공정 목록이 그 회사의
    확정 공정 전체를 뜻한다. 목록에 없는 확정 연결(사례 파일·담당자)은 살아 있는 연결에서 빠지고
    행은 이력(superseded)으로 남는다. 지우는 행은 없다. 빈 목록이면 아무것도 바꾸지 않는다
    (확정 공정을 0개로 만들지 않는다).
    """
    chosen = set(codes)
    if not chosen:
        return ConfirmResult(None, False)
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
    # #719: 저장 전에 확인된 공정(사례 파일·담당자 확정)이 있었는지. 문장을 고르는 데만 쓴다.
    confirmed_before = {row.process_code for row in rows if row.state == "CONFIRMED"}
    changed = False
    dropped = 0
    for row in rows:
        if row.state == "CONFIRMED" and row.process_code not in chosen:
            # #720: 안 고른 확정 공정은 이력으로만 남긴다(AI 제안을 뺄 때와 같은 방식).
            row.superseded_at = now
            changed = True
            continue
        if row.source != AI_PROPOSED or row.state != "PENDING":
            continue
        changed = True
        if row.process_code in chosen:
            confirm_ai_link(session, row, staff=staff, now=now)
        else:
            row.superseded_at = now
            dropped += 1
    linked = {
        row.process_code for row in rows if row.superseded_at is None or row.source == AI_PROPOSED
    }
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
    confirmed_after = chosen
    if confirmed_before and confirmed_after != confirmed_before:
        # 확인된 값이 있던 회사에서 값이 달라졌다. 안 고른 확정 공정은 빠지므로(#720) 새 값에는
        # 고른 것만 남는다("아연도금 → 니켈도금").
        summary = (
            f"공정 변경 · {_names(confirmed_before, names)} → {_names(confirmed_after, names)}"
        )
    else:
        summary = "꼬리 질문으로 공정 확정 · " + ", ".join(names.get(code, code) for code in codes)
    if dropped:
        summary += f" · AI 제안 {dropped}개 뺌"
    return ConfirmResult(summary, True)


def _names(codes: set[str], names: Mapping[str, str]) -> str:
    """공정 이름을 공정 목록 순서로 잇는다(목록에 없는 코드는 코드 그대로 뒤에)."""
    ordered = [code for code in names if code in codes]
    ordered += sorted(codes - set(ordered))
    return ", ".join(names.get(code, code) for code in ordered)


def confirm_industries(
    session: Session, opportunity: Opportunity, industries: Sequence[str], *, now: datetime
) -> ConfirmResult:
    """산업군을 고른 값으로 바꾸고 출처를 담당자 확정으로 남긴다(평가 입력이 아니라 재평가 없음)."""
    customer = session.get(Customer, opportunity.customer_id)
    values = list(industries)
    if list(customer.industries or []) == values and customer.industries_source == STAFF:
        return ConfirmResult(None, False)
    # #719: 저장 전에 확인된 산업(사례 파일·담당자 확정)이 있었고 값이 달라지면 "변경"으로 적는다.
    before = list(customer.industries or [])
    was_confirmed = bool(before) and customer.industries_source != AI_PROPOSED
    customer.industries = values
    customer.industries_source = STAFF
    customer.industries_confirmed_at = now
    if was_confirmed and before != values:
        return ConfirmResult(f"산업 변경 · {', '.join(before)} → {', '.join(values)}", False)
    return ConfirmResult("꼬리 질문으로 산업 확정 · " + ", ".join(values), False)
