"""담당자가 본 평가에 의견을 새 행으로 남긴다. 시스템 평가에는 쓰지 않는다.

관심(찜) 켜고 끄기와 자동 관심도 여기에 둔다(#356).
"""

from typing import Annotated

from fastapi import APIRouter, Path, Query
from sqlalchemy import func, literal_column, select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.schemas import (
    ActivityEnvelope,
    ActivityItem,
    BookmarkEnvelope,
    BookmarkRecord,
    BookmarkRequest,
    BookmarkResponse,
    ContactCount,
    MainPhoneConfirmEnvelope,
    MainPhoneConfirmRequest,
    MainPhoneConfirmResponse,
    Meta,
    NoteEnvelope,
    NoteRequest,
    NoteResponse,
    OpinionEnvelope,
    OpinionRecord,
    OpinionRequest,
    OpinionResponse,
    OpportunityDetail,
    OutcomeEnvelope,
    OutcomeRequest,
    OutcomeResponse,
    QuestionReplyEnvelope,
    QuestionReplyRequest,
    QuestionReplyResponse,
    RelationEnvelope,
    RelationRequest,
    RelationResponse,
    ReviewCheckEnvelope,
    ReviewCheckRequest,
    ReviewCheckResponse,
    ReviewItem,
)
from geosan.config.errors import AppError, FieldError, InputError, NotFoundError, RunFailedError
from geosan.config.validators import scan_contacts
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.models import Customer, Opportunity, RelationHistory
from geosan.opportunity.queries import confirm_main_phone
from geosan.opportunity.relations import change_relation
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink
from geosan.records.models import Bookmark, Note, Outcome, ReviewCheck, ReviewOpinion
from geosan.rules.codes import ReviewItemKind, ReviewItemSource
from geosan.storage.base import new_id, utcnow
from geosan.workflows.flow_evaluate import evaluate_in_session, today_in_seoul

router = APIRouter()

LOST_REASON_LABELS = {
    "PRICE": "가격",
    "LEAD_TIME": "납기",
    "INCUMBENT_SUPPLIER": "기존 거래처 유지",
    "NO_DEMAND": "수요 없음",
    "QUALITY_CERT": "품질·인증 요건",
    "OTHER": "기타",
}


def validate_viewed_evaluation(session: Session, opp_id: str, eval_id: str | None) -> None:
    """본 평가 번호를 검사한다(C6, #450). 낡은 번호는 허용하고 없으면 비워 둔다."""
    if eval_id is None:
        return
    evaluation = session.get(EvaluationRun, eval_id)
    batch = session.get(EvaluationBatch, evaluation.batch_id) if evaluation else None
    if (
        evaluation is None
        or evaluation.opp_id != opp_id
        or evaluation.run_status not in {"CONFIRMED", "SUPERSEDED"}
        or batch is None
        or batch.status != "CONFIRMED"
    ):
        raise InputError(
            "이 기회에서 본 평가 ID를 넣어 주세요.",
            fields=[FieldError(path="evalId", message="기회와 평가 연결을 확인해 주세요.")],
        )


@router.post("/opportunities/{oppId}/relation", response_model=RelationEnvelope)
def save_relation(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: RelationRequest,
    session: SessionDep,
    staff: StaffDep,
):
    customer = change_relation(
        session, opp_id, body.relation_status, body.eval_id, staff, today_in_seoul()
    )
    result = evaluate_in_session(session, [opp_id], staff)
    if not result.ok or result.affected_opp_ids != [opp_id] or len(result.new_eval_ids) != 1:
        raise RunFailedError("거래 관계를 재평가하지 못해 저장을 취소했습니다.")
    return RelationEnvelope(
        data=RelationResponse(
            relation_status=customer.relation_status,
            relation_confirmed_at=customer.relation_confirmed_at,
            relation_confirmed_by=customer.relation_confirmed_by,
            eval_id=result.new_eval_ids[0],
        ),
        meta=Meta(
            updated_at=utcnow(),
            reevaluated=True,
            dataset_kind=customer.dataset_kind,
            has_virtual_data=customer.is_virtual,
        ),
    )


def derive_review_items(data: OpportunityDetail) -> list[ReviewItem]:
    """계약 C1의 다섯 입력에서 파생한다. 미조사를 홈페이지 검색 실패로 추정하지 않는다."""
    items: dict[str, ReviewItem] = {}

    def add(item_id, kind, source, text, target_label=None):
        items[item_id] = ReviewItem(
            item_id=item_id,
            kind=kind,
            source=source,
            text=text,
            target_label=target_label,
            checked=False,
            checked_by=None,
            checked_at=None,
        )

    for question in data.reasons.questions:
        # 현재 reasons.questions는 평가가 저장한 질문 후보다. AI 질문이라고 출처를 바꾸지 않는다.
        add(
            f"Q:{question.question_id}",
            ReviewItemKind.QUESTION,
            ReviewItemSource.RULE,
            question.text,
            "상대 회사" if question.target_kind in {"OPPORTUNITY", "REQUIREMENT"} else "거산",
        )
        item = items[f"Q:{question.question_id}"]
        item.reply_text = question.reply_text
        item.replied_at = question.replied_at
        item.replied_by = question.replied_by
    if data.header.homepage_status == "NOT_FOUND":
        add(
            "GAP:HOMEPAGE",
            ReviewItemKind.DATA_NOT_FOUND,
            ReviewItemSource.AI,
            "홈페이지를 찾지 못함",
        )
    if not data.evidence:
        add(
            "GAP:EVIDENCE",
            ReviewItemKind.DATA_NOT_FOUND,
            ReviewItemSource.RULE,
            "확인할 근거 자료가 없음",
        )
    if data.scores is not None:
        for item in data.scores.items:
            if item.state in {"NO_SIGNAL", "UNAVAILABLE"}:
                add(
                    f"GAP:ITEM:{item.item_code}",
                    ReviewItemKind.DATA_INSUFFICIENT,
                    ReviewItemSource.RULE,
                    f"{item.label} 근거 없음",
                )
    for requirement in data.requirements:
        if requirement.result == "QUESTION_NEEDED":
            add(
                f"GAP:REQ:{requirement.req_id}",
                ReviewItemKind.DATA_INSUFFICIENT,
                ReviewItemSource.RULE,
                f"{requirement.name}: {requirement.reason}",
            )
    return list(items.values())


def review_items_for_detail(
    session: Session, opp_id: str, data: OpportunityDetail
) -> list[ReviewItem]:
    items = derive_review_items(data)
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id) if opportunity else None
    if customer is None:
        raise RunFailedError("검토사항의 기회·회사 연결을 확인해 주세요.")
    if customer.own_plating_line_suspected:
        source = {
            "AI": ReviewItemSource.AI,
            "INDUSTRY_NAME": ReviewItemSource.RULE,
        }.get(customer.own_plating_line_source)
        if source is None:
            raise RunFailedError("표면처리 확인 줄의 출처를 확인해 주세요.")
        text = "표면처리를 직접 하는 회사일 수 있음"
        if customer.own_plating_line_basis:
            text += f": {customer.own_plating_line_basis}"
        items.append(
            ReviewItem(
                item_id="FLAG:OWN_PLATING_LINE_SUSPECTED",
                kind=ReviewItemKind.OWN_PLATING_LINE_SUSPECTED,
                source=source,
                text=text,
                target_label=None,
                checked=False,
                checked_by=None,
                checked_at=None,
            )
        )
    # SQLite의 저장 순서로 고른다. 시계가 같거나 되돌아가도 마지막 추가 행이 현재 값이다.
    latest_rowids = (
        select(func.max(literal_column("rowid")))
        .select_from(ReviewCheck)
        .where(ReviewCheck.opp_id == opp_id)
        .group_by(ReviewCheck.item_id)
        .correlate(None)
    )
    latest = {
        row.item_id: row
        for row in session.scalars(
            select(ReviewCheck).where(
                ReviewCheck.opp_id == opp_id,
                literal_column("rec_review_check.rowid").in_(latest_rowids),
            )
        )
    }
    for item in items:
        if row := latest.get(item.item_id):
            item.checked = row.checked
            item.checked_by = row.staff_key
            item.checked_at = row.created_at
    return items


@router.post("/questions/{questionId}/reply", response_model=QuestionReplyEnvelope)
def save_question_reply(
    question_id: Annotated[str, Path(alias="questionId")],
    body: QuestionReplyRequest,
    session: SessionDep,
    staff: StaffDep,
):
    # 최신 답과 연결 기회별 이력·버전을 같은 쓰기 잠금 안에서 한 번에 저장한다.
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    question = session.get(ConfirmationQuestion, question_id)
    if question is None:
        raise NotFoundError("답을 남길 질문이 없습니다.")
    if question.status not in {"WAITING", "REQUESTED", "REPLIED"}:
        raise InputError("이미 반영된 질문에는 답을 덮어쓸 수 없습니다.")
    now = utcnow()
    question.reply_text = body.reply_text
    question.replied_at = body.replied_at
    question.replied_by = staff
    question.status = "REPLIED"
    linked = session.scalars(
        select(QuestionOpportunityLink.opp_id)
        .where(QuestionOpportunityLink.question_id == question_id)
        .order_by(QuestionOpportunityLink.opp_id)
    ).all()
    for opp_id in linked:
        opportunity = session.get(Opportunity, opp_id)
        if opportunity is None:
            raise RunFailedError("질문에 연결된 기회를 확인해 주세요.")
        previous = session.scalar(
            select(Note).where(Note.opp_id == opp_id).order_by(Note.version.desc())
        )
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opp_id,
                staff_key=staff,
                kind="REPLY",
                text=f"Q:{question_id} 답: {body.reply_text}",
                version=previous.version + 1 if previous else 1,
                created_at=now,
                created_by=staff,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
            )
        )
    session.flush()
    return QuestionReplyEnvelope(
        data=QuestionReplyResponse(
            question_id=question_id,
            reply_text=body.reply_text,
            replied_at=body.replied_at,
            replied_by=staff,
        ),
        meta=Meta(updated_at=now),
    )


@router.post(
    "/opportunities/{oppId}/review-items/{itemId}/check", response_model=ReviewCheckEnvelope
)
def save_review_check(
    opp_id: Annotated[str, Path(alias="oppId")],
    item_id: Annotated[str, Path(alias="itemId")],
    body: ReviewCheckRequest,
    session: SessionDep,
    staff: StaffDep,
):
    # 기존 상세 조립을 재사용해 표시된 항목과 체크 가능한 항목이 어긋나지 않게 한다.
    from geosan.api.routes.opportunities import opportunity_detail

    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("체크를 남길 기회가 없습니다.")
    evaluation = session.get(EvaluationRun, body.eval_id)
    batch = session.get(EvaluationBatch, evaluation.batch_id) if evaluation else None
    if (
        evaluation is None
        or evaluation.opp_id != opp_id
        or evaluation.run_status not in {"CONFIRMED", "SUPERSEDED"}
        or batch is None
        or batch.status != "CONFIRMED"
    ):
        raise InputError(
            "이 기회에서 본 평가 ID를 넣어 주세요.",
            fields=[FieldError(path="evalId", message="기회와 평가 연결을 확인해 주세요.")],
        )
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    current = opportunity_detail(opp_id, session).data
    if not any(item.item_id == item_id for item in current.review_items):
        raise NotFoundError("현재 검토사항에 없는 항목입니다.")
    now = utcnow()
    row = ReviewCheck(
        review_check_id=new_id("rcheck"),
        opp_id=opp_id,
        item_id=item_id,
        checked=body.checked,
        staff_key=staff,
        eval_id=body.eval_id,
        created_at=now,
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    session.flush()
    return ReviewCheckEnvelope(
        data=ReviewCheckResponse(
            item_id=item_id, checked=row.checked, checked_by=staff, checked_at=now
        ),
        meta=Meta(updated_at=now, dataset_kind=row.dataset_kind, has_virtual_data=row.is_virtual),
    )


def contact_counts(session: Session, opp_id: str) -> ContactCount:
    counts = dict(
        session.execute(
            select(Outcome.method, func.count())
            .where(Outcome.opp_id == opp_id, Outcome.method.in_(["CALL", "EMAIL", "VISIT"]))
            .group_by(Outcome.method)
        ).all()
    )
    return ContactCount(
        total=sum(counts.values()),
        call=counts.get("CALL", 0),
        email=counts.get("EMAIL", 0),
        visit=counts.get("VISIT", 0),
    )


@router.post("/opportunities/{oppId}/main-phone/confirm", response_model=MainPhoneConfirmEnvelope)
def save_main_phone_confirmation(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: MainPhoneConfirmRequest,
    session: SessionDep,
    staff: StaffDep,
):
    customer = confirm_main_phone(session, opp_id, body.expected_phone, staff)
    return MainPhoneConfirmEnvelope(
        data=MainPhoneConfirmResponse(
            main_phone=customer.main_phone,
            main_phone_confirmed_at=customer.main_phone_confirmed_at,
            main_phone_confirmed_by=customer.main_phone_confirmed_by,
        ),
        meta=Meta(
            updated_at=customer.main_phone_confirmed_at,
            dataset_kind=customer.dataset_kind,
            has_virtual_data=customer.is_virtual,
        ),
    )


def latest_bookmark(session: Session, opp_id: str) -> Bookmark | None:
    """관심 표시의 마지막 행(현재 값). 한 번도 켠 적이 없으면 None."""
    return session.scalar(
        select(Bookmark).where(Bookmark.opp_id == opp_id).order_by(Bookmark.version.desc())
    )


def bookmark_view(row: Bookmark | None) -> BookmarkRecord | None:
    if row is None:
        return None
    return BookmarkRecord(
        version=row.version,
        updated_by=row.staff_key,
        updated_at=row.created_at,
        active=row.active,
    )


def _add_bookmark(
    session: Session,
    opportunity: Opportunity,
    staff: str,
    *,
    active: bool,
    source: str,
    previous: Bookmark | None,
) -> Bookmark:
    row = Bookmark(
        bookmark_id=new_id("bookmark"),
        opp_id=opportunity.opp_id,
        active=active,
        staff_key=staff,
        source=source,
        version=previous.version + 1 if previous else 1,
        created_at=utcnow(),
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    return row


def _set_bookmark_by_record(
    session: Session, opportunity: Opportunity, staff: str, *, active: bool
) -> None:
    """기록 저장이 관심을 바꾼다(source AUTO_RECORD). 이미 그 값이면 새 행을 만들지 않는다."""
    previous = latest_bookmark(session, opportunity.opp_id)
    if (previous is not None and previous.active) == active:
        return
    _add_bookmark(
        session, opportunity, staff, active=active, source="AUTO_RECORD", previous=previous
    )


def _is_excluded(session: Session, opp_id: str) -> bool:
    """최신 검토 의견이 검토 대상 제외인가(#536). 제외한 회사는 관심 기업이 아니다."""
    opinion = latest_opinion(session, opp_id)
    return opinion is not None and opinion.opinion == "NOT_TARGET"


def ensure_bookmarked(session: Session, opportunity: Opportunity, staff: str) -> None:
    """자동 관심(#356): 관심이 꺼진 기회에 메모·영업 기록을 남기면 같은 저장 안에서 관심을 켠다.

    기록 창구가 쓰기 잠금을 잡은 뒤, 새 기록 행을 넣기 전에 부른다. 저장이 실패하면 같이 되돌린다.
    최신 검토 의견이 검토 대상 제외인 기회는 켜지 않는다(#536). 검토 의견 저장은 `save_opinion`이
    의견 값에 따라 따로 켜고 끈다.
    """
    if _is_excluded(session, opportunity.opp_id):
        return
    _set_bookmark_by_record(session, opportunity, staff, active=True)


def _has_sales_records(session: Session, opp_id: str) -> bool:
    """메모·영업 기록·검토 의견 행이 하나라도 있는지."""
    return any(
        session.scalar(select(model.opp_id).where(model.opp_id == opp_id).limit(1)) is not None
        for model in (Note, Outcome, ReviewOpinion)
    )


@router.put("/opportunities/{oppId}/bookmark", response_model=BookmarkEnvelope)
def save_bookmark(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: BookmarkRequest,
    session: SessionDep,
    staff: StaffDep,
):
    """관심 켜고 끄기(#356). 켜고 끌 때마다 새 행을 쌓고, 같은 값이면 새 행을 만들지 않는다."""
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("관심을 바꿀 기회가 없습니다.")
    # 마지막 행 읽기와 새 행 추가가 겹치지 않게 쓰기 잠금을 먼저 잡는다.
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = latest_bookmark(session, opp_id)
    if body.active and _is_excluded(session, opp_id):
        raise AppError(
            message="검토 대상 제외로 저장한 회사입니다",
            next_action=(
                "관심 기업에 다시 담으려면 검토 의견을 검토 권고나 추가 확인 필요로 바꿔 주세요"
            ),
            status=422,
            kind="BOOKMARK_EXCLUDED",
        )
    if body.active == (previous is not None and previous.active):
        # 이미 같은 값이다. 한 번도 켠 적이 없는 기회를 끄라는 요청은
        # 돌려줄 행이 없으므로 버전 0으로 답한다.
        current = bookmark_view(previous) or BookmarkRecord(
            version=0, updated_by=staff, updated_at=utcnow(), active=False
        )
        return BookmarkEnvelope(
            data=BookmarkResponse(**current.model_dump()),
            meta=Meta(
                updated_at=current.updated_at,
                has_virtual_data=opportunity.is_virtual,
                dataset_kind=opportunity.dataset_kind,
            ),
        )
    if not body.active and _has_sales_records(session, opp_id):
        raise AppError(
            message="기록이 있는 회사는 관심에서 뺄 수 없습니다",
            next_action="빼려면 검토 의견을 '검토 대상 제외'로 저장해 주세요",
            status=422,
            kind="BOOKMARK_HAS_RECORDS",
        )
    row = _add_bookmark(
        session, opportunity, staff, active=body.active, source="MANUAL", previous=previous
    )
    session.flush()
    previous_value = None
    if previous and previous.version > (body.expected_version or 0):
        previous_value = bookmark_view(previous).model_dump(mode="json", by_alias=True)
    return BookmarkEnvelope(
        data=BookmarkResponse(**bookmark_view(row).model_dump()),
        meta=Meta(
            updated_at=row.created_at,
            has_virtual_data=row.is_virtual,
            dataset_kind=row.dataset_kind,
            previous_value=previous_value,
        ),
    )


def latest_outcome(session: Session, opp_id: str) -> Outcome | None:
    return session.scalar(
        select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
    )


def outcome_view(row: Outcome | None) -> dict | None:
    if row is None:
        return None
    return {
        "version": row.version,
        "updatedBy": row.created_by,
        "updatedAt": row.created_at.isoformat(),
        "status": row.status,
        "lostReasonCode": row.lost_reason_code if row.status == "LOST" else None,
        "nextScheduleAt": row.next_schedule_at.isoformat() if row.next_schedule_at else None,
        "nextScheduleNote": row.next_schedule_note,
    }


@router.post("/opportunities/{oppId}/outcomes", response_model=OutcomeEnvelope)
def save_outcome(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: OutcomeRequest,
    session: SessionDep,
    staff: StaffDep,
):
    fields = scan_contacts(
        {"reason": body.reason, "memo": body.memo, "nextScheduleNote": body.next_schedule_note}
    )
    if body.attempted_at is not None and body.attempted_at > today_in_seoul():
        fields.append(
            FieldError(
                path="attemptedAt",
                message="앞으로 할 일은 다음 일정에 적어 주세요. 접촉 날짜는 오늘까지입니다.",
            )
        )
    if body.status == "LOST":
        if body.lost_reason_code is None:
            fields.append(FieldError(path="lostReasonCode", message="거절 이유를 골라 주세요."))
    elif "lost_reason_code" in body.model_fields_set:
        fields.append(
            FieldError(path="lostReasonCode", message="거절 단계에서만 이유 코드를 넣어 주세요.")
        )
    if body.judgment_check is not None and body.method is None:
        fields.append(FieldError(path="judgmentCheck", message="접촉 기록에서만 고를 수 있습니다."))
    if fields:
        raise InputError("영업 기록의 항목을 확인해 주세요.", fields=fields)
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("기록을 남길 기회가 없습니다.")
    validate_viewed_evaluation(session, opp_id, body.eval_id)
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = latest_outcome(session, opp_id)
    values = body.model_dump(exclude={"expected_version"})
    # C1·#250: 같은 거절 코드로 일정·접촉만 남기면 최신 거절 행의 설명을 이어받는다.
    # 이전 행 조회와 새 이력 저장은 같은 쓰기 잠금 안에서 처리한다.
    if body.status == "LOST" and not (body.reason and body.reason.strip()):
        previous_lost = session.scalar(
            select(Outcome)
            .where(Outcome.opp_id == opp_id, Outcome.status == "LOST")
            .order_by(Outcome.version.desc())
        )
        if previous_lost and previous_lost.lost_reason_code == body.lost_reason_code:
            values["reason"] = previous_lost.reason
    fields = scan_contacts({"reason": values["reason"]})
    if body.status == "LOST" and body.lost_reason_code == "OTHER":
        if not (values["reason"] and values["reason"].strip()):
            fields.append(FieldError(path="reason", message="기타를 고르면 이유를 적어 주세요."))
    if fields:
        raise InputError("영업 기록의 항목을 확인해 주세요.", fields=fields)
    # 단계만 바꾸는 요청은 이미 잡아 둔 다음 일정을 지우지 않는다.
    for name in ("next_schedule_at", "next_schedule_note"):
        if previous and name not in body.model_fields_set:
            values[name] = getattr(previous, name)
    ensure_bookmarked(session, opportunity, staff)
    row = Outcome(
        outcome_id=new_id("outcome"),
        opp_id=opp_id,
        **values,
        version=previous.version + 1 if previous else 1,
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    session.flush()
    previous_value = None
    if previous and previous.version > (body.expected_version or 0):
        previous_value = outcome_view(previous)
    return OutcomeEnvelope(
        data=OutcomeResponse(
            status=row.status, version=row.version, updated_by=staff, updated_at=row.created_at
        ),
        meta=Meta(
            updated_at=row.created_at,
            has_virtual_data=row.is_virtual,
            dataset_kind=row.dataset_kind,
            previous_value=previous_value,
        ),
    )


@router.get("/opportunities/{oppId}/activity", response_model=ActivityEnvelope)
def activity(
    opp_id: Annotated[str, Path(alias="oppId")],
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("활동을 조회할 기회가 없습니다.")
    items = []
    relation_labels = {
        "UNCONFIRMED": "확인 전",
        "NEW_CONFIRMED": "거래 없음",
        "EXISTING_CONFIRMED": "거래 중",
    }
    for row in session.scalars(
        select(RelationHistory)
        .where(RelationHistory.opp_id == opp_id)
        .order_by(RelationHistory.changed_at.desc(), literal_column("rowid").desc())
        .limit(limit)
    ):
        items.append(
            ActivityItem(
                at=row.changed_at,
                actor=row.staff_key,
                kind="RELATION_CONFIRMED",
                summary=(
                    f"거래 관계: {relation_labels[row.from_status]} → "
                    f"{relation_labels[row.to_status]}"
                ),
                previous_value=row.from_status,
            )
        )
    for row in session.scalars(
        select(Note).where(Note.opp_id == opp_id).order_by(Note.version.desc()).limit(limit)
    ):
        items.append(
            ActivityItem(
                at=row.created_at,
                actor=row.staff_key,
                kind="REPLY" if row.kind == "REPLY" else "NOTE",
                summary=(
                    f"답 기록 · {row.text.split(' 답: ', 1)[-1]}"
                    if row.kind == "REPLY"
                    else f"자료 조사 · {row.text}"
                    if row.kind == "RESEARCH"
                    else row.text
                ),
            )
        )
    for row in session.scalars(
        select(Outcome)
        .where(Outcome.opp_id == opp_id)
        .order_by(Outcome.version.desc())
        .limit(limit)
    ):
        status_label = {
            "NOT_EXECUTED": "미접촉",
            "IN_PROGRESS": "접촉",
            "SAMPLE_OR_REGISTRATION_APPROVED": "견적·샘플",
            "ON_HOLD": "보류",
            "WON": "성사",
            "LOST": "거절",
        }[row.status]
        summary = status_label
        if row.status == "LOST" and row.lost_reason_code:
            summary += f" · {LOST_REASON_LABELS[row.lost_reason_code]}"
        if row.method:
            method = {"CALL": "전화", "EMAIL": "메일", "VISIT": "방문"}[row.method]
            result = {"REACHED": "연결됨", "ABSENT": "부재", "DECLINED": "거절"}.get(row.result, "")
            summary += f" · {row.attempted_at or ''} {method} {result}"
        if row.next_schedule_at:
            summary += f" · 다음 일정 {row.next_schedule_at} {row.next_schedule_note or ''}"
        if row.reason:
            summary += f" · {row.reason}"
        items.append(
            ActivityItem(
                at=row.created_at,
                actor=row.created_by,
                kind="CONTACT_ATTEMPT" if row.method else "OUTCOME",
                summary=summary,
            )
        )
    for row in session.scalars(
        select(ReviewOpinion)
        .where(ReviewOpinion.opp_id == opp_id)
        .order_by(ReviewOpinion.version.desc())
        .limit(limit)
    ):
        items.append(
            ActivityItem(
                at=row.recorded_at,
                actor=row.staff_name,
                kind="OPINION",
                summary=row.opinion,
                eval_id=row.eval_id,
            )
        )
    items.sort(key=lambda item: item.at, reverse=True)
    return ActivityEnvelope(
        data=items[:limit],
        meta=Meta(
            dataset_kind=opportunity.dataset_kind,
            has_virtual_data=opportunity.is_virtual,
        ),
    )


@router.post("/opportunities/{oppId}/notes", response_model=NoteEnvelope)
def save_note(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: NoteRequest,
    session: SessionDep,
    staff: StaffDep,
):
    limit = runtime_for(session).app_settings.records.note_max_length
    if len(body.text) > limit:
        raise InputError(
            "영업 메모의 글자 수를 확인해 주세요.",
            fields=[FieldError(path="text", message=f"{limit}자 이내로 적어 주세요.")],
        )
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("메모를 남길 기회가 없습니다.")
    validate_viewed_evaluation(session, opp_id, body.eval_id)
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = session.scalar(
        select(Note).where(Note.opp_id == opp_id).order_by(Note.version.desc())
    )
    now = utcnow()
    ensure_bookmarked(session, opportunity, staff)
    row = Note(
        note_id=new_id("note"),
        opp_id=opp_id,
        staff_key=staff,
        text=body.text,
        eval_id=body.eval_id,
        kind=body.kind,
        version=previous.version + 1 if previous else 1,
        created_at=now,
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    session.flush()
    return NoteEnvelope(
        data=NoteResponse(
            note_id=row.note_id, version=row.version, updated_by=staff, updated_at=now
        ),
        meta=Meta(updated_at=now, has_virtual_data=row.is_virtual, dataset_kind=row.dataset_kind),
    )


def latest_opinion(session: Session, opp_id: str) -> ReviewOpinion | None:
    return session.scalar(
        select(ReviewOpinion)
        .where(ReviewOpinion.opp_id == opp_id)
        .order_by(ReviewOpinion.version.desc(), ReviewOpinion.recorded_at.desc())
    )


def opinion_view(row: ReviewOpinion | None) -> OpinionRecord | None:
    if row is None:
        return None
    return OpinionRecord(
        version=row.version,
        updated_by=row.staff_name,
        updated_at=row.recorded_at,
        opinion=row.opinion,
        reason=row.reason,
        memo=row.memo,
    )


@router.post(
    "/opportunities/{oppId}/opinions",
    response_model=OpinionEnvelope,
    response_model_exclude_unset=True,
)
def save_opinion(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: OpinionRequest,
    session: SessionDep,
    staff: StaffDep,
):
    fields = scan_contacts({"reason": body.reason, "memo": body.memo})
    if body.opinion == "NOT_TARGET" and (body.reason is None or not body.reason.strip()):
        fields.append(
            FieldError(path="reason", message="검토 대상 제외를 고르면 사유가 필요합니다.")
        )
    if body.expected_version is not None and body.expected_version < 0:
        fields.append(
            FieldError(path="expectedVersion", message="버전은 0 이상의 정수여야 합니다.")
        )
    if fields:
        raise InputError("의견을 저장할 항목을 확인해 주세요.", fields=fields)
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("의견을 남길 기회가 없습니다.")
    validate_viewed_evaluation(session, opp_id, body.eval_id)
    # SQLite의 쓰기 잠금을 먼저 잡아 의견 버전 읽기와 추가가 겹치지 않게 한다.
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = latest_opinion(session, opp_id)
    now = utcnow()
    # 검토 대상 제외면 관심을 끄고, 다른 의견이면 켠다(#536).
    # 제외였다가 의견을 바꾼 회사도 다시 켜진다.
    _set_bookmark_by_record(session, opportunity, staff, active=body.opinion != "NOT_TARGET")
    row = ReviewOpinion(
        opinion_id=new_id("opinion"),
        opp_id=opp_id,
        eval_id=body.eval_id,
        opinion=body.opinion.value,
        memo=body.memo,
        reason=body.reason,
        staff_name=staff,
        recorded_at=now,
        previous_opinion_id=previous.opinion_id if previous else None,
        version=previous.version + 1 if previous else 1,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
        created_by=staff,
    )
    session.add(row)
    session.flush()
    previous_value = None
    if previous and previous.version > (body.expected_version or 0):
        previous_value = opinion_view(previous).model_dump(mode="json", by_alias=True)
    return OpinionEnvelope(
        data=OpinionResponse(**opinion_view(row).model_dump()),
        meta=Meta(
            updated_at=now,
            has_virtual_data=row.is_virtual,
            dataset_kind=row.dataset_kind,
            previous_value=previous_value,
        ),
    )
