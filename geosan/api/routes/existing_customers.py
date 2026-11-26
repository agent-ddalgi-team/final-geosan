"""#932 신규 거래처 찾기의 "기존 고객과 닮은 조건" 줄(C1 `GET /existing-customers/suggestions`).

확장 기능(설정 existingCustomers.enabled, 기본 꺼짐). 프로그램이 기존 고객 수를 셀 뿐 AI·외부 전송은
없다. 화면의 [적용]은 찾기 조건 칸만 채우고 찾기는 담당자가 누를 때만 한다. 점수·순위는 그대로다.
꺼져 있으면 값을 하나도 돌려주지 않는다(enabled false, 빈 목록).
"""

from fastapi import APIRouter
from pydantic import Field

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.routes.records import choice_catalog
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.opportunity.existing_customers import overview, region_matches

router = APIRouter()

# 종류마다 보일 조건 수(많은 순). 화면 한 줄에 들어가는 만큼이다.
SUGGEST_LIMIT = 5


class SuggestedProcess(_ApiModel):
    code: str = Field(description="공정 코드(찾기 조건 processCodes 값)")
    label: str
    count: int = Field(ge=1, description="이 공정을 맡기는 기존 고객 수")


class SuggestedValue(_ApiModel):
    name: str = Field(description="찾기 조건 값(industries·regions)")
    count: int = Field(ge=1)


class CustomerSuggestions(_ApiModel):
    enabled: bool = Field(description="existingCustomers.enabled. false면 아래는 모두 비어 있다")
    total: int = Field(ge=0, description="넣어 둔 기존 고객 수")
    processes: list[SuggestedProcess]
    industries: list[SuggestedValue]
    regions: list[SuggestedValue] = Field(
        description="기존 고객 지역 글에 든 찾기 지역(설정 ingestion.regions) 값"
    )


@router.get("/existing-customers/suggestions", response_model=Envelope[CustomerSuggestions])
def customer_suggestions(session: SessionDep):
    settings = runtime_for(session).app_settings
    meta = Meta(dataset_kind=settings.active_dataset_kind.value)
    if not settings.existing_customers.enabled:
        data = CustomerSuggestions(enabled=False, total=0, processes=[], industries=[], regions=[])
        return Envelope[CustomerSuggestions](data=data, meta=meta)
    view = overview(session)
    catalog = choice_catalog(session)["PROCESS"]
    processes = [
        SuggestedProcess(code=code, label=catalog[code], count=count)
        for code, count in view.processes
        if code in catalog
    ][:SUGGEST_LIMIT]
    industries = [
        SuggestedValue(name=name, count=count)
        for name, count in view.industries
        if name in settings.industries
    ][:SUGGEST_LIMIT]
    region_counts: dict[str, int] = {}
    for region, count in view.regions:
        for value in region_matches(region, settings.ingestion.regions):
            region_counts[value] = region_counts.get(value, 0) + count
    regions = [
        SuggestedValue(name=name, count=count)
        for name, count in sorted(region_counts.items(), key=lambda item: (-item[1], item[0]))
    ][:SUGGEST_LIMIT]
    data = CustomerSuggestions(
        enabled=True,
        total=view.total,
        processes=processes,
        industries=industries,
        regions=regions,
    )
    meta = Meta(dataset_kind=meta.dataset_kind, has_virtual_data=view.has_virtual)
    return Envelope[CustomerSuggestions](data=data, meta=meta)
