"""C1 홈페이지 확인·조사 연결. 인증 세션을 닫은 뒤 기존 흐름을 한 번만 실행한다."""

from contextlib import contextmanager
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Path, Request
from pydantic import Field, model_validator
from sqlalchemy import select

from geosan.api.deps import get_session, require_staff
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import AppError, NotFoundError, RunFailedError
from geosan.evidence.reader import MAX_BYTES, validate_url
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note
from geosan.storage.base import new_id, utcnow
from geosan.workflows import flow_extract

router = APIRouter()


class HomepageRequest(_RequestModel):
    url: str | None = Field(default=None, strict=True, json_schema_extra={"format": "uri"})
    pasted_text: str | None = Field(default=None, strict=True)
    confirm_only: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def check_combination(self):
        if self.confirm_only and self.pasted_text is not None:
            raise ValueError("주소 확인과 본문 붙여넣기는 함께 사용할 수 없습니다.")
        if self.pasted_text is not None and (
            not self.pasted_text.strip() or len(self.pasted_text.encode("utf-8")) > MAX_BYTES
        ):
            raise ValueError("공개 본문의 길이를 확인해 주세요.")
        return self


class HomepageConfirmation(_ApiModel):
    homepage_url: str
    homepage_status: Literal["CONFIRMED"]
    homepage_source: Literal["STAFF"]


class HomepageResearch(_ApiModel):
    evidence_count: int = Field(strict=True, ge=0)
    requirement_candidate_count: int = Field(strict=True, ge=0)
    question_count: int = Field(strict=True, ge=0)
    eval_id: str


@router.post(
    "/opportunities/{oppId}/homepage",
    response_model=Envelope[HomepageResearch] | Envelope[HomepageConfirmation],
)
def save_homepage(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: HomepageRequest,
    request: Request,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    # 같은 접속·담당자 검사를 재사용하되, 함수 범위 의존성으로 세션을 조사 동안 붙들지 않는다.
    with contextmanager(get_session)(request) as session:
        staff = require_staff(session, staff_key)
        connection = session.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id) if opportunity else None
        if customer is None:
            raise NotFoundError("홈페이지를 확인할 회사가 없습니다.")
        url = validate_url(body.url if body.url is not None else customer.homepage_url or "")
        if body.confirm_only:
            if not customer.homepage_url or validate_url(customer.homepage_url) != url:
                raise AppError(
                    "확인할 홈페이지 주소가 바뀌었습니다.",
                    "상세 화면을 다시 불러온 뒤 확인해 주세요.",
                    status=409,
                    kind="STALE_VALUE",
                )
            customer.homepage_status = "CONFIRMED"
            customer.homepage_source = "STAFF"
            data = HomepageConfirmation(
                homepage_url=customer.homepage_url,
                homepage_status="CONFIRMED",
                homepage_source="STAFF",
            )
        else:
            # 조사 가능 여부의 최종 거부·전송 기록은 기존 흐름이 맡는다.
            # 거부될 자료에는 그 전에 홈페이지 변경도 저장하지 않는다.
            if (
                customer.security_grade == "PUBLIC"
                and opportunity.purpose == "NEW_PROPOSAL"
                and body.url is not None
                and (not customer.homepage_url or validate_url(customer.homepage_url) != url)
            ):
                previous_url = customer.homepage_url
                previous_note = session.scalar(
                    select(Note).where(Note.opp_id == opp_id).order_by(Note.version.desc())
                )
                now = utcnow()
                customer.homepage_url = url
                customer.homepage_status = "CONFIRMED"
                customer.homepage_source = "STAFF"
                customer.homepage_confidence = None
                customer.homepage_reason = None
                customer.homepage_fetched_at = now
                # PM #304: 주소와 이전 주소 기록을 함께 확정한 뒤 조사를 시작한다.
                # 조사가 실패해도 둘은 남고, 같은 주소 재시도에는 새 기록을 만들지 않는다.
                session.add(
                    Note(
                        note_id=new_id("note"),
                        opp_id=opp_id,
                        staff_key=staff,
                        text=f"홈페이지 주소 변경 · 이전 {previous_url or '없음'} · 새 {url}",
                        kind="RESEARCH",
                        version=previous_note.version + 1 if previous_note else 1,
                        created_at=now,
                        created_by=staff,
                        dataset_kind=opportunity.dataset_kind,
                        is_virtual=opportunity.is_virtual,
                    )
                )
        session.flush()

    if body.confirm_only:
        return Envelope[HomepageConfirmation](
            data=data, meta=Meta(reevaluated=False, updated_at=utcnow())
        )

    result = flow_extract.run_extract(
        opp_id, url=url, pasted_text=body.pasted_text, requested_by=staff
    )
    if not result.ok:
        raise result.error or RunFailedError("조사 결과를 저장하지 못했습니다.")
    if (
        result.affected_opp_ids != [opp_id]
        or len(result.new_eval_ids) != 1
        or result.counts is None
    ):
        raise RunFailedError("조사 결과의 저장 건수와 평가 번호를 확인해 주세요.")
    if set(result.counts) != {"evidenceCount", "requirementCandidateCount", "questionCount"}:
        raise RunFailedError("조사 결과의 저장 건수를 확인해 주세요.")
    data = HomepageResearch(**result.counts, eval_id=result.new_eval_ids[0])
    if data.requirement_candidate_count > data.evidence_count:
        raise RunFailedError("조사 결과의 요구 후보 건수를 확인해 주세요.")
    return Envelope[HomepageResearch](data=data, meta=Meta(reevaluated=True, updated_at=utcnow()))
