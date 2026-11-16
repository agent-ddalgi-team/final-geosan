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
from geosan.rules.codes import CALL_SIGNAL_KINDS
from geosan.storage.base import utcnow

if TYPE_CHECKING:
    from geosan.evidence.homepage import HomepageSearchResult


def public_origin_condition():
    """공개 출처로 확인된 회사 조건(#492).

    사례 파일로 들어온 회사(case_id)이거나, 소스 이용 확인을 거친 후보 찾기 회차로
    들어온 회사(ingest_batch_id — 공장현황 파일·단지 조회·웹 검색)다. 회차는 소스 확인
    기록(C5 SourceContract) 없이는 만들어지지 않으므로 둘 다 공개 출처다. 둘 다 없으면
    출처를 모르는 회사라 외부 검색·저장을 하지 않는다.
    """
    return or_(Opportunity.case_id.is_not(None), Customer.ingest_batch_id.is_not(None))


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
    # 사례 파일 회사뿐 아니라 후보 찾기로 들어온 회사도 공개 출처다(#492).
    case_exists = (
        select(Opportunity.opp_id)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .where(
            Opportunity.opp_id == opp_id,
            Opportunity.customer_id == customer_id,
            public_origin_condition(),
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
            customer.address,
            customer.normalized_address,
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
    if phone:
        if phone != customer.main_phone:
            customer.main_phone_confirmed_at = None
            customer.main_phone_confirmed_by = None
        customer.main_phone = phone
        customer.main_phone_source = "HOMEPAGE"
        customer.main_phone_source_url = phone_source_url
    session.flush()


# #793: 홈페이지로 다시 정한 적합도의 기준 값과 이유 앞머리(C1 fitBasis·pickReason).
FIT_BASIS_HOMEPAGE = "HOMEPAGE"
HOMEPAGE_FIT_PREFIX = "홈페이지 기준 · "
# #793: 닫힌 홈페이지 표시. 새 열 없이 homepage_reason 글 맨 앞에 우리 코드만 붙인다.
CLOSED_HOMEPAGE_MARK = "[닫힘] "


def apply_homepage_fit(
    session: Session, customer: Customer, fit_level: str | None, reason: str
) -> bool:
    """조사가 홈페이지로 다시 본 적합도를 회사 카드에 옮긴다(C1 #793). 옮겼으면 True.

    후보 찾기로 들어와 적합도가 있는 회사만 바꾼다(사례 파일 회사는 그대로). AI가 판단할
    문장을 못 찾았으면(fit_level None) 그대로다. 처음 생산품 기준 적합도는 한 번만 남긴다.
    기회 카드 문장은 옛 추천 이유와 같을 때만 같이 바꾼다(#615와 같은 규칙, 손으로 고친 문장 보존).
    """
    if customer.ingest_batch_id is None or customer.fit_level is None or fit_level is None:
        return False
    new_reason = f"{HOMEPAGE_FIT_PREFIX}{reason.strip()}"
    for opportunity in session.scalars(
        select(Opportunity).where(Opportunity.customer_id == customer.customer_id)
    ):
        if opportunity.card_reason == customer.pick_reason:
            opportunity.card_reason = new_reason
    if customer.fit_basis != FIT_BASIS_HOMEPAGE:
        customer.previous_fit_level = customer.fit_level
    customer.fit_level = fit_level
    customer.pick_reason = new_reason
    customer.fit_basis = FIT_BASIS_HOMEPAGE
    session.flush()
    return True


def mark_homepage_closed(session: Session, customer_id: str, *, expected: tuple, reason: str):
    """닫힌 홈페이지(#793)를 '홈페이지 못 찾음'으로 바꾼다. 담당자가 확정한 주소는 그대로 둔다.

    이전 주소는 이유 글에 남기고 주소를 비워, 다음 [다시 조사]가 홈페이지 찾기부터 하게 한다.
    조사하는 동안 회사 값이 바뀌었으면 아무것도 바꾸지 않는다. 바꿨으면 True.
    """
    customer = session.get(Customer, customer_id)
    if customer is None or customer.homepage_status == "CONFIRMED":
        return False
    current = (
        customer.name,
        customer.address,
        customer.normalized_address,
        customer.homepage_url,
        customer.homepage_status,
        customer.homepage_fetched_at,
        customer.researched_at,
        customer.main_phone,
        customer.main_phone_confirmed_at,
    )
    if current != expected:
        return False
    previous = customer.homepage_url or "없음"
    customer.homepage_reason = f"{CLOSED_HOMEPAGE_MARK}{reason} · 이전 주소 {previous}"
    customer.homepage_url = None
    customer.homepage_status = "NOT_FOUND"
    customer.homepage_source = "AI"
    customer.homepage_confidence = None
    customer.homepage_fetched_at = utcnow()
    session.flush()
    return True


def closed_homepage_reason(status: str | None, reason: str | None) -> str | None:
    """닫힌 홈페이지로 본 이유("호스팅 만료"·"빈 페이지"), 아니면 None(C1 #793)."""
    if status != "NOT_FOUND" or not reason or not reason.startswith(CLOSED_HOMEPAGE_MARK):
        return None
    return reason[len(CLOSED_HOMEPAGE_MARK) :].split(" · ", 1)[0] or None


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
            # #685: 통화에서 확인한 신호는 접촉 기록에서 온 것이라 사례 파일 재투입이 지우지 않는다.
            if model is Signal and row.signal_kind in CALL_SIGNAL_KINDS:
                continue
            row.superseded_at = now
    session.flush()
