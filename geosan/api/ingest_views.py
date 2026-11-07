"""저장된 수집 회차와 회사의 후보 찾기 정보를 응답에 연결한다."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.schemas import LatestIngest
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.models import Customer, IngestBatch, Opportunity


def latest_ingest(session: Session, dataset_kind: str) -> LatestIngest | None:
    row = session.scalar(
        select(IngestBatch)
        .where(IngestBatch.dataset_kind == dataset_kind)
        .order_by(IngestBatch.started_at.desc(), IngestBatch.batch_id.desc())
        .limit(1)
    )
    return LatestIngest.model_validate(row, from_attributes=True) if row else None


def discovery_fields(customer: Customer) -> dict:
    return {
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
