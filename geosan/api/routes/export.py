"""엑셀 내려받기 창구(C1 `GET /export/xlsx`, #217).

목록 조회를 그대로 불러 화면과 같은 회사를 담는다.

순서: 목록 조회(걸러 보기 조건 그대로) → 등급 검사(C4 OUTPUT_EXPORT, 거부면 전체 중단) →
엑셀 생성(모든 칸에 scrub_contacts). 영업 메모·대표번호·질문 답·활동 이력은 읽지도 않는다.
다음 일정은 날짜만 싣는다(일정 내용은 자유 글이라 사람 이름이 섞일 수 있어 싣지 않는다).
"""

from datetime import timedelta, timezone
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Query, Request, Response

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.routes.opportunities import OpinionFilter, list_opportunities
from geosan.api.routes.records import latest_outcome
from geosan.api.schemas import OutcomeStatus
from geosan.config.errors import AppError, RunFailedError
from geosan.dashboard.queries import STAGE_LABELS
from geosan.evidence.contacts import scrub_contacts
from geosan.evidence.export_guard import ExportItem, check_output_export
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.xlsx_export import MAX_ROWS, XLSX_MEDIA_TYPE, ExportRow, build_xlsx
from geosan.rules.codes import ProcessCode, SecurityGrade
from geosan.storage.base import utcnow

router = APIRouter()
KST = timezone(timedelta(hours=9))
FILE_NAME = "거산_추천목록_{day}.xlsx"
ASCII_FILE_NAME = "geosan-list-{day}.xlsx"
SCORE_NONE_TEXT = "점수 전"
SCORE_PENDING_SUFFIX = " (확인 전)"


class ExportRejectedError(AppError):
    """C1·C4: 등급 검사에서 걸린 항목이 있으면 파일을 만들지 않고 422로 알린다."""

    def __init__(self, rejected_items: list[dict[str, str]]) -> None:
        super().__init__(
            message="내보낼 수 없는 항목이 있어 엑셀 파일을 만들지 않았습니다.",
            next_action="아래 번호와 함께 운영자에게 알려 주세요.",
            status=422,
            kind="EXPORT_REJECTED",
        )
        self.rejected_items = rejected_items

    def to_error_body(self) -> dict[str, Any]:
        body = super().to_error_body()
        body["error"]["rejectedItems"] = self.rejected_items
        return body


class ExportDisabledError(AppError):
    """C1·C7: 설정 `export.xlsxEnabled`가 꺼져 있으면 목록을 읽기도 전에 422로 알린다."""

    def __init__(self) -> None:
        super().__init__(
            message="엑셀 내려받기가 꺼져 있습니다.",
            next_action="필요하면 운영자에게 엑셀 내려받기를 켜 달라고 알려 주세요.",
            status=422,
            kind="EXPORT_DISABLED",
        )


def _score_text(card) -> str:
    """카드와 같은 말: 점수가 없으면 "점수 전", 확인 전 점수는 뒤에 표시를 붙인다."""
    if card.score_state == "NONE":
        return SCORE_NONE_TEXT
    if card.score_state == "PENDING":
        return f"{card.score_display}{SCORE_PENDING_SUFFIX}"
    return card.score_display


@router.get(
    "/export/xlsx",
    response_class=Response,
    responses={
        200: {
            "description": XLSX_MEDIA_TYPE,
            "content": {XLSX_MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}},
        },
        422: {"description": "kind EXPORT_REJECTED, rejectedItems[]"},
    },
)
def export_xlsx(
    request: Request,
    session: SessionDep,
    tab: str = "new",
    stage: OutcomeStatus | None = None,
    bookmarked: bool | None = None,
    opinion: OpinionFilter | None = None,
    process: ProcessCode | None = None,
    industry: str | None = None,
    region: str | None = None,
    q: str | None = None,
    ingest_batch: Annotated[str | None, Query(alias="batch")] = None,
    sort: str = "rank",
):
    """목록 조회와 같은 조건을 받아 쪽 나눔 없이 전부 담는다.

    대시보드 칸 조건(`filter`)은 목록 조회가 주소에서 직접 읽는다.
    설정 `export.xlsxEnabled`가 꺼져 있으면 아무것도 읽지 않고 422 kind EXPORT_DISABLED로
    거부한다(빈 파일을 성공처럼 주지 않는다).
    """
    if not runtime_for(session).app_settings.export.xlsx_enabled:
        raise ExportDisabledError()
    envelope = list_opportunities(
        request,
        session,
        tab=tab,
        page=1,
        page_size=MAX_ROWS,
        stage=stage,
        bookmarked=bookmarked,
        opinion=opinion,
        process=process,
        industry=industry,
        region=region,
        q=q,
        ingest_batch=ingest_batch,
        sort=sort,
    )
    process_names = {
        row.process_code: row.process_name for row in envelope.meta.process_counts or []
    }
    items: list[ExportItem] = []
    rows: list[ExportRow] = []
    for card in envelope.data:
        opportunity = session.get(Opportunity, card.opp_id)
        customer = session.get(Customer, opportunity.customer_id) if opportunity else None
        if customer is None:
            raise RunFailedError("목록의 기회·고객 연결을 확인해 주세요.")
        # 회사·공정·점수 칸은 회사 행의 보안 등급을 따른다(exportColumnKinds.xlsx).
        items.append(ExportItem(card.opp_id, "OPPORTUNITY_INFO", customer.security_grade))
        outcome = latest_outcome(session, card.opp_id)
        if outcome is not None:
            # 단계·다음 일정은 거산 담당자가 남긴 내부 기록이다.
            items.append(
                ExportItem(
                    outcome.outcome_id, "INTERNAL_HISTORY", SecurityGrade.INTERNAL_ONLY.value
                )
            )
        rows.append(
            ExportRow(
                company=card.title,
                process=", ".join(process_names.get(code, code) for code in card.process_codes),
                score=_score_text(card),
                stage=STAGE_LABELS[outcome.status if outcome is not None else "NOT_EXECUTED"],
                next_schedule=outcome.next_schedule_at if outcome is not None else None,
                is_virtual=card.is_virtual,
            )
        )
    decision = check_output_export(items)
    if not decision.allowed:
        raise ExportRejectedError(decision.rejected_items)
    try:
        result = build_xlsx(rows, scrub=scrub_contacts)
    except ValueError as error:
        # 파일에 담을 수 없는 글자·길이. 깨진 파일을 성공으로 내보내지 않는다.
        raise RunFailedError(
            "엑셀 파일을 만들지 못했습니다.",
            next_action="아래 번호와 함께 운영자에게 알려 주세요.",
        ) from error
    day = utcnow().astimezone(KST).strftime("%Y%m%d")
    disposition = (
        f'attachment; filename="{ASCII_FILE_NAME.format(day=day)}"; '
        f"filename*=UTF-8''{quote(FILE_NAME.format(day=day))}"
    )
    return Response(
        content=result.content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": disposition},
    )
