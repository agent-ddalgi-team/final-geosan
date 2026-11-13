"""담당자가 본 평가에 의견을 새 행으로 남긴다. 시스템 평가에는 쓰지 않는다.

관심(찜) 켜고 끄기와 자동 관심도 여기에 둔다(#356).
"""

from typing import Annotated

from fastapi import APIRouter, Path, Query
from sqlalchemy import func, literal_column, select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.process_catalog import load_process_catalog
from geosan.api.proposal_review import confirm_proposal, proposal_review_items
from geosan.api.sales_confirm import MAX_INDUSTRIES, confirm_industries, confirm_processes
from geosan.api.sales_step import (
    AnswerRow,
    RecordRow,
    SalesStepState,
    compute_sales_step,
    stage_for,
)
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
    SalesAnswerOption,
    SalesQuestionsEnvelope,
    SalesQuestionsView,
    SalesQuestionView,
    SalesShowWhen,
    SalesStepEntry,
)
from geosan.config.errors import AppError, FieldError, InputError, NotFoundError, RunFailedError
from geosan.config.sales_questions import ALL_STEPS, SalesQuestions, load_sales_questions
from geosan.config.validators import scan_contacts
from geosan.dashboard.sales_analysis import process_display_name
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.models import Customer, Opportunity, RelationHistory
from geosan.opportunity.queries import confirm_main_phone
from geosan.opportunity.relations import change_relation
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink
from geosan.records.models import (
    Bookmark,
    Note,
    Outcome,
    OutcomeAnswer,
    ReviewCheck,
    ReviewOpinion,
)
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
            "INDUSTRY_CODE": ReviewItemSource.RULE,
            "WATER_LIST": ReviewItemSource.RULE,
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
        item.step_options = None
    # 새 AI 제안은 이전 버전의 체크 표시를 물려받지 않는다.
    items.extend(proposal_review_items(session, opportunity, data))
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
    selected_item = next((item for item in current.review_items if item.item_id == item_id), None)
    if selected_item is None:
        raise NotFoundError("현재 검토사항에 없는 항목입니다.")
    now = utcnow()
    is_proposal = selected_item.kind in {
        ReviewItemKind.ITEM_INPUT_PROPOSAL,
        ReviewItemKind.PROCESS_LINK_PROPOSAL,
    }
    if not is_proposal and body.step_label is not None:
        raise InputError("단계 고치기는 AI 점수 입력 제안에서만 할 수 있습니다.")
    if is_proposal:
        if not body.checked:
            raise InputError("AI 제안은 확정 또는 고치기만 할 수 있습니다.")
        summary = confirm_proposal(
            session, opportunity, item_id, step_label=body.step_label, staff=staff, now=now
        )
        session.flush()
        result = evaluate_in_session(session, [opp_id], staff)
        if not result.ok or result.affected_opp_ids != [opp_id] or len(result.new_eval_ids) != 1:
            raise RunFailedError("AI 제안을 재평가하지 못해 저장을 취소했습니다.")
        version = session.scalar(select(func.max(Note.version)).where(Note.opp_id == opp_id)) or 0
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opp_id,
                staff_key=staff,
                kind="MEMO",
                text=summary,
                eval_id=body.eval_id,
                version=version + 1,
                created_at=now,
                created_by=staff,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
            )
        )
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
        meta=Meta(
            updated_at=now,
            dataset_kind=row.dataset_kind,
            has_virtual_data=row.is_virtual,
            **({"reevaluated": True} if is_proposal else {}),
        ),
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


def sales_questions(session: Session) -> SalesQuestions:
    """#607 꼬리 질문 파일. 한 요청 안에서는 한 번만 읽는다."""
    if "sales_questions" not in session.info:
        file_setting = runtime_for(session).app_settings.records.sales_questions_file
        session.info["sales_questions"] = load_sales_questions(file_setting)
    return session.info["sales_questions"]


def choice_catalog(session: Session) -> dict[str, dict[str, str]]:
    """#652 보기를 회사 값에서 가져오는 질문의 {종류: {값: 이름}}. 한 요청 안에서는 한 번만 읽는다.

    PROCESS는 활성 묶음의 거산 공정 목록(역량 파일 순서), INDUSTRY는 설정 산업군(그 순서)이다.
    """
    if "sales_choice_catalog" not in session.info:
        settings = runtime_for(session).app_settings
        session.info["sales_choice_catalog"] = {
            "PROCESS": {
                row.code: process_display_name(row.name)
                for row in load_process_catalog(session, settings.active_dataset_kind)
            },
            "INDUSTRY": {name: name for name in settings.industries},
        }
    return session.info["sales_choice_catalog"]


def _choice_values(body: OutcomeRequest, questions: SalesQuestions | None) -> dict[str, list[str]]:
    """#652 이번 답에서 고른 공정 코드·산업군 이름. 그 질문에 답하지 않았으면 키가 없다."""
    values: dict[str, list[str]] = {}
    if questions is None:
        return values
    for answer in body.answers:
        question = questions.question(answer.question_id)
        if question is not None and question.choices:
            values.setdefault(question.choices, []).append(answer.answer_id)
    return values


def _choice_error(
    body: OutcomeRequest,
    question,
    answer_id: str,
    seen: set[tuple[str, str]],
    catalog: dict[str, dict[str, str]],
) -> str | None:
    """#652 여러 값을 고르는 질문의 답 하나를 검사한다. 괜찮으면 None."""
    pair = (question.id, answer_id)
    if answer_id not in catalog.get(question.choices, {}):
        return "질문 목록에 없는 질문이나 보기입니다. 화면을 새로 고쳐 주세요."
    if pair in seen:
        return "같은 보기를 두 번 골랐습니다."
    if body.result == "DECLINED" and question.step != ALL_STEPS:
        return "거절로 끝난 접촉에서는 모든 단계 질문만 답할 수 있습니다."
    seen.add(pair)
    picked = sum(1 for found, _ in seen if found == question.id)
    if question.choices == "INDUSTRY" and picked > MAX_INDUSTRIES:
        return f"산업군은 {MAX_INDUSTRIES}개까지 고를 수 있습니다."
    return None


def _answer_errors(
    body: OutcomeRequest,
    questions: SalesQuestions | None,
    catalog: dict[str, dict[str, str]] | None = None,
) -> list[FieldError]:
    if not body.answers or questions is None:
        return []
    if body.method is None or body.result not in ("REACHED", "DECLINED"):
        return [FieldError(path="answers", message="연결된 접촉에서만 답을 고를 수 있습니다.")]
    errors: list[FieldError] = []
    seen: set[str] = set()
    seen_choices: set[tuple[str, str]] = set()
    chosen = {answer.question_id: answer.answer_id for answer in body.answers}
    for index, answer in enumerate(body.answers):
        question = questions.question(answer.question_id)
        if question is not None and question.choices:
            # #652: 여러 값을 고르는 질문은 같은 질문 id가 값마다 한 번씩 온다.
            message = _choice_error(body, question, answer.answer_id, seen_choices, catalog or {})
            if message:
                errors.append(FieldError(path=f"answers[{index}]", message=message))
            continue
        option = question.option(answer.answer_id) if question else None
        if question is None or option is None:
            message = "질문 목록에 없는 질문이나 보기입니다. 화면을 새로 고쳐 주세요."
        elif answer.question_id in seen:
            message = "같은 질문에 두 번 답했습니다."
        elif body.result == "DECLINED" and question.step != ALL_STEPS:
            # #643: 거절로 끝난 접촉에서는 "다음 할 일"과 그 꼬리(모든 단계 질문)만 받는다.
            message = "거절로 끝난 접촉에서는 모든 단계 질문만 답할 수 있습니다."
        elif (option.closes or option.lost_reason) and not all(
            chosen.get(target) in answer_ids
            for target, answer_ids in (
                question.show_when.answers if question.show_when else {}
            ).items()
        ):
            # #643: 단계를 끝내는 답은 앞 질문의 답("끝", "거절")이 같은 요청에 있을 때만 받는다.
            message = "앞 질문의 답과 맞지 않는 답입니다. 화면을 새로 고쳐 주세요."
        else:
            seen.add(answer.question_id)
            continue
        errors.append(FieldError(path=f"answers[{index}]", message=message))
    return errors


def _closing_answer(
    body: OutcomeRequest, questions: SalesQuestions | None
) -> tuple[str, str | None] | None:
    """#643 이번 답 가운데 단계를 끝내는 답(closes)과 거절 이유 답(lostReason)의 코드."""
    if questions is None:
        return None
    closes: str | None = None
    lost_reason: str | None = None
    for answer in body.answers:
        question = questions.question(answer.question_id)
        option = question.option(answer.answer_id) if question else None
        if option and option.closes:
            closes = option.closes
        if option and option.lost_reason:
            lost_reason = str(option.lost_reason.value)
    return (closes, lost_reason if closes == "LOST" else None) if closes else None


def sales_step_state(
    session: Session,
    opp_id: str,
    *,
    status: str | None,
    questions: SalesQuestions | None = None,
) -> SalesStepState:
    """#607 기록에서 세부 단계를 매번 계산한다(저장하지 않음)."""
    rows = [
        RecordRow(
            outcome_id=row.outcome_id,
            method=row.method,
            attempted_at=row.attempted_at,
            created_at=row.created_at,
            created_by=row.created_by,
            step_override=row.step_override,
        )
        for row in session.scalars(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version)
        )
    ]
    if not rows:
        return SalesStepState()
    answers = [
        AnswerRow(row.outcome_id, row.question_id, row.answer_id)
        for row in session.scalars(
            select(OutcomeAnswer)
            .where(OutcomeAnswer.opp_id == opp_id)
            .order_by(OutcomeAnswer.created_at, OutcomeAnswer.answer_row_id)
        )
    ]
    questions = questions or sales_questions(session)
    labels = choice_catalog(session) if any(q.choices for q in questions.questions) else None
    return compute_sales_step(rows, answers, questions, status, labels)


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
    questions = sales_questions(session) if body.answers else None
    catalog = choice_catalog(session) if questions else None
    answer_fields = _answer_errors(body, questions, catalog)
    # #643: 이번 답에 단계를 끝내는 답이 있으면 요청 status 대신 그 값과 거절 이유 답을 쓴다.
    closing = None if answer_fields else _closing_answer(body, questions)
    status = closing[0] if closing else body.status
    lost_reason_code = closing[1] if closing else body.lost_reason_code
    if status == "LOST":
        if lost_reason_code is None:
            fields.append(FieldError(path="lostReasonCode", message="거절 이유를 골라 주세요."))
    elif closing is None and "lost_reason_code" in body.model_fields_set:
        fields.append(
            FieldError(path="lostReasonCode", message="거절 단계에서만 이유 코드를 넣어 주세요.")
        )
    if body.judgment_check is not None and body.method is None:
        fields.append(FieldError(path="judgmentCheck", message="접촉 기록에서만 고를 수 있습니다."))
    records_settings = runtime_for(session).app_settings.records
    if body.memo and len(body.memo) > records_settings.memo_line_max_length:
        fields.append(
            FieldError(
                path="memo",
                message=f"한 줄 메모는 {records_settings.memo_line_max_length}자까지입니다.",
            )
        )
    fields.extend(answer_fields)
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
    values["status"], values["lost_reason_code"] = status, lost_reason_code
    if closing and status != "LOST":
        values["reason"] = None
    # C1·#250: 같은 거절 코드로 일정·접촉만 남기면 최신 거절 행의 설명을 이어받는다.
    # 이전 행 조회와 새 이력 저장은 같은 쓰기 잠금 안에서 처리한다.
    if status == "LOST" and not (body.reason and body.reason.strip()):
        previous_lost = session.scalar(
            select(Outcome)
            .where(Outcome.opp_id == opp_id, Outcome.status == "LOST")
            .order_by(Outcome.version.desc())
        )
        if previous_lost and previous_lost.lost_reason_code == lost_reason_code:
            values["reason"] = previous_lost.reason
    fields = scan_contacts({"reason": values["reason"]})
    if status == "LOST" and lost_reason_code == "OTHER":
        if not (values["reason"] and values["reason"].strip()):
            fields.append(FieldError(path="reason", message="기타를 고르면 이유를 적어 주세요."))
    if fields:
        raise InputError("영업 기록의 항목을 확인해 주세요.", fields=fields)
    # 단계만 바꾸는 요청은 이미 잡아 둔 다음 일정을 지우지 않는다.
    for name in ("next_schedule_at", "next_schedule_note"):
        if previous and name not in body.model_fields_set:
            values[name] = getattr(previous, name)
    ensure_bookmarked(session, opportunity, staff)
    values.pop("answers", None)
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
    for answer in body.answers:
        session.add(
            OutcomeAnswer(
                answer_row_id=new_id("answer"),
                outcome_id=row.outcome_id,
                opp_id=opp_id,
                question_id=answer.question_id,
                answer_id=answer.answer_id,
                created_by=staff,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
            )
        )
    session.flush()
    reevaluated = _confirm_choices(
        session, opportunity, _choice_values(body, questions), catalog or {}, body.eval_id, staff
    )
    # #607: 큰 단계는 같은 저장 안에서 세부 단계를 따라 앞으로만 바뀐다(보류·성사·거절은 그대로).
    if row.method or body.answers or body.step_override:
        step = sales_step_state(session, opp_id, status=None, questions=questions).code
        row.status = stage_for(row.status, row.method, step)
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
            **({"reevaluated": True} if reevaluated else {}),
        ),
    )


def _confirm_choices(
    session: Session,
    opportunity: Opportunity,
    values: dict[str, list[str]],
    catalog: dict[str, dict[str, str]],
    eval_id: str | None,
    staff: str,
) -> bool:
    """#652 꼬리 질문에서 고른 공정·산업군으로 이 회사 값을 확정한다. 다시 평가했으면 True.

    접촉 기록과 같은 트랜잭션이다: 공정 연결이 바뀌면 다시 평가하고, 평가가 실패하면 전부 취소된다.
    바뀐 것이 있으면 활동 이력에 한 줄을 남긴다. 고른 값이 없으면 아무것도 하지 않는다.
    """
    if not values:
        return False
    now = utcnow()
    opp_id = opportunity.opp_id
    results = []
    if values.get("PROCESS"):
        names = catalog.get("PROCESS", {})
        # 저장·이력 문장은 고른 순서가 아니라 역량 파일 순서로 맞춘다.
        codes = [code for code in names if code in values["PROCESS"]]
        results.append(confirm_processes(session, opportunity, codes, names, staff=staff, now=now))
    if values.get("INDUSTRY"):
        order = catalog.get("INDUSTRY", {})
        industries = [name for name in order if name in values["INDUSTRY"]]
        results.append(confirm_industries(session, opportunity, industries, now=now))
    session.flush()
    reevaluated = any(result.links_changed for result in results)
    if reevaluated:
        result = evaluate_in_session(session, [opp_id], staff)
        if not result.ok or result.affected_opp_ids != [opp_id] or len(result.new_eval_ids) != 1:
            raise RunFailedError("공정 확인을 다시 평가하지 못해 저장을 취소했습니다.")
    summaries = [result.summary for result in results if result.summary]
    if summaries:
        version = session.scalar(select(func.max(Note.version)).where(Note.opp_id == opp_id)) or 0
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opp_id,
                staff_key=staff,
                kind="MEMO",
                text=" / ".join(summaries),
                eval_id=eval_id,
                version=version + 1,
                created_at=now,
                created_by=staff,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
            )
        )
        session.flush()
    return reevaluated


@router.get("/sales-questions", response_model=SalesQuestionsEnvelope)
def get_sales_questions(session: SessionDep):
    """#607 꼬리 질문 묶음. 외부 호출·저장 없음, 보기 전용도 조회."""
    questions = sales_questions(session)
    catalog = choice_catalog(session) if any(q.choices for q in questions.questions) else {}
    return SalesQuestionsEnvelope(
        data=SalesQuestionsView(
            version=questions.version,
            steps=[
                SalesStepEntry(code=entry.code, label=entry.label, stage=entry.stage)
                for entry in questions.steps
            ],
            questions=[
                SalesQuestionView(
                    question_id=question.id,
                    text=question.text,
                    step=question.step,
                    show_when=SalesShowWhen(answers=question.show_when.answers)
                    if question.show_when
                    else None,
                    choices=question.choices,
                    # #652: choices 질문의 보기는 파일이 아니라 공정 목록·설정 산업군에서 채운다.
                    answers=[
                        SalesAnswerOption(answer_id=value, label=label)
                        for value, label in catalog[question.choices].items()
                    ]
                    if question.choices
                    else [
                        SalesAnswerOption(
                            answer_id=option.id,
                            label=option.label,
                            reaches=option.reaches,
                            closes=option.closes,
                            lost_reason=option.lost_reason,
                        )
                        for option in question.answers
                    ],
                )
                for question in questions.questions
            ],
        ),
        meta=Meta(),
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
