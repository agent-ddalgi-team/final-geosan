"""비슷한 회사 참고 경로 (U5, 계약 C1 `GET /opportunities/{oppId}/peers`, #268).

읽기 전용이다: 저장·외부 호출이 없고 보기 전용 계정도 본다. 응답에 메모 글이 들어가므로 영업
메모와 같은 취급이다(계약 C4: 접속 보호 뒤 화면 전용, 엑셀·질문 목록·외부 AI로 내보내지 않음).
요약에는 건수만 싣는다.
"""

from datetime import datetime, time
from typing import Annotated

from fastapi import APIRouter, Path

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.errors import NotFoundError
from geosan.config.sales_questions import KST
from geosan.dashboard.peers import ContactLine, build_peers, load_peer_candidates, process_codes_of
from geosan.opportunity.models import Customer, Opportunity
from geosan.rules.codes import ContactMethod, LostReasonCode, OutcomeStatus
from geosan.storage.base import utcnow

router = APIRouter()


class PeerReach(_ApiModel):
    reached: int
    tried: int


class PeerLostReason(_ApiModel):
    code: LostReasonCode
    count: int


class PeersSummary(_ApiModel):
    process_count: int
    industry_count: int
    stage_counts: dict[OutcomeStatus, int]
    top_lost_reasons: list[PeerLostReason]
    contact_reach: dict[ContactMethod, PeerReach]


class PeerNote(_ApiModel):
    text: str
    by: str
    at: datetime


class PeerCompany(_ApiModel):
    opp_id: str
    name: str
    process_codes: list[str]
    industries: list[str]
    outcome_status: OutcomeStatus | None
    lost_reason_code: LostReasonCode | None
    last_contact_at: datetime | None
    last_contact_method: ContactMethod | None
    last_note: PeerNote | None
    same_process: bool
    same_industry: bool


class Peers(_ApiModel):
    summary: PeersSummary
    companies: list[PeerCompany]


PeersEnvelope = Envelope[Peers]


def _contact_at(contact: ContactLine | None) -> datetime | None:
    """마지막 접촉 시각. 담당자가 적은 접촉 날짜(한국 날짜)가 있으면 그 날 0시로 보인다."""
    if contact is None:
        return None
    if contact.attempted_at is None:
        return contact.created_at
    return datetime.combine(contact.attempted_at, time.min, tzinfo=KST)


@router.get("/opportunities/{oppId}/peers", response_model=PeersEnvelope)
def peers(opp_id: Annotated[str, Path(alias="oppId")], session: SessionDep):
    """같은 공정·산업군의 다른 회사 최대 5곳과 건수 요약. 저장하지 않고 읽을 때 계산한다."""
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id) if opportunity else None
    if opportunity is None or customer is None:
        raise NotFoundError("비슷한 회사를 찾을 기회가 없습니다.")
    dataset_kind = runtime_for(session).app_settings.active_dataset_kind
    result = build_peers(
        sorted(process_codes_of(session, [opp_id]).get(opp_id, set())),
        customer.industries or [],
        load_peer_candidates(session, opportunity, dataset_kind=dataset_kind.value),
        lost_reason_order=[code.value for code in LostReasonCode],
    )
    summary = result.summary
    data = Peers(
        summary=PeersSummary(
            process_count=summary.process_count,
            industry_count=summary.industry_count,
            stage_counts=summary.stage_counts,
            top_lost_reasons=[
                PeerLostReason(code=code, count=count) for code, count in summary.top_lost_reasons
            ],
            contact_reach={
                method: PeerReach(reached=reached, tried=tried)
                for method, (reached, tried) in summary.contact_reach.items()
            },
        ),
        companies=[
            PeerCompany(
                opp_id=row.opp_id,
                name=row.name,
                process_codes=list(row.process_codes),
                industries=list(row.industries),
                outcome_status=row.outcome_status,
                lost_reason_code=row.lost_reason_code,
                last_contact_at=_contact_at(row.last_contact),
                last_contact_method=row.last_contact.method if row.last_contact else None,
                last_note=PeerNote(
                    text=row.last_note.text, by=row.last_note.by, at=row.last_note.at
                )
                if row.last_note
                else None,
                same_process=row.same_process,
                same_industry=row.same_industry,
            )
            for row in result.companies
        ],
    )
    return PeersEnvelope(
        data=data,
        meta=Meta(
            updated_at=utcnow(),
            dataset_kind=opportunity.dataset_kind,
            has_virtual_data=opportunity.is_virtual,
        ),
    )
