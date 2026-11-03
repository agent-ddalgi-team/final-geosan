"""고객 식별과 기회의 현재 행 조회. 다른 기회의 이력을 자동으로 섞지 않는다."""

from __future__ import annotations

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.errors import AppError, NotFoundError
from geosan.opportunity.models import (
    Customer,
    DiscoveryPath,
    Interaction,
    Opportunity,
    OppProcessLink,
    Requirement,
    Signal,
)
from geosan.storage.base import utcnow


def confirm_main_phone(session: Session, opp_id: str, expected_phone: str, staff: str) -> Customer:
    """현재 번호를 잠금 안에서 비교하고 확인 정보만 저장한다. 번호 자체는 바꾸지 않는다."""
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id) if opportunity else None
    if customer is None or not customer.main_phone:
        raise NotFoundError("확인할 대표번호가 없습니다.")
    if customer.main_phone != expected_phone:
        raise AppError(
            "대표번호가 그 사이 바뀌었습니다.",
            "상세 화면을 새로 불러온 뒤 확인해 주세요.",
            status=409,
            kind="STALE_VALUE",
        )
    customer.main_phone_confirmed_at = utcnow()
    customer.main_phone_confirmed_by = staff
    session.flush()
    return customer


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"\s+", "", value.replace("(주)", ""))


def normalize_address(value: str | None) -> str | None:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold() if value else None


def find_customer(
    session: Session, *, biz_number: str | None, name: str, address: str | None
) -> Customer | None:
    if biz_number:
        query = select(Customer).where(Customer.biz_number == biz_number)
    else:
        query = select(Customer).where(
            Customer.biz_number.is_(None),
            Customer.normalized_name == normalize_name(name),
            Customer.normalized_address == normalize_address(address),
        )
    return session.scalar(query)


def find_case(session: Session, case_id: str) -> Opportunity | None:
    return session.scalar(select(Opportunity).where(Opportunity.case_id == case_id))


def current_rows(session: Session, model, opp_id: str) -> list:
    """같은 기회에 명시적으로 연결된 현재 행만 읽는다(고객 전체 이력은 제외)."""
    return list(
        session.scalars(select(model).where(model.opp_id == opp_id, model.superseded_at.is_(None)))
    )


def list_requirements(session: Session, opp_id: str) -> list[Requirement]:
    return current_rows(session, Requirement, opp_id)


def list_signals(session: Session, opp_id: str) -> list[Signal]:
    return current_rows(session, Signal, opp_id)


def list_process_links(session: Session, opp_id: str) -> list[OppProcessLink]:
    return current_rows(session, OppProcessLink, opp_id)


def list_discovery_paths(session: Session, opp_id: str) -> list[DiscoveryPath]:
    return current_rows(session, DiscoveryPath, opp_id)


def list_linked_interactions(session: Session, opp_id: str) -> list[Interaction]:
    return current_rows(session, Interaction, opp_id)


def supersede_children(session: Session, opp_id: str) -> None:
    now = utcnow()
    for model in (Requirement, Signal, DiscoveryPath, OppProcessLink, Interaction):
        for row in current_rows(session, model, opp_id):
            row.superseded_at = now
    session.flush()
