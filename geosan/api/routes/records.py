"""담당자가 본 평가에 의견을 새 행으로 남긴다. 시스템 평가에는 쓰지 않는다."""

from typing import Annotated

from fastapi import APIRouter, Path, Query
from sqlalchemy import func, literal_column, select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.schemas import (
    ActivityEnvelope,
    ActivityItem,
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
    ReviewCheckEnvelope,
    ReviewCheckRequest,
    ReviewCheckResponse,
    ReviewItem,
)
from geosan.config.errors import FieldError, InputError, NotFoundError, RunFailedError
from geosan.config.validators import scan_contacts
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.models import Opportunity
from geosan.opportunity.queries import confirm_main_phone
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink
from geosan.records.models import Note, Outcome, ReviewCheck, ReviewOpinion
from geosan.rules.codes import ReviewItemKind, ReviewItemSource
from geosan.storage.base import new_id, utcnow

router = APIRouter()


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
    if body.status == "LOST" and not (body.reason and body.reason.strip()):
        fields.append(FieldError(path="reason", message="거절 사유를 적어 주세요."))
    if fields:
        raise InputError("영업 기록의 항목을 확인해 주세요.", fields=fields)
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("기록을 남길 기회가 없습니다.")
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = latest_outcome(session, opp_id)
    values = body.model_dump(exclude={"eval_id", "expected_version"})
    # 단계만 바꾸는 요청은 이미 잡아 둔 다음 일정을 지우지 않는다.
    for name in ("next_schedule_at", "next_schedule_note"):
        if previous and name not in body.model_fields_set:
            values[name] = getattr(previous, name)
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
            "INTERESTED": "관심",
            "IN_PROGRESS": "접촉",
            "SAMPLE_OR_REGISTRATION_APPROVED": "견적·샘플",
            "ON_HOLD": "보류",
            "WON": "성사",
            "LOST": "거절",
        }[row.status]
        summary = status_label
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
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = session.scalar(
        select(Note).where(Note.opp_id == opp_id).order_by(Note.version.desc())
    )
    now = utcnow()
    row = Note(
        note_id=new_id("note"),
        opp_id=opp_id,
        staff_key=staff,
        text=body.text,
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
    # SQLite의 쓰기 잠금을 먼저 잡아 의견 버전 읽기와 추가가 겹치지 않게 한다.
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = latest_opinion(session, opp_id)
    now = utcnow()
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
