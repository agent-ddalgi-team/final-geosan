"""목록 구성과 상세 영역의 등록 지점. 원래 순위와 최신 평가 내용을 따로 읽는다."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Path, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.routes.records import latest_opinion, opinion_view
from geosan.api.schemas import (
    ApprovalEligibility,
    Blocker,
    CardRecords,
    DetailHeader,
    DetailRecords,
    EvidenceView,
    Meta,
    OpportunityCard,
    OpportunityDetail,
    OpportunityDetailEnvelope,
    OpportunityListEnvelope,
    ProcessLinkView,
    Question,
    Reasons,
    RequirementCheckView,
    ScoreItemView,
    Scores,
)
from geosan.capability.queries import get_process
from geosan.config.errors import InputError, NotFoundError, RunFailedError
from geosan.evaluation.ledger import latest_confirmed_evaluation, latest_full_batch
from geosan.evaluation.models import (
    EvaluationBatch,
    EvaluationRun,
    ItemJudgment,
    ReadinessCheck,
    RequirementCheck,
)
from geosan.evidence.models import Evidence
from geosan.evidence.queries import list_evidence
from geosan.opportunity.models import Customer, Interaction, Opportunity, OppProcessLink
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink

router = APIRouter()
list_filters: list[Callable] = []


@dataclass
class DetailContext:
    session: Session
    opportunity: Opportunity
    customer: Customer
    evaluation: EvaluationRun | None
    batch: EvaluationBatch | None


def _relation_note(context: DetailContext) -> str | None:
    """고객의 현재 허용 요약을 표시한다. 기회 평가용 이력 조회와는 분리한다(BR2.7)."""
    summaries = context.session.scalars(
        select(Interaction.allowed_summary)
        .where(
            Interaction.customer_id == context.customer.customer_id,
            Interaction.dataset_kind == context.opportunity.dataset_kind,
            Interaction.superseded_at.is_(None),
            Interaction.security_grade != "FORBIDDEN",
        )
        .order_by(
            Interaction.occurred_at.desc().nulls_last(),
            Interaction.created_at.desc(),
            Interaction.interaction_id.desc(),
        )
    )
    for summary in summaries:
        if summary and summary.strip():
            # 화면의 기존 관계 상태 쉬운 말과 같은 표현을 쓴다.
            label = {
                "NEW_CONFIRMED": "신규",
                "EXISTING_CONFIRMED": "기존",
                "UNCONFIRMED": "확인 전",
            }[context.customer.relation_status]
            return f"{label} ({summary.strip()})"
    return None


def _header(context: DetailContext) -> dict:
    opportunity, customer, run = context.opportunity, context.customer, context.evaluation
    return {
        "header": DetailHeader(
            title=f"{customer.name} · {opportunity.item}",
            customer_name=customer.name,
            opportunity_item=opportunity.item,
            relation_status=customer.relation_status,
            relation_note=_relation_note(context),
            purpose=opportunity.purpose,
            owner=opportunity.owner,
            classification_code=run.classification_code if run else "NOT_EVALUATED",
            core_evidence_recheck=run.core_evidence_recheck_flag if run else False,
            score_display=run.score_display if run else "--",
            is_virtual=run.is_virtual if run else opportunity.is_virtual,
            dataset_kind=run.dataset_kind if run else opportunity.dataset_kind,
            is_recontact=False,
        )
    }


def _reasons(context: DetailContext) -> dict:
    session, opportunity, run = context.session, context.opportunity, context.evaluation
    questions = []
    links = session.scalars(
        select(QuestionOpportunityLink)
        .where(QuestionOpportunityLink.opp_id == opportunity.opp_id)
        .order_by(QuestionOpportunityLink.question_id)
    )
    for link in links:
        row = session.get(ConfirmationQuestion, link.question_id)
        if row is None:
            raise RunFailedError("확인 질문의 연결을 확인해 주세요.")
        questions.append(
            Question(
                question_id=row.question_id,
                text=row.question_text,
                target_kind=row.target_kind,
                target_id=row.target_id,
                current_value=row.current_value,
                effect_if_answered=link.effect_if_answered,
                status=row.status,
                linked_opp_ids=list(
                    session.scalars(
                        select(QuestionOpportunityLink.opp_id)
                        .where(QuestionOpportunityLink.question_id == row.question_id)
                        .order_by(QuestionOpportunityLink.opp_id)
                    )
                ),
                is_user_added=row.is_user_added,
            )
        )
    return {
        "reasons": Reasons(
            reason=run.reason if run else "아직 평가하지 않았습니다.",
            next_action=run.next_action if run else "평가 후 추천 이유를 확인해 주세요.",
            questions=questions,
        )
    }


def _requirements(context: DetailContext) -> dict:
    session, run = context.session, context.evaluation
    views = []
    if run:
        definitions = {row["reqId"]: row for row in run.input_snapshot["requirements"]}
        qualifications = {
            row["qualId"]: row for row in run.input_snapshot["capability"]["qualifications"]
        }
        for check in session.scalars(
            select(RequirementCheck)
            .where(RequirementCheck.eval_id == run.eval_id)
            .order_by(RequirementCheck.req_id)
        ):
            definition = definitions[check.req_id]
            qual = qualifications.get(check.qual_id)
            views.append(
                RequirementCheckView(
                    req_id=check.req_id,
                    name=definition["name"],
                    req_level=definition["reqLevel"],
                    needed_stage=definition["neededStage"],
                    due_at=definition["dueAt"],
                    capability_status=qual["reviewStatus"] if qual else None,
                    result=check.display_result,
                    reason=check.reason,
                )
            )
    readiness = session.scalar(
        select(ReadinessCheck)
        .where(
            ReadinessCheck.opp_id == context.opportunity.opp_id,
            ReadinessCheck.superseded_at.is_(None),
        )
        .order_by(ReadinessCheck.created_at.desc())
    )
    return {
        "requirements": views,
        "approval_eligibility": ApprovalEligibility(
            eligible=not run.blocks_approval if run else False,
            reason=run.blocker_text if run else "평가 후 확인할 수 있습니다.",
            readiness_checked=bool(run and run.timing_requirements["readiness"]),
            readiness_needs_recheck=bool(readiness and readiness.reset_at),
            allowed_purposes=[],
        ),
    }


def _process_links(context: DetailContext) -> dict:
    from geosan.api.app import logger
    from geosan.rules.engine import evaluate
    from geosan.rules.models import EvaluationInput

    session, run = context.session, context.evaluation
    if run is None:
        return {"process_links": []}
    links = run.input_snapshot["processLinks"]
    results = {}
    stale = False
    for definition in links:
        row = session.get(OppProcessLink, definition["linkId"])
        if row is None or row.source_eval_id != run.eval_id:
            stale = True
        else:
            results[row.link_id] = (row.current_result, row.current_reason)
    if stale:
        document = {
            **run.input_snapshot,
            "evidence": [row for row in run.input_snapshot["evidence"] if not row.get("blocked")],
        }
        recalculated = evaluate(EvaluationInput.model_validate(document))
        results = {
            row.link_id: (row.result, row.reason) for row in recalculated.process_link_results
        }
        logger.info("eval.link_recomputed", extra={"oppId": run.opp_id, "evalId": run.eval_id})
    views = []
    for definition in links:
        process = get_process(session, definition["processCode"], dataset_kind=run.dataset_kind)
        result, reason = results[definition["linkId"]]
        views.append(
            ProcessLinkView(
                link_id=definition["linkId"],
                process_code=definition["processCode"],
                process_name=process.name if process else None,
                applied_material=definition["appliedMaterial"],
                result=result,
                reason=reason,
            )
        )
    return {"process_links": views}


def _evidence(context: DetailContext) -> dict:
    session, run = context.session, context.evaluation
    if run:
        ids = [
            row["evidenceId"] for row in run.input_snapshot["evidence"] if not row.get("blocked")
        ]
        rows = session.scalars(
            select(Evidence)
            .where(
                Evidence.opp_id == context.opportunity.opp_id,
                Evidence.evidence_id.in_(ids),
                Evidence.security_grade != "FORBIDDEN",
            )
            .order_by(Evidence.evidence_id)
        )
    else:
        rows = list_evidence(session, context.opportunity.opp_id)
    return {
        "evidence": [
            EvidenceView(
                evidence_id=row.evidence_id,
                source_grade=row.source_grade,
                certainty=row.certainty_confirmed or row.certainty_proposed,
                is_llm_proposed=row.is_llm_proposed,
                quote=row.quote,
                source_ref=row.source_ref,
                occurred_at=row.occurred_at.isoformat() if row.occurred_at else None,
                subject=row.subject,
            )
            for row in rows
        ]
    }


def _scores(context: DetailContext) -> dict:
    session, run, batch = context.session, context.evaluation, context.batch
    if run is None:
        return {"scores": None}
    config = run.input_snapshot["ruleConfig"]
    definitions = {row["itemCode"]: row for row in config["newProfileItems"]}
    items = {
        row.item_code: row
        for row in session.scalars(select(ItemJudgment).where(ItemJudgment.eval_id == run.eval_id))
    }
    return {
        "scores": Scores(
            E=run.score_e,
            P=run.score_p,
            S=run.score_s,
            R=run.score_r,
            C=run.completion_c,
            items=[
                ScoreItemView(
                    item_code=code,
                    label=definition["label"] or code,
                    state=items[code].state,
                    weight=items[code].weight,
                    match_rate=items[code].match_rate,
                    certainty=items[code].certainty,
                    decay=items[code].decay,
                    score=items[code].score,
                    fact_judged=items[code].fact_judged,
                )
                for code, definition in definitions.items()
            ],
            rule_version=batch.rule_version,
            dataset_kind=run.dataset_kind,
            batch_id=batch.batch_id,
            evaluated_at=run.created_at,
        )
    }


def _records(context: DetailContext) -> dict:
    return {
        "records": DetailRecords(
            opinion=opinion_view(latest_opinion(context.session, context.opportunity.opp_id)),
            bookmark=None,
            approval=None,
            outcome=None,
        )
    }


detail_sections: list[Callable] = [
    _header,
    _reasons,
    _requirements,
    _process_links,
    _evidence,
    _scores,
    _records,
]


@router.get(
    "/opportunities/{oppId}",
    response_model=OpportunityDetailEnvelope,
    response_model_exclude_unset=True,
)
def opportunity_detail(opp_id: Annotated[str, Path(alias="oppId")], session: SessionDep):
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("선택한 기회가 없습니다.")
    customer = session.get(Customer, opportunity.customer_id)
    run = latest_confirmed_evaluation(session, opp_id)
    if customer is None:
        raise RunFailedError("기회의 고객 연결을 확인해 주세요.")
    opinion = latest_opinion(session, opp_id)
    batch = session.get(EvaluationBatch, run.batch_id) if run else None
    context = DetailContext(session, opportunity, customer, run, batch)
    data = dict(
        stage=None,
        homepage_needs_confirm=False,
        recontact=None,
        eval_id=run.eval_id if run else None,
        previous_eval_id=run.previous_eval_id if run else None,
        reevaluated=bool(
            run
            and run.previous_eval_id is not None
            and (opinion is None or opinion.eval_id != run.eval_id)
        ),
    )
    for section in detail_sections:
        data.update(section(context))
    detail = OpportunityDetail(**data)
    # 경계 모델의 별칭이 계약과 달라진 상태에서는 약속에 없는 점수 키를 내보내지 않는다.
    if (
        detail.scores is not None
        and not {"E", "P", "S", "R", "C"} <= detail.scores.model_dump(by_alias=True).keys()
    ):
        raise RunFailedError(
            "상세 정보를 표시할 수 없습니다.",
            next_action="목록의 최신 평가를 확인하고 오류 번호와 함께 문의해 주세요.",
        )
    return OpportunityDetailEnvelope(
        data=detail,
        meta=Meta(
            updated_at=run.created_at if run else opportunity.created_at,
            has_virtual_data=run.is_virtual if run else opportunity.is_virtual,
            dataset_kind=run.dataset_kind if run else opportunity.dataset_kind,
        ),
    )


@router.get(
    "/opportunities", response_model=OpportunityListEnvelope, response_model_exclude_unset=True
)
def list_opportunities(
    request: Request,
    session: SessionDep,
    tab: str = "new",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=50)] = 20,
):
    runtime = runtime_for(session)
    dataset_kind = runtime.app_settings.active_dataset_kind
    if not list_filters and (
        tab != "new" or any(key in request.query_params for key in ("q", "filter", "bookmarked"))
    ):
        raise InputError("이 목록의 추가 필터는 아직 연결되지 않았습니다.")
    batch = latest_full_batch(session, dataset_kind=dataset_kind.value)
    if batch is None:
        return OpportunityListEnvelope(
            data=[],
            meta=Meta(
                updated_at=None,
                has_virtual_data=False,
                dataset_kind=dataset_kind,
                total=0,
                not_evaluated_count=session.scalar(select(func.count()).select_from(Opportunity)),
            ),
        )
    population = select(EvaluationRun.opp_id).where(EvaluationRun.batch_id == batch.batch_id)
    query = select(EvaluationRun).where(EvaluationRun.batch_id == batch.batch_id)
    for filter_function in list_filters:
        query = filter_function(session, query, request)
    total = session.scalar(select(func.count()).select_from(query.subquery()))
    originals = session.scalars(
        query.order_by(EvaluationRun.original_rank).offset((page - 1) * page_size).limit(page_size)
    )
    cards = []
    for original in originals:
        current = latest_confirmed_evaluation(session, original.opp_id)
        opportunity = session.get(Opportunity, original.opp_id)
        customer = session.get(Customer, opportunity.customer_id) if opportunity else None
        if current is None or opportunity is None or customer is None:
            raise RunFailedError("목록의 기회·고객·평가 연결을 확인해 주세요.")
        cards.append(
            OpportunityCard(
                opp_id=opportunity.opp_id,
                rank=original.original_rank,
                title=f"{customer.name} · {opportunity.item}",
                classification_code=current.classification_code,
                core_evidence_recheck=current.core_evidence_recheck_flag,
                score_s=current.score_s,
                score_display=current.score_display,
                reason=current.reason,
                blocker=Blocker(text=current.blocker_text, blocks_approval=current.blocks_approval),
                next_action=current.next_action,
                records=CardRecords(
                    opinion=opinion_view(latest_opinion(session, opportunity.opp_id)), bookmark=None
                ),
                stage=None,
                is_virtual=current.is_virtual,
                is_recontact=False,
                recontact=None,
                eval_id=current.eval_id,
                reevaluated=current.eval_id != original.eval_id,
                dataset_kind=current.dataset_kind,
            )
        )
    not_evaluated = session.scalar(
        select(func.count())
        .select_from(Opportunity)
        .where(Opportunity.created_at > batch.created_at, Opportunity.opp_id.not_in(population))
    )
    return OpportunityListEnvelope(
        data=cards,
        meta=Meta(
            updated_at=batch.created_at,
            has_virtual_data=any(card.is_virtual for card in cards),
            dataset_kind=dataset_kind,
            total=total,
            not_evaluated_count=not_evaluated,
        ),
    )
