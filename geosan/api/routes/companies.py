"""#948 이름으로 회사 넣기 창구(PM 결정 2026-11-26, 계약 C1 `/companies/lookup`·`/companies`).

[거래처 후보 › 새 후보 발굴 패널 › 맨 위 "이름으로 회사 넣기"]가 부른다. 찾기는 외부 호출이
없다. 넣기는 AI 후보 고르기 없이 회사 1곳을 넣고, 같은 저장 안에서 평가하고 관심을 켠다.
조사는 응답 뒤 관심 자동 조사와 같은 스위치·하루 금액으로 돈다.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from geosan.api.auto_research import attach_background, no_auto_research, queue_on_bookmark
from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.routes.records import (
    _add_bookmark,
    _is_excluded,
    _reevaluate_one,
    latest_bookmark,
)
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.errors import AppError
from geosan.opportunity.models import Opportunity
from geosan.opportunity.staff_add import add_company, lookup
from geosan.storage.base import utcnow

router = APIRouter(dependencies=[Depends(attach_background)])


class ExistingCompany(_ApiModel):
    opp_id: str
    company_name: str
    address: str | None
    bookmarked: bool


class FactoryCompany(_ApiModel):
    row_id: str
    company_name: str
    address: str
    region: str
    product: str | None
    industry_name: str | None
    opp_id: str | None = Field(description="이름·주소가 같은 회사가 이미 목록에 있으면 그 기회 ID")


class CompanyLookup(_ApiModel):
    existing: list[ExistingCompany]
    factories: list[FactoryCompany]
    truncated: bool


class CompanyAddRequest(_ApiModel):
    row_id: str | None = Field(default=None, max_length=80)
    company_name: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    homepage_url: str | None = Field(default=None, max_length=500)


class CompanyAdded(_ApiModel):
    opp_id: str
    created: bool
    research_queued: bool


def _bookmarked(session, opp_id: str) -> bool:
    row = latest_bookmark(session, opp_id)
    return row is not None and row.active


@router.get("/companies/lookup", response_model=Envelope[CompanyLookup])
def lookup_companies(session: SessionDep, name: Annotated[str, Query()] = ""):
    """이미 목록에 있는 회사와 공장 자료를 이름으로 찾는다. 저장·외부 호출 없음."""
    dataset_kind = runtime_for(session).app_settings.active_dataset_kind.value
    found = lookup(session, name, dataset_kind=dataset_kind)
    data = CompanyLookup(
        existing=[
            ExistingCompany(
                opp_id=item.opp_id,
                company_name=item.company_name,
                address=item.address,
                bookmarked=_bookmarked(session, item.opp_id),
            )
            for item in found.existing
        ],
        factories=[FactoryCompany(**vars(item)) for item in found.factories],
        truncated=found.truncated,
    )
    meta = Meta(dataset_kind=dataset_kind, has_virtual_data=dataset_kind == "VIRTUAL_REVIEWED")
    return Envelope[CompanyLookup](data=data, meta=meta)


@router.post("/companies", response_model=Envelope[CompanyAdded])
def add_company_by_name(body: CompanyAddRequest, session: SessionDep, staff: StaffDep):
    """회사 1곳을 넣고(이미 있으면 그 회사) 관심을 켠다. 실패하면 전부 되돌린다."""
    settings = runtime_for(session).app_settings
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    result = add_company(
        session,
        staff=staff,
        dataset_kind=settings.active_dataset_kind.value,
        row_id=body.row_id,
        company_name=body.company_name,
        address=body.address,
        homepage_url=body.homepage_url,
        surface_codes=settings.ingestion.ai_pick.surface_treatment_industry_codes,
    )
    opportunity: Opportunity = result.opportunity
    opp_id = opportunity.opp_id
    if result.created:
        _reevaluate_one(session, opp_id, staff, "넣은 회사를 평가하지 못해 저장을 취소했습니다.")
    elif _is_excluded(session, opp_id):
        raise AppError(
            message="제외로 저장한 회사입니다",
            next_action=(
                "관심 기업에 다시 담으려면 검토 의견을 영업 대상이나 검토 중으로 바꿔 주세요"
            ),
            status=422,
            kind="BOOKMARK_EXCLUDED",
        )
    previous = latest_bookmark(session, opp_id)
    if previous is None or not previous.active:
        # 조사 예약은 아래에서 한 번만 한다(새 회사는 홈페이지 찾기부터).
        with no_auto_research():
            _add_bookmark(
                session, opportunity, staff, active=True, source="MANUAL", previous=previous
            )
    queued = queue_on_bookmark(session, opportunity, find_homepage=result.created)
    session.flush()
    data = CompanyAdded(opp_id=opp_id, created=result.created, research_queued=queued)
    meta = Meta(
        updated_at=utcnow(),
        has_virtual_data=opportunity.is_virtual,
        dataset_kind=opportunity.dataset_kind,
        reevaluated=result.created,
    )
    return Envelope[CompanyAdded](data=data, meta=meta)
