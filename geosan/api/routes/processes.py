"""#847 상세 "한눈에 › 공정" [고치기] 저장 창구(C1 `POST /opportunities/{oppId}/processes`).

#958(PM 결정 2026-11-26): 같은 칸의 "소재" [고치기]
(C1 `POST /opportunities/{oppId}/material`)도 여기에 둔다.

PM 결정(2026-11-17): 거산 쪽 확인 질문을 통화에서 묻는 대신, 나중에 확인해 다르면
왼쪽 공정 줄에서 고친다. 저장은 꼬리 질문의 공정 확정(#652·#720
`sales_confirm.confirm_processes`)과 같은 함수·같은 표를 쓴다:
고른 목록이 그 회사의 확정 공정 전체이고, 안 고른 확정 공정·AI 제안은 이력으로만 남긴다.
공정은 점수 입력이라 연결이 바뀌면 같은 트랜잭션에서 다시 평가하고, 실패하면 저장까지 전부 취소한다.
"""

from typing import Annotated

from fastapi import APIRouter, Path
from pydantic import Field
from sqlalchemy import select

from geosan.api.deps import SessionDep, StaffDep
from geosan.api.routes.records import _reevaluate_one, choice_catalog
from geosan.api.sales_confirm import confirm_material, confirm_processes, confirmed_links
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import FieldError, InputError, NotFoundError
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.program_note import add_program_note
from geosan.storage.base import utcnow

router = APIRouter()

FIRST_PREFIX = "상세에서 공정 확정 · "


class ProcessesRequest(_RequestModel):
    process_codes: list[Annotated[str, Field(strict=True)]] = Field(
        description="거산 공정 목록 안 공정 코드, 1개 이상. 이 목록이 그 회사의 확정 공정 전체"
    )


class ProcessesResponse(_ApiModel):
    process_codes: list[str] = Field(description="저장 뒤 확정 공정(거산 공정 목록 순서)")


def _check(codes: list[str], allowed: dict[str, str]) -> None:
    """빈 목록·목록 밖 코드·같은 코드 두 번을 거부한다(성공처럼 넘기지 않는다)."""
    if not codes:
        message = "공정을 하나 이상 골라 주세요."
        raise InputError(message, fields=[FieldError(path="processCodes", message=message)])
    unknown = [
        FieldError(path=f"processCodes[{index}]", message="거산 공정 목록에 없는 값입니다.")
        for index, code in enumerate(codes)
        if code not in allowed
    ]
    if unknown:
        raise InputError("공정 목록에 없는 값입니다. 화면을 새로 고쳐 주세요.", fields=unknown)
    repeated = [
        FieldError(path=f"processCodes[{index}]", message="이미 고른 공정입니다.")
        for index, code in enumerate(codes)
        if code in codes[:index]
    ]
    if repeated:
        raise InputError("같은 공정을 두 번 골랐습니다.", fields=repeated)


def _confirmed(session, opp_id: str, order: dict[str, str]) -> list[str]:
    """살아 있는 확정 공정 코드(거산 공정 목록 순서, 목록 밖 코드는 뒤에)."""
    codes = set(
        session.scalars(
            select(OppProcessLink.process_code).where(
                OppProcessLink.opp_id == opp_id,
                OppProcessLink.superseded_at.is_(None),
                OppProcessLink.state == "CONFIRMED",
            )
        )
    )
    ordered = [code for code in order if code in codes]
    return ordered + sorted(codes - set(ordered))


@router.post("/opportunities/{oppId}/processes", response_model=Envelope[ProcessesResponse])
def save_processes(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: ProcessesRequest,
    session: SessionDep,
    staff: StaffDep,
):
    names = choice_catalog(session).get("PROCESS", {})
    _check(body.process_codes, names)
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id) if opportunity else None
    if opportunity is None or customer is None:
        raise NotFoundError("공정을 고칠 회사가 없습니다.")
    now = utcnow()
    # 저장·이력 문장은 고른 순서가 아니라 거산 공정 목록 순서로 맞춘다(꼬리 질문 확정과 같음).
    codes = [code for code in names if code in body.process_codes]
    result = confirm_processes(
        session, opportunity, codes, names, staff=staff, now=now, first_prefix=FIRST_PREFIX
    )
    session.flush()
    if result.links_changed:
        _reevaluate_one(
            session,
            opp_id,
            staff,
            "공정을 다시 평가하지 못해 저장을 취소했습니다. 다시 시도해 주세요.",
        )
    if result.summary:
        add_program_note(session, opportunity, result.summary, staff=staff, now=now)
    session.flush()
    return Envelope[ProcessesResponse](
        data=ProcessesResponse(process_codes=_confirmed(session, opp_id, names)),
        meta=Meta(
            updated_at=now,
            reevaluated=result.links_changed,
            dataset_kind=customer.dataset_kind,
            has_virtual_data=customer.is_virtual,
        ),
    )


MATERIAL_FIRST_PREFIX = "상세에서 소재 확정 · "


class MaterialRequest(_RequestModel):
    material: Annotated[str, Field(strict=True, max_length=40)] = Field(
        description="GET /config materialOptions 안 코드"
    )


class MaterialResponse(_ApiModel):
    material: str = Field(description="저장한 소재 코드")
    process_codes: list[str] = Field(description="소재를 적용한 확정 공정(거산 공정 목록 순서)")


@router.post("/opportunities/{oppId}/material", response_model=Envelope[MaterialResponse])
def save_material(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: MaterialRequest,
    session: SessionDep,
    staff: StaffDep,
):
    """#958(PM 결정 2026-11-26) 상세 "한눈에 › 소재" [고치기].

    소재는 회사당 하나이고 확정 공정 모두에 적용한다.
    """
    catalog = choice_catalog(session)
    materials = catalog.get("MATERIAL", {})
    if body.material not in materials:
        message = "거산 처리 소재 목록에 없는 값입니다. 화면을 새로 고쳐 주세요."
        raise InputError(message, fields=[FieldError(path="material", message=message)])
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id) if opportunity else None
    if opportunity is None or customer is None:
        raise NotFoundError("소재를 고칠 회사가 없습니다.")
    names = catalog.get("PROCESS", {})
    if not confirmed_links(session, opp_id):
        message = "공정을 먼저 골라 주세요."
        raise InputError(message, fields=[FieldError(path="material", message=message)])
    now = utcnow()
    result = confirm_material(
        session,
        opportunity,
        body.material,
        materials,
        staff=staff,
        now=now,
        first_prefix=MATERIAL_FIRST_PREFIX,
    )
    session.flush()
    if result.links_changed:
        _reevaluate_one(
            session,
            opp_id,
            staff,
            "소재를 다시 평가하지 못해 저장을 취소했습니다. 다시 시도해 주세요.",
        )
    if result.summary:
        add_program_note(session, opportunity, result.summary, staff=staff, now=now)
    session.flush()
    return Envelope[MaterialResponse](
        data=MaterialResponse(
            material=body.material, process_codes=_confirmed(session, opp_id, names)
        ),
        meta=Meta(
            updated_at=now,
            reevaluated=result.links_changed,
            dataset_kind=customer.dataset_kind,
            has_virtual_data=customer.is_virtual,
        ),
    )
