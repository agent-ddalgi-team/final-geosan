"""담당자 선호 제안·승인 읽기(#943, PM 결정 2026-11-26 되먹임 ③). 창구와 목록이 같이 쓴다.

기록 표에서 읽기만 하고(관심·접촉·검토 의견·성사·거절·공정 연결·거리), 계산은
`geosan.dashboard.preference`의 순수 함수가 한다. 저장은 승인·끄기 창구만 한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.api.process_catalog import load_process_catalog
from geosan.config.app_settings import ContactPreferenceSettings
from geosan.config.sales_questions import KST
from geosan.dashboard.contact_order import closed_results
from geosan.dashboard.preference import (
    DISTANCE,
    Combo,
    CompanyTraits,
    PreferenceRule,
    Suggestion,
    suggest,
)
from geosan.dashboard.sales_analysis import load_company_records
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.geo_store import customer_distances
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Bookmark, Outcome, PreferenceApproval, ReviewOpinion

NOT_TARGET = "NOT_TARGET"
# 관심을 담당자가 단추로 켠 행만 "고름"으로 센다(기록 저장 때 자동으로 켜진 행·옮긴 자료는 뺀다).
MANUAL_BOOKMARK = "MANUAL"


@dataclass(frozen=True)
class PreferenceState:
    settings: ContactPreferenceSettings | None
    picked_count: int
    suggestions: list[Suggestion]
    active: list[PreferenceApproval]


def preference_settings(session: Session) -> ContactPreferenceSettings | None:
    """켜진 설정. 없거나 enabled false면 None(제안·효과 모두 없음)."""
    contact_list = runtime_for(session).app_settings.contact_list
    found = contact_list.preference if contact_list else None
    return found if found is not None and found.enabled else None


def combo_of(row: PreferenceApproval) -> Combo:
    return Combo(
        row.kind,
        process_code=row.process_code,
        industry=row.industry,
        distance_km=float(row.distance_km) if row.distance_km is not None else None,
    )


def active_approvals(session: Session, now: datetime) -> list[PreferenceApproval]:
    """켜진 승인(되돌리지 않았고 기한 전), 활성 묶음만, 승인 순."""
    dataset_kind = runtime_for(session).app_settings.active_dataset_kind.value
    rows = session.scalars(
        select(PreferenceApproval)
        .where(
            PreferenceApproval.dataset_kind == dataset_kind,
            PreferenceApproval.revoked_at.is_(None),
        )
        .order_by(PreferenceApproval.approved_at, PreferenceApproval.pref_id)
    )
    return [row for row in rows if row.expires_at > now]


def company_traits(session: Session, opp_ids: set[str]) -> dict[str, CompanyTraits]:
    """목록 #610과 같은 값: 살아 있는 공정 연결 · 회사 산업군 · 저장 공공좌표 직선거리."""
    if not opp_ids:
        return {}
    codes: dict[str, set[str]] = {}
    for opp_id, code in session.execute(
        select(OppProcessLink.opp_id, OppProcessLink.process_code)
        .where(OppProcessLink.opp_id.in_(opp_ids), OppProcessLink.superseded_at.is_(None))
        .distinct()
    ):
        codes.setdefault(opp_id, set()).add(code)
    pairs = session.execute(
        select(Opportunity, Customer)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(Opportunity.opp_id.in_(opp_ids))
    ).all()
    settings = runtime_for(session).app_settings
    distances = customer_distances(
        session,
        [customer for _opportunity, customer in pairs],
        {customer.customer_id: opportunity.opp_id for opportunity, customer in pairs},
        settings,
        live=False,
    )
    return {
        opportunity.opp_id: CompanyTraits(
            opp_id=opportunity.opp_id,
            process_codes=frozenset(codes.get(opportunity.opp_id, set())),
            industries=frozenset(customer.industries or []),
            distance_km=distances.get(customer.customer_id),
        )
        for opportunity, customer in pairs
    }


def _population(session: Session, dataset_kind: str):
    """목록과 같은 대상: 활성 묶음에서 확정 평가가 있는 기회."""
    return (
        select(EvaluationRun.opp_id)
        .where(EvaluationRun.dataset_kind == dataset_kind, EvaluationRun.run_status == "CONFIRMED")
        .distinct()
    )


def picked_and_excluded(
    session: Session, *, dataset_kind: str, since: datetime
) -> tuple[set[str], set[str]]:
    """기간 안 고른 회사(관심을 직접 켬·취소 안 된 접촉 기록)와 제외한 회사(최신 의견이 제외이고
    그 의견이 기간 안). 최신 의견이 제외인 회사는 고른 회사에서 뺀다."""
    population = _population(session, dataset_kind)
    picked = set(
        session.scalars(
            select(Bookmark.opp_id).where(
                Bookmark.opp_id.in_(population),
                Bookmark.active.is_(True),
                Bookmark.source == MANUAL_BOOKMARK,
                Bookmark.created_at >= since,
            )
        )
    ) | set(
        session.scalars(
            select(Outcome.opp_id).where(
                Outcome.opp_id.in_(population),
                Outcome.method.is_not(None),
                Outcome.cancelled_at.is_(None),
                Outcome.created_at >= since,
            )
        )
    )
    latest: dict[str, tuple[str, datetime]] = {}
    for opp_id, opinion, recorded_at in session.execute(
        select(ReviewOpinion.opp_id, ReviewOpinion.opinion, ReviewOpinion.recorded_at)
        .where(ReviewOpinion.opp_id.in_(population))
        .order_by(ReviewOpinion.version, ReviewOpinion.recorded_at)
    ):
        latest[opp_id] = (opinion, recorded_at)
    not_target = {opp_id for opp_id, (opinion, _at) in latest.items() if opinion == NOT_TARGET}
    excluded = {opp_id for opp_id in not_target if latest[opp_id][1] >= since}
    return picked - not_target, excluded


def preference_state(session: Session, now: datetime) -> PreferenceState:
    """제안과 켜진 승인. 설정이 꺼져 있으면 빈 값."""
    settings = preference_settings(session)
    if settings is None:
        return PreferenceState(None, 0, [], [])
    app_settings = runtime_for(session).app_settings
    dataset_kind = app_settings.active_dataset_kind.value
    picked, excluded = picked_and_excluded(
        session, dataset_kind=dataset_kind, since=now - timedelta(days=settings.window_days)
    )
    adjust = app_settings.contact_list.adjust
    closed = closed_results(
        load_company_records(
            session, dataset_kind=dataset_kind, sales_step_of=lambda _opp_id, _status: None
        ),
        window_days=adjust.window_days,
        now=now,
        tz=KST,
    )
    traits = company_traits(session, picked | excluded | {row.opp_id for row in closed})
    active = active_approvals(session, now)
    suggestions = suggest(
        traits,
        picked=picked,
        excluded=excluded,
        closed=[(row.opp_id, row.won) for row in closed],
        rule=PreferenceRule(
            min_picks=settings.min_picks,
            min_share=settings.min_share,
            distance_km=settings.distance_km,
            min_closed_for_rate=settings.min_closed_for_rate,
        ),
        process_order=[
            row.code for row in load_process_catalog(session, app_settings.active_dataset_kind)
        ],
        industry_order=app_settings.industries,
        active=[combo_of(row) for row in active],
    )
    return PreferenceState(settings, len(picked), suggestions, active)


def same_combo(suggestion: Suggestion, combo: Combo) -> bool:
    found = suggestion.combo
    if found.kind != combo.kind:
        return False
    if found.kind == DISTANCE:
        return found.distance_km == combo.distance_km
    return (found.process_code, found.industry) == (combo.process_code, combo.industry)
