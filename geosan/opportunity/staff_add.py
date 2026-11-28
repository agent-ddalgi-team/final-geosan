"""#948: 담당자가 이름으로 찾아 회사 1곳을 직접 넣는다(PM 결정 2026-11-26, 계약 C1 `/companies`).

거산이 이미 진행 중인 회사를 이 서버에서 관리하려는데, 목록의 회사 검색은 이미 들어온 회사
안에서만 찾고 [새 후보 발굴]은 AI가 맞는 곳을 골라 최대 건수만 넣어 그 회사가 들어오지 않았다.

- 찾기(`lookup`)는 저장된 목록·공장 자료만 읽는다. 외부 호출이 없고 지역 조건도 없다.
- 넣기(`add_company`)는 AI 후보 고르기를 거치지 않는다. 찾은 회사와 같은 목록·평가·조사 흐름을
  쓰도록 넣을 때마다 회차 1행(sourceId STAFF_ADDED, DONE)을 만들어 회사에 단다(C6).
- 커밋·평가·관심·조사는 하지 않는다. 호출하는 창구가 같은 트랜잭션에서 이어서 한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.errors import InputError, NotFoundError
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.factory_profile import ProfileIndex, apply_to_customer
from geosan.opportunity.models import Customer, IngestBatch, MergeCandidate, Opportunity
from geosan.opportunity.queries import normalize_address, normalize_name, registry_representative
from geosan.opportunity.source_models import SourceFactoryRow, public_source_kinds
from geosan.rules.codes import DiscoverySource
from geosan.storage.base import new_id, utcnow

STAFF_ADDED_SOURCE = DiscoverySource.STAFF_ADDED.value
NO_PRODUCT_ITEM = "생산품 확인 전"
NAME_MIN, NAME_MAX = 2, 50
EXISTING_LIMIT, FACTORY_LIMIT = 10, 20
COMPANY_NAME_MAX, ADDRESS_MAX, URL_MAX = 200, 300, 500


@dataclass(frozen=True)
class ExistingMatch:
    opp_id: str
    company_name: str
    address: str | None


@dataclass(frozen=True)
class FactoryMatch:
    row_id: str
    company_name: str
    address: str
    region: str
    product: str | None
    industry_name: str | None
    opp_id: str | None


@dataclass(frozen=True)
class LookupResult:
    existing: list[ExistingMatch]
    factories: list[FactoryMatch]
    truncated: bool


@dataclass(frozen=True)
class AddResult:
    opportunity: Opportunity
    created: bool


def check_lookup_name(name: str | None) -> str:
    """찾기 이름을 다듬어 돌려준다. 2자 미만·50자 초과면 거부한다."""
    value = (name or "").strip()
    if not NAME_MIN <= len(value) <= NAME_MAX:
        raise InputError(
            "찾을 회사 이름을 확인해 주세요.", f"{NAME_MIN}~{NAME_MAX}자로 입력해 주세요."
        )
    return value


def _order(query: str, name: str) -> tuple[bool, str]:
    """정확히 같은 이름을 먼저, 그다음 이름순."""
    return normalize_name(name) != query, name


def _opp_of(session: Session, customer_id: str) -> str | None:
    return session.scalar(
        select(Opportunity.opp_id)
        .where(Opportunity.customer_id == customer_id)
        .order_by(Opportunity.opp_id)
        .limit(1)
    )


def lookup(session: Session, name: str, *, dataset_kind: str) -> LookupResult:
    """이미 목록에 있는 회사와 공장 자료 행을 이름(정규화 부분 일치)으로 찾는다."""
    query = normalize_name(check_lookup_name(name))
    is_virtual = dataset_kind == "VIRTUAL_REVIEWED"
    customers = [
        customer
        for customer in session.scalars(select(Customer).where(Customer.is_virtual == is_virtual))
        if query in customer.normalized_name
    ]
    customers.sort(key=lambda customer: _order(query, customer.name))
    known: dict[tuple[str, str | None], str] = {}
    existing: list[ExistingMatch] = []
    for customer in customers:
        opp_id = _opp_of(session, customer.customer_id)
        if opp_id is None:
            continue
        known[(customer.normalized_name, customer.normalized_address)] = opp_id
        existing.append(ExistingMatch(opp_id, customer.name, customer.address))
    truncated = len(existing) > EXISTING_LIMIT
    rows = [
        row
        for row in session.scalars(
            select(SourceFactoryRow).where(
                SourceFactoryRow.missing_since.is_(None),
                SourceFactoryRow.dataset_kind.in_(public_source_kinds(dataset_kind)),
                SourceFactoryRow.is_virtual == is_virtual,
            )
        )
        if query in normalize_name(row.company_name)
    ]
    rows.sort(key=lambda row: (*_order(query, row.company_name), row.address, row.row_id))
    seen: set[tuple[str, str | None]] = set()
    factories: list[FactoryMatch] = []
    for row in rows:
        key = (normalize_name(row.company_name), normalize_address(row.address))
        if key in seen:
            # 파일·조회 양쪽에 같은 공장이 있으면 한 줄만 보인다.
            continue
        seen.add(key)
        if len(factories) >= FACTORY_LIMIT:
            truncated = True
            break
        factories.append(
            FactoryMatch(
                row_id=row.row_id,
                company_name=row.company_name,
                address=row.address,
                region=row.region,
                product=row.product,
                industry_name=row.industry_name,
                opp_id=known.get(key),
            )
        )
    return LookupResult(existing[:EXISTING_LIMIT], factories, truncated)


def _clean(value: str | None, *, label: str, limit: int) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if len(text) > limit:
        raise InputError(f"{label}이(가) 너무 깁니다.", f"{limit}자 안으로 입력해 주세요.")
    if scrub_contacts(text)[1]:
        raise InputError(
            f"{label}에 전화번호나 이메일이 있어 넣지 않았습니다.",
            "연락처는 빼고 입력해 주세요. 연락처는 상세의 영업 메모에 적을 수 있습니다.",
        )
    return text


def check_homepage_url(value: str | None) -> str | None:
    url = _clean(value, label="홈페이지 주소", limit=URL_MAX)
    if url is not None and not url.lower().startswith(("http://", "https://")):
        raise InputError(
            "홈페이지 주소를 확인해 주세요.", "http:// 또는 https://로 시작하는 주소를 넣어 주세요."
        )
    return url


def add_company(
    session: Session,
    *,
    staff: str,
    dataset_kind: str,
    row_id: str | None = None,
    company_name: str | None = None,
    address: str | None = None,
    homepage_url: str | None = None,
    surface_codes: Sequence[str] = (),
) -> AddResult:
    """회사 1곳을 넣는다. 같은 회사가 이미 있으면 새로 만들지 않고 그 기회를 돌려준다."""
    url = check_homepage_url(homepage_url)
    is_virtual = dataset_kind == "VIRTUAL_REVIEWED"
    row = None
    if row_id is not None:
        if company_name is not None or address is not None:
            raise InputError(
                "공장 자료에서 고른 회사는 이름·주소를 따로 보내지 않습니다.",
                "다시 골라 주세요.",
            )
        row = session.get(SourceFactoryRow, row_id)
        if (
            row is None
            or row.missing_since is not None
            or row.dataset_kind not in public_source_kinds(dataset_kind)
            or row.is_virtual != is_virtual
        ):
            raise NotFoundError("고른 공장 자료를 찾지 못했습니다.", "다시 찾아 주세요.")
        name = _clean(row.company_name, label="회사 이름", limit=COMPANY_NAME_MAX)
        place = _clean(row.address, label="주소", limit=ADDRESS_MAX)
        # 생산품은 카드 품목 칸 길이에 맞춰 자른다(공장 자료의 긴 생산품 글로 넣기를 막지 않는다).
        item_max = Opportunity.__table__.c.item.type.length
        product = _clean((row.product or "")[:item_max], label="생산품", limit=item_max)
    else:
        name = _clean(company_name, label="회사 이름", limit=COMPANY_NAME_MAX)
        place = _clean(address, label="주소", limit=ADDRESS_MAX)
        product = None
    if not name or not normalize_name(name):
        raise InputError("회사 이름을 입력해 주세요.")
    key_name, key_address = normalize_name(name), normalize_address(place)
    customers = list(
        session.scalars(
            select(Customer)
            .where(Customer.is_virtual == is_virtual, Customer.normalized_name == key_name)
            .order_by(Customer.customer_id)
        )
    )
    for customer in customers:
        if key_address is None or customer.normalized_address == key_address:
            opp_id = _opp_of(session, customer.customer_id)
            if opp_id is not None:
                return AddResult(session.get(Opportunity, opp_id), created=False)
    same_address = (
        list(
            session.scalars(
                select(Customer).where(
                    Customer.is_virtual == is_virtual,
                    Customer.normalized_address == key_address,
                )
            )
        )
        if key_address
        else []
    )
    now = utcnow()
    common = dict(created_by=staff, dataset_kind=dataset_kind, is_virtual=is_virtual)
    batch = IngestBatch(
        batch_id=new_id("batch"),
        source_id=STAFF_ADDED_SOURCE,
        requested_by=staff,
        started_at=now,
        finished_at=now,
        status="DONE",
        criteria=None,
        new_count=1,
        **common,
    )
    session.add(batch)
    customer = Customer(
        customer_id=new_id("cust"),
        name=name,
        normalized_name=key_name,
        address=place,
        normalized_address=key_address,
        relation_status="UNCONFIRMED",
        security_grade="PUBLIC",
        ingest_batch_id=batch.batch_id,
        ingested_at=now,
        discovery_source=STAFF_ADDED_SOURCE,
        identity_basis=(
            "담당자가 공장 자료에서 고른 회사명과 공장주소"
            if row is not None
            else "담당자가 직접 입력한 회사명"
        ),
        **(registry_representative(row) if row is not None else {}),
        **common,
    )
    if url is not None:
        customer.homepage_url = url
        customer.homepage_status = "CONFIRMED"
        customer.homepage_source = "STAFF"
        customer.homepage_fetched_at = now
    if row is not None and not is_virtual:
        # 그 회사 이름의 팩토리온 행만 읽는다. 경기까지 넣으면 전체가 커서(#966).
        index = ProfileIndex(session, [customer.name], water=True)
        apply_to_customer(customer, index, surface_codes)
    session.add(customer)
    session.flush()
    opportunity = Opportunity(
        opp_id=new_id("opp"),
        customer_id=customer.customer_id,
        item=product or NO_PRODUCT_ITEM,
        purpose="NEW_PROPOSAL",
        **common,
    )
    session.add(opportunity)
    for other in {c.customer_id: c for c in [*customers, *same_address]}.values():
        session.add(
            MergeCandidate(
                merge_candidate_id=new_id("merge"),
                customer_id_a=other.customer_id,
                customer_id_b=customer.customer_id,
                match_basis=(
                    "회사명은 같고 공장주소가 달라 확인 필요"
                    if other.normalized_name == key_name
                    else "공장주소는 같고 회사명이 달라 확인 필요"
                ),
                status="PENDING",
                batch_id=batch.batch_id,
                **common,
            )
        )
    session.flush()
    return AddResult(opportunity, created=True)
