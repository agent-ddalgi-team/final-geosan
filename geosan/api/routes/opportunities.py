"""목록 구성과 상세 영역의 등록 지점. 원래 순위와 최신 평가 내용을 따로 읽는다."""

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Path, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.ingest_views import (
    candidate_order,
    collected_evaluations,
    discovery_fields,
    latest_ingest,
    recent_order,
    research_state,
)
from geosan.api.process_catalog import load_process_catalog
from geosan.api.routes.records import (
    bookmark_view,
    contact_counts,
    latest_bookmark,
    latest_opinion,
    latest_outcome,
    opinion_view,
    outcome_view,
    review_items_for_detail,
)
from geosan.api.schemas import (
    ApprovalEligibility,
    Blocker,
    CardOutcome,
    CardRecords,
    DetailHeader,
    DetailRecords,
    EvidenceView,
    IndustryCount,
    Meta,
    OpportunityCard,
    OpportunityDetail,
    OpportunityDetailEnvelope,
    OpportunityListEnvelope,
    OutcomeStatus,
    ProcessCount,
    ProcessLinkView,
    Question,
    Reasons,
    RegionCount,
    RequirementCheckView,
    ScoreItemView,
    Scores,
    ScoreState,
)
from geosan.capability.queries import get_process
from geosan.config.errors import InputError, NotFoundError, RunFailedError
from geosan.dashboard.queries import bookmarked_opp_ids
from geosan.evaluation.inputs import has_ai_pending_inputs
from geosan.evaluation.ledger import latest_confirmed_evaluation, latest_full_batch
from geosan.evaluation.models import (
    EvaluationBatch,
    EvaluationRun,
    ItemJudgment,
    JudgmentEvidence,
    ReadinessCheck,
    RequirementCheck,
)
from geosan.evidence.models import Evidence
from geosan.evidence.queries import list_evidence
from geosan.opportunity.factory_csv import address_city
from geosan.opportunity.models import Customer, Interaction, Opportunity, OppProcessLink
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink
from geosan.records.models import Outcome, ReviewOpinion
from geosan.rules.codes import ProcessCode
from geosan.storage.base import utcnow

router = APIRouter()
list_filters: list[Callable] = []
# 목록이 받는 `filter` 값. 값을 더하는 부품이 여기에 등록하고 처리 함수는 list_filters에 더한다.
# 여기에 없는 값은 입력 오류다(거르기 함수가 있어도, 평가 자료가 없을 때도 같다).
supported_filters: set[str] = set()
# 목록의 `opinion` 조건(#356): 최신 검토 의견 세 값 + NONE(의견을 아직 고르지 않은 기회).
OpinionFilter = Literal["WORTH_REVIEW", "NEED_CHECK", "NOT_TARGET", "NONE"]


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


_URL = re.compile(r"https?://[^\s)\]>\"']+")


def _homepage_url(context: DetailContext) -> str | None:
    """조사한 회사는 저장 결과를 쓰고, 조사 전 회사만 근거 출처에서 주소를 찾는다."""
    if context.customer.homepage_status is not None:
        return context.customer.homepage_url
    rows = context.session.scalars(
        select(Evidence.source_ref).where(
            Evidence.opp_id == context.opportunity.opp_id,
            Evidence.security_grade != "FORBIDDEN",
        )
    )
    roots: dict[str, int] = {}
    for source_ref in rows:
        for url in _URL.findall(source_ref or ""):
            parts = urlsplit(url)
            if parts.scheme and parts.netloc:
                root = f"{parts.scheme}://{parts.netloc}/"
                roots[root] = roots.get(root, 0) + 1
    if not roots:
        return None
    return max(sorted(roots), key=roots.get)


def _score_state(run: EvaluationRun | None, *, ai_pending: bool = False) -> ScoreState:
    """#262 저장 연결 전, #263에서 허용한 기존 분류·점수 기반 표시 상태(C1).

    ai_pending: 현재 점수 입력에 AI 제안(확인 전)이 있으면 점수를 흐리게 보인다(#286).
    """
    if run is None or run.score_s is None:
        return "NONE"
    if ai_pending or run.classification_code in {"FILTER_PENDING", "OPS_PENDING"}:
        return "PENDING"
    return "CONFIRMED"


def _header(context: DetailContext) -> dict:
    opportunity, customer, run = context.opportunity, context.customer, context.evaluation
    research = runtime_for(context.session).app_settings.research
    return {
        "header": DetailHeader(
            score_state=_score_state(
                run, ai_pending=has_ai_pending_inputs(context.session, opportunity.opp_id)
            ),
            relation_confirmed_at=customer.relation_confirmed_at,
            # #265의 승인된 C6 열이 생기기 전 사례 파일 자료에는 담당자가 없다.
            relation_confirmed_by=getattr(customer, "relation_confirmed_by", None),
            industries=customer.industries or [],
            industries_source=customer.industries_source,
            address=customer.address or "",
            distance_km=None,
            main_phone=customer.main_phone,
            main_phone_source=customer.main_phone_source,
            main_phone_source_url=customer.main_phone_source_url,
            main_phone_confirmed_at=customer.main_phone_confirmed_at,
            main_phone_confirmed_by=customer.main_phone_confirmed_by,
            summary_line=customer.summary_line,
            highlights=customer.highlights or [],
            researched_at=customer.researched_at,
            research_source=customer.research_source,
            research_stale=(
                customer.researched_at is not None
                and utcnow() - customer.researched_at > timedelta(days=research.stale_after_days)
            ),
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
            homepage_url=_homepage_url(context),
            homepage_status=customer.homepage_status,
            homepage_confidence=customer.homepage_confidence,
            homepage_source=customer.homepage_source,
            **discovery_fields(customer),
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
                reply_text=row.reply_text,
                replied_at=row.replied_at.isoformat() if row.replied_at else None,
                replied_by=row.replied_by,
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
            next_action=run.next_action if run else "평가 후 추천 근거를 확인해 주세요.",
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
    # 항목별 근거 ID(#176): 평가 때 저장한 판정 ↔ 근거 연결을 그대로 돌려준다.
    evidence_ids: dict[str, list[str]] = {}
    for judgment_id, evidence_id in session.execute(
        select(JudgmentEvidence.judgment_id, JudgmentEvidence.evidence_id)
        .where(JudgmentEvidence.judgment_id.in_([row.judgment_id for row in items.values()]))
        .order_by(JudgmentEvidence.evidence_id)
    ):
        evidence_ids.setdefault(judgment_id, []).append(evidence_id)
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
                    summary=items[code].summary,
                    evidence_ids=evidence_ids.get(items[code].judgment_id, []),
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
            contact_count=contact_counts(context.session, context.opportunity.opp_id),
            opinion=opinion_view(latest_opinion(context.session, context.opportunity.opp_id)),
            bookmark=bookmark_view(latest_bookmark(context.session, context.opportunity.opp_id)),
            approval=None,
            outcome=outcome_view(latest_outcome(context.session, context.opportunity.opp_id)),
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
    detail.review_items = review_items_for_detail(session, opp_id, detail)
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


def _address_region(address: str | None) -> str | None:
    """계약 C1: 원본 주소의 시·군. 공백이 사라진 비교용 주소는 사용하지 않는다."""
    parts = address.split() if address else []
    if not parts:
        return None
    if parts[0].endswith(("광역시", "특별시")) or parts[0].startswith("세종"):
        return parts[0]
    # "천안시서북구"처럼 구가 붙은 주소도 천안시로 묶는다(#521).
    return (address_city(address) or parts[1]) if len(parts) > 1 else None


@router.get(
    "/opportunities", response_model=OpportunityListEnvelope, response_model_exclude_unset=True
)
def list_opportunities(
    request: Request,
    session: SessionDep,
    tab: str = "new",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=50)] = 20,
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
    runtime = runtime_for(session)
    dataset_kind = runtime.app_settings.active_dataset_kind
    if industry is not None and industry not in runtime.app_settings.industries:
        raise InputError("설정 목록에 있는 산업군을 선택해 주세요.")
    params = request.query_params
    if tab != "new" or ("filter" in params and params["filter"] not in supported_filters):
        raise InputError("이 목록의 추가 필터는 아직 연결되지 않았습니다.")
    # 정렬(#516): rank = 추천 순(기본), recent = 들어온 시각 최신 순.
    # distance(#222)는 아직 연결 전이라 거부한다.
    if sort not in ("rank", "recent"):
        raise InputError(
            "이 정렬은 아직 연결되지 않았습니다. 추천 순 또는 최근 들어온 순을 골라 주세요."
        )
    batch = latest_full_batch(session, dataset_kind=dataset_kind.value)
    progress = latest_ingest(session, dataset_kind.value)
    full_batch_id = batch.batch_id if batch else None
    added_eval_ids = collected_evaluations(session, dataset_kind.value, full_batch_id)
    query = select(EvaluationRun).where(
        or_(
            EvaluationRun.batch_id == full_batch_id if batch else False,
            EvaluationRun.eval_id.in_(added_eval_ids),
        )
    )
    all_population = select(query.subquery().c.opp_id)
    if ingest_batch is not None:
        selected_batch = ingest_batch
        if ingest_batch == "latest":
            selected_batch = progress.batch_id if progress else None
        query = query.where(
            EvaluationRun.opp_id.in_(
                select(Opportunity.opp_id)
                .join(Customer, Opportunity.customer_id == Customer.customer_id)
                .where(Customer.ingest_batch_id == selected_batch if selected_batch else False)
            )
        )
    if bookmarked:
        # 관심으로 켜 둔 기회만(#356). false·없음은 거르지 않는다.
        # 선택지(공정·지역·산업) 건수도 관심 기업 안에서 세도록 건수 계산보다 먼저 건다(#516).
        query = query.where(EvaluationRun.opp_id.in_(bookmarked_opp_ids()))
    population = select(query.subquery().c.opp_id)
    # 재투입으로 교체된 연결은 빼고, 같은 기회·공정은 한 번만 센다.
    links = session.execute(
        select(OppProcessLink.opp_id, OppProcessLink.process_code)
        .where(OppProcessLink.opp_id.in_(population), OppProcessLink.superseded_at.is_(None))
        .distinct()
    ).all()
    codes_by_opportunity: dict[str, set[str]] = {}
    for opp_id, code in links:
        codes_by_opportunity.setdefault(opp_id, set()).add(code)
    processes = load_process_catalog(session, dataset_kind)
    # 목록 머리 선택란(#361): 기회가 0곳인 공정도 count 0으로 싣는다.
    # 거산 공정 전부를 역량 파일 순서로 보낸다.
    process_counts = [
        ProcessCount(
            process_code=row.code,
            process_name=re.sub(r"\s*—\s*가상\s*$", "", row.name),
            count=sum(row.code in codes for codes in codes_by_opportunity.values()),
        )
        for row in processes
    ]
    companies = session.execute(
        select(Opportunity, Customer)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(Opportunity.opp_id.in_(population))
    ).all()
    tab_companies = [
        (opportunity, customer)
        for opportunity, customer in companies
        if process is None or process in codes_by_opportunity.get(opportunity.opp_id, set())
    ]
    industry_counts = [
        IndustryCount(
            industry=name,
            count=sum(name in (customer.industries or []) for _, customer in tab_companies),
        )
        for name in runtime.app_settings.industries
        if any(name in (customer.industries or []) for _, customer in tab_companies)
    ]
    city_counts = Counter(
        city
        for _, customer in tab_companies
        if (city := _address_region(customer.address)) is not None
    )
    presets = runtime.app_settings.list_filters.region_presets
    region_counts = [
        RegionCount(region=preset.label, count=count)
        for preset in presets
        if (count := sum(city_counts[city] for city in set(preset.cities))) > 0
    ] + [
        RegionCount(region=city, count=count)
        for city, count in sorted(city_counts.items(), key=lambda item: (-item[1], item[0]))
    ]
    selected_cities = next(
        (set(preset.cities) for preset in presets if preset.label == region), {region}
    )
    search = q.strip().casefold() if q else ""
    if industry is not None or region is not None or search:
        matching_ids = [
            opportunity.opp_id
            for opportunity, customer in tab_companies
            if (industry is None or industry in (customer.industries or []))
            and (region is None or _address_region(customer.address) in selected_cities)
            and (
                not search
                or any(
                    search in value.casefold()
                    for value in [customer.name, opportunity.item, *(customer.industries or [])]
                )
            )
        ]
        query = query.where(EvaluationRun.opp_id.in_(matching_ids))
    if process is not None:
        query = query.where(
            EvaluationRun.opp_id.in_(
                select(OppProcessLink.opp_id).where(
                    OppProcessLink.process_code == process,
                    OppProcessLink.superseded_at.is_(None),
                )
            )
        )
    if stage is not None:
        current_stage = (
            select(Outcome.status)
            .where(Outcome.opp_id == EvaluationRun.opp_id)
            .order_by(Outcome.version.desc())
            .limit(1)
            .scalar_subquery()
        )
        query = query.where(func.coalesce(current_stage, "NOT_EXECUTED") == stage)
    if opinion is not None:
        # 상세·카드의 최신 의견과 같은 순서(버전, 그다음 저장 시각)로 마지막 행을 본다.
        current_opinion = (
            select(ReviewOpinion.opinion)
            .where(ReviewOpinion.opp_id == EvaluationRun.opp_id)
            .order_by(ReviewOpinion.version.desc(), ReviewOpinion.recorded_at.desc())
            .limit(1)
            .scalar_subquery()
        )
        query = query.where(
            current_opinion.is_(None) if opinion == "NONE" else current_opinion == opinion
        )
    for filter_function in list_filters:
        query = filter_function(session, query, request)
    total = session.scalar(select(func.count()).select_from(query.subquery()))
    rows = []
    for original in session.scalars(query):
        current = latest_confirmed_evaluation(session, original.opp_id)
        opportunity = session.get(Opportunity, original.opp_id)
        customer = session.get(Customer, opportunity.customer_id) if opportunity else None
        if current is None or opportunity is None or customer is None:
            raise RunFailedError("목록의 기회·고객·평가 연결을 확인해 주세요.")
        rows.append((original, current, opportunity, customer))
    rows.sort(key=lambda row: candidate_order(row[0], row[1], row[3], full_batch_id))
    if sort == "recent":
        # 들어온 시각이 최신인 회사를 앞에 두고, 시각이 없는(사례 파일) 회사는 뒤에 둔다.
        # 추천 순으로 먼저 정렬해 두었으므로 같은 시각끼리는 그 순서가 유지된다(안정 정렬).
        rows.sort(key=lambda row: recent_order(row[3]))
    start = (page - 1) * page_size
    cards = []
    for position, (original, current, opportunity, customer) in enumerate(
        rows[start : start + page_size], start=start + 1
    ):
        outcome = latest_outcome(session, opportunity.opp_id)
        cards.append(
            OpportunityCard(
                **discovery_fields(customer),
                ingest_batch_id=customer.ingest_batch_id,
                ingested_at=customer.ingested_at,
                is_new_in_latest_batch=bool(
                    progress and customer.ingest_batch_id == progress.batch_id
                ),
                research_state=research_state(customer, progress),
                score_state=_score_state(
                    current, ai_pending=has_ai_pending_inputs(session, opportunity.opp_id)
                ),
                relation_status=customer.relation_status,
                region=_address_region(customer.address),
                industries=customer.industries or [],
                contact_count=contact_counts(session, opportunity.opp_id).total,
                process_codes=[
                    row.code
                    for row in processes
                    if row.code in codes_by_opportunity.get(opportunity.opp_id, set())
                ],
                opp_id=opportunity.opp_id,
                rank=position
                if (
                    process is not None
                    or industry is not None
                    or region is not None
                    or ingest_batch is not None
                    or sort == "recent"
                    or original.batch_id != full_batch_id
                    or (customer.ingest_batch_id is not None and current.score_s is None)
                )
                else original.original_rank,
                title=f"{customer.name} · {opportunity.item}",
                classification_code=current.classification_code,
                core_evidence_recheck=current.core_evidence_recheck_flag,
                score_s=current.score_s,
                score_display=current.score_display,
                reason=current.reason,
                blocker=Blocker(text=current.blocker_text, blocks_approval=current.blocks_approval),
                next_action=current.next_action,
                records=CardRecords(
                    opinion=opinion_view(latest_opinion(session, opportunity.opp_id)),
                    bookmark=bookmark_view(latest_bookmark(session, opportunity.opp_id)),
                    outcome=CardOutcome(status=outcome.status) if outcome is not None else None,
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
        .where(
            Opportunity.dataset_kind == dataset_kind.value,
            Opportunity.created_at > batch.created_at if batch else True,
            Opportunity.opp_id.not_in(all_population),
        )
    )
    return OpportunityListEnvelope(
        data=cards,
        meta=Meta(
            updated_at=batch.created_at if batch else None,
            latest_ingest=progress,
            has_virtual_data=any(card.is_virtual for card in cards),
            dataset_kind=dataset_kind,
            total=total,
            process_counts=process_counts,
            industry_counts=industry_counts,
            region_counts=region_counts,
            not_evaluated_count=not_evaluated,
        ),
    )
