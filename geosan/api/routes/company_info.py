"""#958 상세 "한눈에 › 어떤 회사"의 주소·회사 이름 [고치기] 창구.

계약 C1 `POST /opportunities/{oppId}/company-info`.

PM 결정(2026-11-26): 회사를 직접 넣을 때(#948) 주소·이름을 잘못 적으면 고칠 곳이 없었다.
- 주소는 모든 회사에서 고친다. 저장된 공공좌표를 비워 다음 상세 읽기 때 기존 규칙대로 다시 찾는다.
- 회사 이름은 직접 넣은 회사만 고친다(공장 자료에서 온 회사는 등록된 공식 이름이다).
- 바뀐 값이 다른 회사와 같으면 넣기(#948)와 같은 겹침 후보를 만든다. 자동으로 합치지 않는다.
주소·이름은 평가 입력이 아니라 다시 평가하지 않는다. 새 표·칸 없음.
"""

from typing import Annotated

from fastapi import APIRouter, Path
from pydantic import Field
from sqlalchemy import or_, select

from geosan.api.deps import SessionDep, StaffDep
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import FieldError, InputError, NotFoundError
from geosan.opportunity.geo_store import DEMO_SOURCE
from geosan.opportunity.models import Customer, MergeCandidate, Opportunity
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.staff_add import (
    ADDRESS_MAX,
    COMPANY_NAME_MAX,
    STAFF_ADDED_SOURCE,
    _clean,
)
from geosan.records.program_note import add_program_note
from geosan.storage.base import new_id, utcnow

router = APIRouter()

SAME_NAME_BASIS = "회사명은 같고 공장주소가 달라 확인 필요"
SAME_ADDRESS_BASIS = "공장주소는 같고 회사명이 달라 확인 필요"


class CompanyInfoRequest(_RequestModel):
    address: Annotated[str, Field(strict=True, max_length=ADDRESS_MAX)] | None = None
    company_name: Annotated[str, Field(strict=True, max_length=COMPANY_NAME_MAX)] | None = None


class CompanyInfoResponse(_ApiModel):
    company_name: str
    address: str | None


def _field_error(path: str, message: str) -> InputError:
    return InputError(message, fields=[FieldError(path=path, message=message)])


def _checked(value: str | None, *, path: str, label: str, limit: int) -> str | None:
    """보내지 않은 칸은 None, 보냈는데 비었으면 거부(성공처럼 넘기지 않는다)."""
    if value is None:
        return None
    text = _clean(value, label=label, limit=limit)
    if text is None:
        raise _field_error(path, f"{label}을(를) 입력해 주세요.")
    return text


def _add_merge_candidates(session, customer: Customer, *, name_changed: bool, staff: str) -> None:
    """바뀐 이름·주소가 같은 묶음의 다른 회사와 같으면 겹침 후보를 만든다(#948과 같은 문장)."""
    conditions = []
    if name_changed:
        conditions.append(Customer.normalized_name == customer.normalized_name)
    if customer.normalized_address:
        conditions.append(Customer.normalized_address == customer.normalized_address)
    if not conditions:
        return
    others = session.scalars(
        select(Customer)
        .where(
            Customer.is_virtual == customer.is_virtual,
            Customer.customer_id != customer.customer_id,
            or_(*conditions),
        )
        .order_by(Customer.customer_id)
    )
    for other in others:
        pair = {other.customer_id, customer.customer_id}
        exists = session.scalar(
            select(MergeCandidate.merge_candidate_id).where(
                MergeCandidate.customer_id_a.in_(pair),
                MergeCandidate.customer_id_b.in_(pair),
            )
        )
        if exists:
            continue
        session.add(
            MergeCandidate(
                merge_candidate_id=new_id("merge"),
                customer_id_a=other.customer_id,
                customer_id_b=customer.customer_id,
                match_basis=(
                    SAME_NAME_BASIS
                    if other.normalized_name == customer.normalized_name
                    else SAME_ADDRESS_BASIS
                ),
                status="PENDING",
                created_by=staff,
                dataset_kind=customer.dataset_kind,
                is_virtual=customer.is_virtual,
            )
        )


@router.post("/opportunities/{oppId}/company-info", response_model=Envelope[CompanyInfoResponse])
def save_company_info(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: CompanyInfoRequest,
    session: SessionDep,
    staff: StaffDep,
):
    if body.address is None and body.company_name is None:
        raise _field_error("address", "고칠 주소나 회사 이름을 입력해 주세요.")
    address = _checked(body.address, path="address", label="주소", limit=ADDRESS_MAX)
    name = _checked(
        body.company_name, path="companyName", label="회사 이름", limit=COMPANY_NAME_MAX
    )
    if name is not None and not normalize_name(name):
        raise _field_error("companyName", "회사 이름을 입력해 주세요.")
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id) if opportunity else None
    if opportunity is None or customer is None:
        raise NotFoundError("고칠 회사가 없습니다.")
    if (
        name is not None
        and name != customer.name
        and customer.discovery_source != STAFF_ADDED_SOURCE
    ):
        raise _field_error("companyName", "직접 넣은 회사만 이름을 고칠 수 있습니다.")
    now = utcnow()
    lines = []
    name_changed = name is not None and name != customer.name
    if name_changed:
        lines.append(f"회사 이름 변경 · {customer.name} → {name}")
        customer.name, customer.normalized_name = name, normalize_name(name)
    address_changed = address is not None and address != customer.address
    if address_changed:
        lines.append(
            f"주소 변경 · {customer.address} → {address}"
            if customer.address
            else f"주소 입력 · {address}"
        )
        customer.address, customer.normalized_address = address, normalize_address(address)
        if customer.geocode_source != DEMO_SOURCE:
            # 옛 주소의 좌표는 쓰지 않는다. 다음 상세 읽기 때 기존 규칙(#222·#686)대로 다시 찾는다.
            customer.lat = customer.lng = customer.geocoded_at = customer.geocode_source = None
    if lines:
        _add_merge_candidates(session, customer, name_changed=name_changed, staff=staff)
        add_program_note(session, opportunity, " / ".join(lines), staff=staff, now=now)
    session.flush()
    return Envelope[CompanyInfoResponse](
        data=CompanyInfoResponse(company_name=customer.name, address=customer.address),
        meta=Meta(
            updated_at=now,
            reevaluated=False,
            dataset_kind=customer.dataset_kind,
            has_virtual_data=customer.is_virtual,
        ),
    )
