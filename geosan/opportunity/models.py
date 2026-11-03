"""OpportunityRegistry 테이블 (opp_, entities.md). 이 파일의 열은 PM 세션만 고친다.

고객에는 공개 대표번호만 둔다(2026-11-03 PM, #209). 개인 연락처 열은 없다.
기회의 자식 행(발견 경로·공정 연결·요구·신호·접촉 이력)은
재투입 때 `superseded_at`을 찍고 새 행을 넣는다(BR1.7). 공정 연결은 공정 ID가 아니라 공정 코드를
저장하고 평가 때 활성 묶음의 Process로 해석한다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, Supersedable, UtcDateTime


class Customer(CommonColumns, Base):
    """고객 기업. 공개 대표번호와 기업 요약은 계약 C6에 따른다."""

    __tablename__ = "opp_customer"

    customer_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)
    biz_number: Mapped[str | None] = mapped_column(String(10), unique=True)
    normalized_address: Mapped[str | None] = mapped_column(String(300))
    identity_basis: Mapped[str | None] = mapped_column(Text)
    relation_status: Mapped[str] = mapped_column(String(24), nullable=False)
    relation_confirmed_at: Mapped[date | None] = mapped_column(Date)
    company_filter_status: Mapped[str] = mapped_column(String(16), nullable=False, default="PASS")
    company_filter_reason: Mapped[str | None] = mapped_column(Text)
    security_grade: Mapped[str] = mapped_column(String(24), nullable=False)
    main_phone: Mapped[str | None] = mapped_column(Text)
    main_phone_source: Mapped[str | None] = mapped_column(String(16))
    main_phone_source_url: Mapped[str | None] = mapped_column(Text)
    main_phone_confirmed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    main_phone_confirmed_by: Mapped[str | None] = mapped_column(String(64))
    summary_line: Mapped[str | None] = mapped_column(Text)
    highlights: Mapped[list[str] | None] = mapped_column(JSON)
    researched_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    research_source: Mapped[str | None] = mapped_column(String(16))


class Opportunity(CommonColumns, Base):
    """영업기회. 고객 하나에 속하고 같은 프로젝트는 ID 하나 (FR2.2, FR2.3)."""

    __tablename__ = "opp_opportunity"

    opp_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    customer_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_customer.customer_id"), nullable=False
    )
    case_id: Mapped[str | None] = mapped_column(String(80), unique=True)
    base_date: Mapped[date | None] = mapped_column(Date)
    item: Mapped[str] = mapped_column(String(200), nullable=False)
    project: Mapped[str | None] = mapped_column(String(300))
    distinction_basis: Mapped[str | None] = mapped_column(Text)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(32))
    progress_status: Mapped[str | None] = mapped_column(String(32))
    review_condition: Mapped[str | None] = mapped_column(Text)
    review_owner: Mapped[str | None] = mapped_column(String(32))
    review_due_at: Mapped[date | None] = mapped_column(Date)
    merge_history: Mapped[Any | None] = mapped_column(JSON)
    card_reason: Mapped[str | None] = mapped_column(Text)  # 카드 추천 이유 한 문장 (#139, rec_002)


class Interaction(Supersedable, CommonColumns, Base):
    """접촉 이력(거래·견적·상담·제안·메모). 고객에 속하고 기회에 연결할 수 있다 (FR2.7).

    재접촉 7칸(pastProcessItem 이하)은 U6이 채운다.
    """

    __tablename__ = "opp_interaction"

    interaction_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    customer_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_customer.customer_id"), nullable=False
    )
    opp_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("opp_opportunity.opp_id"))
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[date | None] = mapped_column(Date)
    allowed_summary: Mapped[str | None] = mapped_column(Text)
    apply_scope: Mapped[str | None] = mapped_column(String(120))
    certainty: Mapped[str] = mapped_column(String(16), nullable=False)
    confirmed_at: Mapped[date | None] = mapped_column(Date)
    entered_by: Mapped[str] = mapped_column(String(64), nullable=False)
    security_grade: Mapped[str] = mapped_column(String(24), nullable=False, default="INTERNAL_ONLY")
    external_ai_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    past_process_item: Mapped[str | None] = mapped_column(String(200))
    order_count: Mapped[int | None] = mapped_column(Integer)
    sample_approved: Mapped[bool | None] = mapped_column(Boolean)
    requirement_met: Mapped[str | None] = mapped_column(String(60))
    loss_reason: Mapped[str | None] = mapped_column(Text)
    loss_resolved: Mapped[bool | None] = mapped_column(Boolean)
    last_delivery_at: Mapped[date | None] = mapped_column(Date)
    order_cycle: Mapped[str | None] = mapped_column(String(60))


class DiscoveryPath(Supersedable, CommonColumns, Base):
    """기회를 발견한 경로. 기회당 여러 건, (sourceId, originKey)로 중복 판정 (FR2.3)."""

    __tablename__ = "opp_discovery_path"

    path_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    path_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(80))
    origin_key: Mapped[str | None] = mapped_column(String(200))
    discovered_at: Mapped[date | None] = mapped_column(Date)
    evidence_id: Mapped[str | None] = mapped_column(String(40))


class OppProcessLink(Supersedable, CommonColumns, Base):
    """기회-공정 연결. (기회, 공정 코드) 쌍당 하나(현재 행 기준). 현재 결과는 평가 파생값 (FR2.5)"""

    __tablename__ = "opp_process_link"

    link_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    process_code: Mapped[str] = mapped_column(String(32), nullable=False)
    applied_material: Mapped[str | None] = mapped_column(String(40))
    current_result: Mapped[str | None] = mapped_column(String(16))
    current_reason: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    source_eval_id: Mapped[str | None] = mapped_column(String(40))


class Requirement(Supersedable, CommonColumns, Base):
    """고객 요구(인증·승인·기술·수량/납기). 수준을 짐작해 채우지 않는다 (FR3.1)."""

    __tablename__ = "opp_requirement"

    req_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    link_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("opp_process_link.link_id"))
    req_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    req_level: Mapped[str] = mapped_column(String(16), nullable=False)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    required_value: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(20))
    edition: Mapped[str | None] = mapped_column(String(40))
    holder: Mapped[str | None] = mapped_column(String(120))
    site: Mapped[str | None] = mapped_column(String(120))
    certainty: Mapped[str] = mapped_column(String(16), nullable=False)
    needed_stage: Mapped[str] = mapped_column(String(16), nullable=False)
    due_at: Mapped[date | None] = mapped_column(Date)
    question: Mapped[str | None] = mapped_column(Text)
    basis: Mapped[str | None] = mapped_column(Text)
    evidence_id: Mapped[str | None] = mapped_column(String(40))
    proposed_by: Mapped[str] = mapped_column(String(16), nullable=False, default="FILE")
    staff_confirmed_state: Mapped[str | None] = mapped_column(String(60))


class Signal(Supersedable, CommonColumns, Base):
    """시점 신호(증설·신규 수주·공고·채용·재발주 주기·후속 연락) (FR4.3, FR4.7)."""

    __tablename__ = "opp_signal"

    signal_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("opp_opportunity.opp_id"), nullable=False
    )
    signal_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    occurred_at: Mapped[date | None] = mapped_column(Date)
    announced_at: Mapped[date | None] = mapped_column(Date)
    scheduled_at: Mapped[date | None] = mapped_column(Date)
    confirmed_at: Mapped[date | None] = mapped_column(Date)
    deadline_at: Mapped[date | None] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(40), nullable=False, default="Asia/Seoul")
    progress_status: Mapped[str | None] = mapped_column(String(16))
    next_check_at: Mapped[date | None] = mapped_column(Date)
    agreed_window: Mapped[Any | None] = mapped_column(JSON)
    certainty: Mapped[str] = mapped_column(String(16), nullable=False)
    relation: Mapped[str] = mapped_column(String(16), nullable=False)
    entered_by: Mapped[str] = mapped_column(String(64), nullable=False)
    evidence_id: Mapped[str | None] = mapped_column(String(40))
