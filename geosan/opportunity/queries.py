"""고객 식별과 기회의 현재 행 조회. 다른 기회의 이력을 자동으로 섞지 않는다."""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING

from sqlalchemy import and_, or_, select, update
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

if TYPE_CHECKING:
    from geosan.evidence.homepage import HomepageSearchResult


def store_case_homepage(
    session: Session,
    opp_id: str,
    customer_id: str,
    name: str,
    address: str,
    result: HomepageSearchResult,
    min_confidence: float,
) -> None:
    """검색 중 바뀐 고객·확정 주소·더 최근 결과를 덮어쓰지 않고 한 번에 저장한다."""
    case_exists = (
        select(Opportunity.opp_id)
        .where(
            Opportunity.opp_id == opp_id,
            Opportunity.customer_id == customer_id,
            Opportunity.case_id.is_not(None),
        )
        .exists()
    )
    same_result = and_(
        Customer.homepage_fetched_at == result.fetched_at,
        Customer.homepage_url.is_not_distinct_from(result.url),
        Customer.homepage_confidence == result.confidence,
        Customer.homepage_reason == result.reason,
    )
    write = (
        update(Customer)
        .where(
            Customer.customer_id == customer_id,
            case_exists,
            Customer.security_grade == "PUBLIC",
            Customer.name == name,
            Customer.normalized_address == address,
            Customer.homepage_status.is_distinct_from("CONFIRMED"),
            or_(
                Customer.homepage_fetched_at.is_(None),
                Customer.homepage_fetched_at < result.fetched_at,
                same_result,
            ),
        )
        .values(
            homepage_url=result.url,
            homepage_status=result.status(min_confidence),
            homepage_source="AI",
            homepage_confidence=result.confidence,
            homepage_reason=result.reason,
            homepage_fetched_at=result.fetched_at,
        )
    )
    if session.execute(write.execution_options(synchronize_session=False)).rowcount != 1:
        raise AppError(
            "검색하는 동안 회사 정보나 홈페이지 결과가 바뀌었습니다.",
            "상세 화면에서 현재 값을 확인해 주세요.",
            status=409,
            kind="STALE_VALUE",
        )


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


def store_company_research(
    session: Session,
    customer_id: str,
    *,
    expected: tuple,
    line: str,
    highlights: list[str],
    phone: str | None,
    phone_source_url: str | None,
) -> None:
    """#219 PM 지시: 공개 조사 결과 저장. 조사 중 바뀐 담당자 값은 덮어쓰지 않는다."""
    customer = session.get(Customer, customer_id)
    current = (
        (
            customer.name,
            customer.homepage_url,
            customer.homepage_status,
            customer.homepage_fetched_at,
            customer.researched_at,
            customer.main_phone,
            customer.main_phone_confirmed_at,
        )
        if customer
        else None
    )
    if current != expected or customer.security_grade != "PUBLIC":
        raise AppError(
            "조사하는 동안 회사 정보가 바뀌었습니다.",
            "현재 정보를 확인하고 다시 조사해 주세요.",
            status=409,
            kind="STALE_VALUE",
        )
    customer.summary_line = line
    customer.highlights = highlights
    customer.researched_at = utcnow()
    customer.research_source = "AI"
    if phone and phone != customer.main_phone:
        customer.main_phone = phone
        customer.main_phone_source = "HOMEPAGE"
        customer.main_phone_source_url = phone_source_url
        customer.main_phone_confirmed_at = None
        customer.main_phone_confirmed_by = None
    session.flush()


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
