"""저장된 수집 회차와 회사의 후보 찾기 정보를 응답에 연결한다."""

from decimal import Decimal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from geosan.api.schemas import FactoryProfile, LatestIngest
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import EvaluationRun
from geosan.evidence.transfer import TransferLog, accounted_cost
from geosan.opportunity.models import Customer, IngestBatch, Opportunity


def latest_ingest(session: Session, dataset_kind: str) -> LatestIngest | None:
    row = session.scalar(
        select(IngestBatch)
        .where(IngestBatch.dataset_kind == dataset_kind)
        .order_by(IngestBatch.started_at.desc(), IngestBatch.batch_id.desc())
        .limit(1)
    )
    if row is None:
        return None
    fields = {name: getattr(row, name) for name in LatestIngest.model_fields if hasattr(row, name)}
    return LatestIngest.model_validate({**fields, "actual_usd": _actual_usd(session, row)})


def _actual_usd(session: Session, batch: IngestBatch) -> float:
    """회차에 붙은 전송 기록 + 그 회차로 들어온 회사의 자동 조사 기록의 비용 합(C1 #549).

    자동 조사는 회차가 도는 동안(시작~끝 시각) 그 회사에 생긴 기록으로 가린다. 끝난 뒤
    담당자가 누른 [다시 조사]는 넣지 않는다. 사용량을 못 받은 호출은 설정의 추정 비용으로 친다.
    """
    settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
    new_opps = (
        select(Opportunity.opp_id)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .where(Customer.ingest_batch_id == batch.batch_id)
    )
    research = [TransferLog.opp_id.in_(new_opps), TransferLog.occurred_at >= batch.started_at]
    if batch.finished_at is not None:
        research.append(TransferLog.occurred_at <= batch.finished_at)
    rows = session.scalars(
        select(TransferLog).where(
            TransferLog.purpose.in_(["EXTERNAL_SEARCH", "EXTERNAL_AI"]),
            TransferLog.call_count > 0,
            or_(TransferLog.batch_id == batch.batch_id, and_(*research)),
        )
    ).all()
    total = sum((accounted_cost(item, settings.llm) for item in rows), Decimal(0))
    return float(round(total, 6))


def factory_profile(customer: Customer) -> FactoryProfile | None:
    """회사에 붙여 둔 팩토리온 공장 정보(#573). 기준일이 없으면 붙은 공장이 없다."""
    if customer.factory_profile_date is None:
        return None
    return FactoryProfile(
        raw_materials=customer.factory_raw_materials,
        employee_count=customer.factory_employee_count,
        scale=customer.factory_scale,
        file_date=customer.factory_profile_date,
    )


def research_state(
    customer: Customer, progress: LatestIngest | None, *, scored: bool
) -> str | None:
    """점수가 아직 없는 찾은 회사의 조사 상태(#596). 점수가 있거나 사례 파일 회사면 None.

    카드는 RUNNING이면 "조사 중", 나머지는 "조사 중단"만 보이고, 상세가 이유를 보인다.
    "조사 중"은 목록 머리의 "조사 n/m" 진행 표시와 같은 기준(마지막 찾기 회차의 수)을 쓴다.
    """
    if scored or customer.ingest_batch_id is None:
        return None
    if (
        progress is not None
        and customer.ingest_batch_id == progress.batch_id
        and (
            progress.status == "RUNNING"
            or (progress.status == "DONE" and progress.research_done_count < progress.new_count)
        )
    ):
        return "RUNNING"
    if customer.researched_at is not None:
        return "NO_SCORE_EVIDENCE"
    if customer.homepage_status == "NOT_FOUND":
        return "NOT_FOUND"
    if customer.homepage_url:
        return "READ_FAILED"
    return "NOT_TRIED"


def discovery_fields(customer: Customer) -> dict:
    return {
        **{
            name: getattr(customer, name)
            for name in (
                "discovery_source",
                "discovery_source_url",
                "registry_status",
                "fit_level",
                "pick_reason",
                "own_plating_line_suspected",
                "own_plating_line_basis",
            )
        },
        "factory_profile": factory_profile(customer),
    }


def collected_evaluations(
    session: Session, dataset_kind: str, full_batch_id: str | None
) -> list[str]:
    """전체 평가 뒤 추가된 후보도 실제 확정 평가를 사용해 표시한다."""
    # 평가 전 회사에는 가짜 평가 번호·점수를 주지 않고 기존 미평가 건수에 남긴다.
    rows = session.scalars(
        select(Opportunity)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(
            Opportunity.dataset_kind == dataset_kind,
            Customer.dataset_kind == dataset_kind,
            Customer.ingest_batch_id.is_not(None),
        )
    )
    full_ids = (
        set(
            session.scalars(
                select(EvaluationRun.opp_id).where(EvaluationRun.batch_id == full_batch_id)
            )
        )
        if full_batch_id
        else set()
    )
    runs = []
    for opportunity in rows:
        if opportunity.opp_id in full_ids:
            continue
        run = latest_confirmed_evaluation(session, opportunity.opp_id)
        if run is not None and run.batch_id != full_batch_id:
            runs.append(run.eval_id)
    return runs


def candidate_order(
    original: EvaluationRun,
    current: EvaluationRun,
    customer: Customer,
    full_batch_id: str | None,
) -> tuple:
    """기존 순위를 지키고 점수 전 수집 후보만 적합도와 들어온 순서로 놓는다."""
    if customer.ingest_batch_id is not None and current.score_s is None:
        return (
            1,
            customer.own_plating_line_suspected,
            ("HIGH", "MEDIUM", "LOW", None).index(customer.fit_level),
            customer.ingested_at or customer.created_at,
            customer.created_at,
            original.opp_id,
        )
    return (0, original.batch_id != full_batch_id, original.original_rank or 0, original.opp_id)


def recent_order(customer: Customer) -> tuple:
    """최근 들어온 순(#516): 들어온 시각이 최신인 회사가 앞, 시각이 없는 사례 파일 회사는 뒤."""
    if customer.ingested_at is None:
        return (1, 0.0)
    return (0, -customer.ingested_at.timestamp())
