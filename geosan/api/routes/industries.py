"""#646 상세 산업군 칩의 [확정]·[고치기] 저장 창구(C1 `POST /opportunities/{oppId}/industries`).

저장은 꼬리 질문의 산업 확정(#652 `sales_confirm.confirm_industries`)과 같은 함수·같은 칸을 쓴다.
산업군은 점수·분류 입력이 아니라 다시 평가하지 않는다. 바뀐 것이 있으면 활동 이력에 한 줄을 남긴다.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Path
from pydantic import Field
from sqlalchemy import func, select

from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.sales_confirm import MAX_INDUSTRIES, confirm_industries
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import FieldError, InputError, NotFoundError
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note
from geosan.storage.base import new_id, utcnow

router = APIRouter()

CONFIRMED_SUMMARY = "상세에서 산업 확정 · "
CLEARED_SUMMARY = "상세에서 산업 미확정으로 되돌림"


class IndustriesRequest(_RequestModel):
    industries: list[Annotated[str, Field(strict=True)]] = Field(
        description="설정 industries 안 값, 최대 3개. 빈 배열이면 미확정으로 되돌린다"
    )


class IndustriesResponse(_ApiModel):
    industries: list[str]
    industries_source: Literal["STAFF"] | None = Field(
        description="STAFF = 담당자 확정. 빈 배열로 되돌렸으면 null"
    )
    industries_confirmed_at: datetime | None


def _check(industries: list[str], allowed: list[str]) -> None:
    """목록 밖 값·같은 값 두 번·개수 초과를 거부한다(성공처럼 넘기지 않는다)."""
    if len(industries) > MAX_INDUSTRIES:
        message = f"산업군은 {MAX_INDUSTRIES}개까지 고를 수 있습니다."
        raise InputError(message, fields=[FieldError(path="industries", message=message)])
    unknown = [
        FieldError(path=f"industries[{index}]", message="설정의 산업군 목록에 없는 값입니다.")
        for index, name in enumerate(industries)
        if name not in allowed
    ]
    if unknown:
        raise InputError("산업군 목록에 없는 값입니다. 화면을 새로 고쳐 주세요.", fields=unknown)
    repeated = [
        FieldError(path=f"industries[{index}]", message="이미 고른 산업군입니다.")
        for index, name in enumerate(industries)
        if name in industries[:index]
    ]
    if repeated:
        raise InputError("같은 산업군을 두 번 골랐습니다.", fields=repeated)


def _clear(customer: Customer) -> str | None:
    """확인된 값이 없는 상태로 되돌린다. 이미 그 상태면 바꾸지 않는다."""
    if not customer.industries and customer.industries_source is None:
        return None
    customer.industries = []
    customer.industries_source = None
    customer.industries_confirmed_at = None
    return CLEARED_SUMMARY


@router.post("/opportunities/{oppId}/industries", response_model=Envelope[IndustriesResponse])
def save_industries(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: IndustriesRequest,
    session: SessionDep,
    staff: StaffDep,
):
    allowed = runtime_for(session).app_settings.industries
    _check(body.industries, allowed)
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id) if opportunity else None
    if customer is None:
        raise NotFoundError("산업군을 확정할 회사가 없습니다.")
    now = utcnow()
    # 저장·이력 문장은 고른 순서가 아니라 설정 순서로 맞춘다(꼬리 질문 확정과 같음).
    values = [name for name in allowed if name in body.industries]
    if values:
        changed = confirm_industries(session, opportunity, values, now=now).summary is not None
        summary = CONFIRMED_SUMMARY + ", ".join(values) if changed else None
    else:
        summary = _clear(customer)
    if summary:
        version = session.scalar(select(func.max(Note.version)).where(Note.opp_id == opp_id)) or 0
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opp_id,
                staff_key=staff,
                kind="MEMO",
                text=summary,
                version=version + 1,
                created_at=now,
                created_by=staff,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
            )
        )
    session.flush()
    return Envelope[IndustriesResponse](
        data=IndustriesResponse(
            industries=list(customer.industries or []),
            industries_source=customer.industries_source,
            industries_confirmed_at=customer.industries_confirmed_at,
        ),
        meta=Meta(
            updated_at=now,
            reevaluated=False,
            dataset_kind=customer.dataset_kind,
            has_virtual_data=customer.is_virtual,
        ),
    )
