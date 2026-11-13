"""#497: AI 제안 검토 줄과 담당자의 새 버전 저장. 호출·점수 계산은 기존 부품을 쓴다."""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.api.schemas import OpportunityDetail, ReviewItem
from geosan.capability.models import Process
from geosan.config.errors import FieldError, InputError, NotFoundError, RunFailedError
from geosan.config.rule_config import profile_items
from geosan.evaluation.inputs import AI_PROPOSED, current_item_inputs
from geosan.evaluation.models import ItemJudgmentInput
from geosan.opportunity.models import Opportunity, OppProcessLink
from geosan.rules.codes import ReviewItemKind, ReviewItemSource
from geosan.storage.base import new_id

_CERTAINTY_LABELS = {"CONFIRMED": "확인", "STRONG": "강한 추정", "WEAK": "약한 추정"}


def _catalog(session: Session):
    return {item.item_code: item for item in profile_items(runtime_for(session).rule_config)}


def proposal_review_items(
    session: Session, opportunity: Opportunity, data: OpportunityDetail
) -> list[ReviewItem]:
    """현재 AI 행만 보인다. 인용은 상세에 보이는 허용된 근거에서만 가져온다."""
    catalog = _catalog(session)
    visible_quotes = {row.evidence_id: row.quote for row in data.evidence}
    current = {row.item_code: row for row in current_item_inputs(session, opportunity.opp_id)}
    items = []
    for code, config in catalog.items():
        row = current.get(code)
        if row is None or row.proposed_by != AI_PROPOSED:
            continue
        label = config.label or code
        step = row.match_rate_step or "미확보"
        certainty = _CERTAINTY_LABELS.get(row.state)
        value = f"{step}({certainty})" if certainty else step
        quotes = [visible_quotes[key] for key in row.evidence_ids if key in visible_quotes]
        basis = " / ".join(dict.fromkeys(quotes)) or "인용 없음"
        items.append(
            ReviewItem(
                item_id=f"II:{code}",
                kind=ReviewItemKind.ITEM_INPUT_PROPOSAL,
                source=ReviewItemSource.AI,
                text=f"AI 제안 · {label} — {value} · 근거: {basis}",
                step_options=list(config.match_rate_steps),
                checked=False,
                checked_by=None,
                checked_at=None,
            )
        )
    names = dict(
        session.execute(
            select(Process.code, Process.name).where(
                Process.dataset_kind == opportunity.dataset_kind
            )
        ).all()
    )
    for row in session.scalars(
        select(OppProcessLink)
        .where(
            OppProcessLink.opp_id == opportunity.opp_id,
            OppProcessLink.superseded_at.is_(None),
            OppProcessLink.source == AI_PROPOSED,
            OppProcessLink.state == "PENDING",
        )
        .order_by(OppProcessLink.process_code)
    ):
        quote = row.evidence_ref if row.evidence_ref in visible_quotes.values() else "인용 없음"
        items.append(
            ReviewItem(
                item_id=f"PL:{row.process_code}",
                kind=ReviewItemKind.PROCESS_LINK_PROPOSAL,
                source=ReviewItemSource.AI,
                text=(
                    f"AI 공정 연결 제안 · {names.get(row.process_code, row.process_code)}"
                    f" · 근거: {quote}"
                ),
                step_options=None,
                checked=False,
                checked_by=None,
                checked_at=None,
            )
        )
    return items


def confirm_ai_link(session: Session, row: OppProcessLink, *, staff: str, now: datetime) -> None:
    """AI 공정 제안 행을 이력으로 남기고 같은 내용의 담당자 확정 행을 만든다(#497, #652도 씀)."""
    row.superseded_at = now
    session.add(
        OppProcessLink(
            link_id=new_id("link"),
            opp_id=row.opp_id,
            process_code=row.process_code,
            applied_material=row.applied_material,
            current_result=row.current_result,
            current_reason=row.current_reason,
            evidence_ref=row.evidence_ref,
            source="STAFF",
            state="CONFIRMED",
            confirmed_by=staff,
            confirmed_at=now,
            dataset_kind=row.dataset_kind,
            is_virtual=row.is_virtual,
            created_by=staff,
            created_at=now,
        )
    )


def confirm_proposal(
    session: Session,
    opportunity: Opportunity,
    item_id: str,
    *,
    step_label: str | None,
    staff: str,
    now: datetime,
) -> str:
    """기존 AI 행을 남기고 담당자 행을 만든다. 호출자가 재평가와 기록을 같은 트랜잭션에 잇는다."""
    prefix, _, code = item_id.partition(":")
    if prefix == "II":
        return _confirm_item(session, opportunity, code, step_label, staff, now)
    if prefix != "PL":
        raise NotFoundError("확정할 AI 제안이 없습니다.")
    if step_label is not None:
        raise InputError("공정 연결 제안은 단계 고치기 없이 확정만 할 수 있습니다.")
    row = session.scalar(
        select(OppProcessLink).where(
            OppProcessLink.opp_id == opportunity.opp_id,
            OppProcessLink.process_code == code,
            OppProcessLink.superseded_at.is_(None),
            OppProcessLink.source == AI_PROPOSED,
            OppProcessLink.state == "PENDING",
        )
    )
    if row is None:
        raise NotFoundError("현재 확정할 AI 공정 제안이 없습니다.")
    confirm_ai_link(session, row, staff=staff, now=now)
    name = (
        session.scalar(
            select(Process.name).where(
                Process.dataset_kind == opportunity.dataset_kind, Process.code == code
            )
        )
        or code
    )
    return f"AI 공정 제안 확정 · {name}"


def _confirm_item(session, opportunity, code, step_label, staff, now):
    config = _catalog(session).get(code)
    row = next(
        (
            r
            for r in current_item_inputs(session, opportunity.opp_id)
            if r.item_code == code and r.proposed_by == AI_PROPOSED
        ),
        None,
    )
    if row is None or config is None:
        raise NotFoundError("현재 확정할 AI 점수 제안이 없습니다.")
    if step_label is not None and step_label not in config.match_rate_steps:
        raise InputError(
            "이 항목에 설정된 단계 이름을 골라 주세요.",
            fields=[
                FieldError(
                    path="stepLabel", message="항목의 단계 선택지 가운데 하나를 골라 주세요."
                )
            ],
        )
    step = step_label if step_label is not None else row.match_rate_step
    if step is not None and step not in config.match_rate_steps:
        raise RunFailedError("AI 제안의 단계와 현재 설정이 맞지 않습니다.")
    if step is None and row.state != "UNAVAILABLE":
        raise RunFailedError("AI 제안의 단계 값이 없습니다. 제안을 확인해 주세요.")
    version = (
        session.scalar(
            select(func.max(ItemJudgmentInput.version)).where(
                ItemJudgmentInput.opp_id == opportunity.opp_id, ItemJudgmentInput.item_code == code
            )
        )
        or 0
    )
    row.superseded_at = now
    session.add(
        ItemJudgmentInput(
            item_input_id=new_id("ii"),
            opp_id=opportunity.opp_id,
            item_code=code,
            # 미확보를 확인하는 경우에도 점수·일치도를 지어내지 않는다.
            state="CONFIRMED" if step is not None else "UNAVAILABLE",
            match_rate_step=step,
            match_rate=float(config.match_rate_steps[step]) if step is not None else None,
            fact_judged=row.fact_judged,
            summary=row.summary,
            evidence_ids=list(row.evidence_ids),
            signal_ids=list(row.signal_ids),
            used_capability_refs=row.used_capability_refs,
            proposed_by="STAFF",
            entered_by=staff,
            entered_at=now,
            version=version + 1,
            dataset_kind=row.dataset_kind,
            is_virtual=row.is_virtual,
            created_by=staff,
            created_at=now,
        )
    )
    action = "고침" if step_label is not None else "확정"
    return f"AI 점수 제안 {action} · {config.label or code} — {step or '미확보'}"
