"""평가 흐름 ⓪: 입력 → 엔진 → 순위 → 기록·공정 상태·질문을 한 번에 저장한다."""

from __future__ import annotations

import logging
import subprocess
from collections import Counter
from contextlib import nullcontext
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan import __version__
from geosan.config.errors import AppError, InputError, RunFailedError
from geosan.config.registry import RuntimeConfig, load_runtime_config
from geosan.evaluation.ledger import (
    create_batch,
    latest_full_batch,
    readiness_reset_reason,
    save_evaluation,
)
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.evaluation.snapshot import Snapshot, build_snapshot, canonical_hash
from geosan.opportunity.models import Opportunity
from geosan.questions.store import upsert_question
from geosan.rules.codes import ClassificationCode, RelationStatus, SortGroup
from geosan.rules.engine import evaluate, rank
from geosan.rules.models import EvaluationOutput, RankInput, SortKey
from geosan.storage.session import session_scope
from geosan.workflows.models import FlowResult

logger = logging.getLogger(__name__)


def today_in_seoul() -> date:
    return datetime.now(timezone(timedelta(hours=9), name="Asia/Seoul")).date()


def resolve_base_date(explicit: date | None, opportunities: list[Opportunity]) -> date:
    if explicit is not None:
        if not isinstance(explicit, date) or isinstance(explicit, datetime):
            raise InputError("평가 기준일은 날짜(YYYY-MM-DD)로 넣어 주세요.")
        return explicit
    if len(opportunities) == 1 and opportunities[0].base_date is not None:
        return opportunities[0].base_date
    return today_in_seoul()


def code_version() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=Path(__file__).resolve().parents[2],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    return f"{__version__}+{result.stdout.strip()}"


def validate_output(snapshot: Snapshot, output: EvaluationOutput) -> None:
    source = snapshot.evaluation_input
    totals = output.totals
    valid = (
        0 <= totals.E <= totals.P <= 100
        and totals.E <= totals.R <= 100
        and totals.E == totals.F + totals.T
        and len(output.items) == len(source.item_inputs)
        and {item.item_code for item in output.items}
        == {item.item_code for item in source.item_inputs}
        and output.sort_key.opp_id == source.opportunity.opp_id
        and {row.req_id for row in output.requirement_checks}
        == {row.req_id for row in source.requirements}
        and len(output.requirement_checks) == len(source.requirements)
        and {row.link_id for row in output.process_link_results}
        == {row.link_id for row in source.process_links}
        and len(output.process_link_results) == len(source.process_links)
    )
    evidence_ids = {row.evidence_id for row in source.evidence}
    capability_ids = {key for item in source.item_inputs for key in item.used_capability_ids}
    valid = valid and all(
        set(item.evidence_ids) <= evidence_ids and set(item.used_capability_ids) <= capability_ids
        for item in output.items
    )
    if not valid:
        raise RunFailedError(
            f"규칙 계산 결과를 확인해 주세요: {source.opportunity.opp_id}",
            next_action="규칙 엔진 담당자에게 기회 ID와 오류 번호를 알려 주세요.",
            kind="RULE_CONFIG",
        )


def _targets(session: Session, opp_ids: list[str] | None) -> list[Opportunity]:
    query = select(Opportunity).order_by(Opportunity.opp_id)
    if opp_ids is not None:
        if not opp_ids:
            raise InputError("평가할 기회 ID를 한 개 이상 넣어 주세요.")
        query = query.where(Opportunity.opp_id.in_(set(opp_ids)))
    rows = list(session.scalars(query))
    if opp_ids is not None and {row.opp_id for row in rows} != set(opp_ids):
        raise InputError("목록에 없는 기회 ID가 있습니다. 평가할 기회를 확인해 주세요.")
    return rows


def _stored_rank_input(
    run: EvaluationRun, *, relation_status: RelationStatus | None = None
) -> RankInput:
    """다른 회사는 점수를 다시 계산하지 않고 마지막 평가의 정렬값만 읽는다."""
    code = ClassificationCode(run.classification_code)
    group = {
        ClassificationCode.CONTACT_URGENT: SortGroup.URGENT,
        ClassificationCode.CONTACT_PLANNED: SortGroup.PLANNED,
        ClassificationCode.CONTACT_REVIEW: SortGroup.REVIEW,
    }.get(code, SortGroup.OTHER)
    return RankInput(
        opp_id=run.opp_id,
        profile=run.profile,
        sort_key=SortKey(
            group=group,
            relation_status=(
                relation_status
                if relation_status is not None
                else run.input_snapshot["opportunity"]["relationStatus"]
            ),
            valid_until=run.valid_until,
            E=run.score_e,
            F=run.score_f,
            direct_confirmed_weight=run.direct_confirmed_weight,
            P=run.score_p,
            R=run.score_r,
            opp_id=run.opp_id,
        ),
    )


def _rank_inputs(inputs: list[RankInput], runtime: RuntimeConfig) -> dict[str, int]:
    ranked = rank(inputs, runtime.app_settings.active_dataset_kind, runtime.rule_config)
    ranks = {row.opp_id: row.original_rank for row in ranked}
    if (
        len(ranked) != len(inputs)
        or set(ranks) != {row.opp_id for row in inputs}
        or sorted(ranks.values()) != list(range(1, len(inputs) + 1))
    ):
        raise RunFailedError("규칙 엔진의 순위 결과를 확인해 주세요.", kind="RULE_CONFIG")
    return ranks


def _population_ranks(
    session: Session,
    batch: EvaluationBatch,
    inputs: list[RankInput],
    runtime: RuntimeConfig,
) -> dict[str, int]:
    """부분 평가도 현재 전체 목록과 최신 평가 양쪽의 순위를 같은 저장 안에서 맞춘다."""
    full = latest_full_batch(session, dataset_kind=batch.dataset_kind)
    if batch.scope == "FULL" or full is None or not inputs:
        return _rank_inputs(inputs, runtime)

    anchors = list(
        session.scalars(select(EvaluationRun).where(EvaluationRun.batch_id == full.batch_id))
    )
    population = {row.opp_id for row in anchors}
    replacements = {row.opp_id: row for row in inputs if row.opp_id in population}
    if not replacements:
        return _rank_inputs(inputs, runtime)

    latest: dict[str, EvaluationRun] = {}
    for row in session.scalars(
        select(EvaluationRun)
        .join(EvaluationBatch, EvaluationRun.batch_id == EvaluationBatch.batch_id)
        .where(
            EvaluationRun.opp_id.in_(population),
            EvaluationRun.profile == "NEW",
            EvaluationRun.run_status == "CONFIRMED",
            EvaluationBatch.status == "CONFIRMED",
            EvaluationBatch.dataset_kind == batch.dataset_kind,
            EvaluationBatch.profile == "NEW",
        )
        .order_by(EvaluationRun.created_at.desc(), EvaluationRun.eval_id.desc())
    ):
        latest.setdefault(row.opp_id, row)
    if population - replacements.keys() - latest.keys():
        raise RunFailedError("목록의 최신 평가를 확인할 수 없습니다.")
    customer_ids = dict(
        session.execute(
            select(Opportunity.opp_id, Opportunity.customer_id).where(
                Opportunity.opp_id.in_(population)
            )
        ).all()
    )
    # 거래 관계는 회사 단위다. 같은 회사의 다른 기회도 이번에 확인한 상태로 정렬하되
    # 그 기회의 점수·분류·평가 번호·입력 스냅샷은 다시 계산하거나 덮어쓰지 않는다.
    updated_relations = {
        customer_ids[opp_id]: row.sort_key.relation_status for opp_id, row in replacements.items()
    }
    ranks = _rank_inputs(
        [
            replacements[opp_id]
            if opp_id in replacements
            else _stored_rank_input(
                latest[opp_id], relation_status=updated_relations.get(customer_ids[opp_id])
            )
            for opp_id in sorted(population)
        ],
        runtime,
    )
    # 목록 API가 사용하는 현재 전체 평가의 순위도 맞춘다. 이전 전체 이력은 보존한다.
    for row in anchors:
        row.original_rank = ranks[row.opp_id]
    for row in latest.values():
        row.original_rank = ranks[row.opp_id]

    # 전체 평가 뒤 추가된 회사는 다음 전체 평가 전까지 기존 목록에 섞지 않는다.
    outside = [row for row in inputs if row.opp_id not in population]
    return ranks | _rank_inputs(outside, runtime)


def run_evaluation(
    opp_ids: list[str] | None = None,
    base_date: date | None = None,
    requested_by: str = "system",
) -> FlowResult:
    return _run_evaluation(opp_ids, base_date, requested_by)


def evaluate_in_session(
    session: Session, opp_ids: list[str] | None, requested_by: str
) -> FlowResult:
    """흐름 ①·②의 저장과 평가를 함께 확정한다. None이면 목록용 전체 평가를 만든다."""
    return _run_evaluation(opp_ids, None, requested_by, session)


def _run_evaluation(
    opp_ids: list[str] | None,
    base_date: date | None,
    requested_by: str,
    shared_session: Session | None = None,
) -> FlowResult:
    failed_batch = None
    try:
        skipped = []
        runs = []
        with (
            nullcontext(shared_session)
            if shared_session is not None
            else session_scope() as session
        ):
            runtime = load_runtime_config(session)
            targets = _targets(session, opp_ids)
            batch = create_batch(
                session,
                runtime,
                base_date=resolve_base_date(base_date, targets),
                opp_ids=sorted(set(opp_ids)) if opp_ids is not None else None,
                code_version=code_version(),
                requested_by=requested_by,
            )
            # 실패 기록은 원래 트랜잭션을 되돌린 뒤 같은 묶음 ID로 별도 저장한다.
            failed_batch = {
                column.name: getattr(batch, column.name)
                for column in EvaluationBatch.__table__.columns
            }
            computed = []
            for opportunity in targets:
                snapshot = build_snapshot(
                    session,
                    opportunity.opp_id,
                    base_date=batch.base_date,
                    dataset_kind=batch.dataset_kind,
                    rule_config=runtime.rule_config,
                )
                if snapshot is None:
                    skipped.append(f"{opportunity.opp_id}: 항목 입력 없음")
                    continue
                output = EvaluationOutput.model_validate(evaluate(snapshot.evaluation_input))
                validate_output(snapshot, output)
                reset_reason = readiness_reset_reason(session, snapshot, output)
                if reset_reason:
                    snapshot.evaluation_input.readiness_check = None
                    snapshot.document["readinessCheck"] = None
                    snapshot.snapshot_hash = canonical_hash(snapshot.document)
                    output = EvaluationOutput.model_validate(evaluate(snapshot.evaluation_input))
                    validate_output(snapshot, output)
                computed.append((snapshot, output, reset_reason))
            ranks = _population_ranks(
                session,
                batch,
                [
                    RankInput(
                        opp_id=output.sort_key.opp_id, profile="NEW", sort_key=output.sort_key
                    )
                    for _, output, _ in computed
                ],
                runtime,
            )
            for snapshot, output, reset_reason in computed:
                run = save_evaluation(
                    session,
                    batch,
                    snapshot,
                    output,
                    original_rank=ranks[output.sort_key.opp_id],
                    requested_by=requested_by,
                    reset_reason=reset_reason,
                )
                for candidate in output.question_candidates:
                    upsert_question(
                        session,
                        candidate,
                        run.opp_id,
                        run.eval_id,
                        dataset_kind=batch.dataset_kind,
                        is_virtual=batch.is_virtual,
                        requested_by=requested_by,
                    )
                runs.append(run)
            batch.status = "CONFIRMED"
            counts = Counter(run.classification_code for run in runs)
            classifications = ", ".join(
                f"{runtime.rule_config.classification_labels[key]} {count}"
                for key, count in sorted(counts.items())
            )
            summary = f"묶음 {batch.batch_id}, 기회 {len(runs)}건"
            if classifications:
                summary += f", {classifications}"
            if skipped:
                summary += "; 건너뜀: " + ", ".join(skipped)
        return FlowResult(
            ok=True,
            affected_opp_ids=[run.opp_id for run in runs],
            new_eval_ids=[run.eval_id for run in runs],
            summary=summary,
        )
    except Exception as exc:
        error = exc if isinstance(exc, AppError) else RunFailedError("평가를 저장하지 못했습니다.")
        logger.error("평가 실패: ref=%s type=%s", error.ref, type(exc).__name__)
        if shared_session is not None:
            raise error from None
        if failed_batch is not None:
            try:
                with session_scope() as session:
                    session.add(EvaluationBatch(**{**failed_batch, "status": "FAILED"}))
            except Exception as record_error:
                logger.error(
                    "실패 묶음 기록도 저장하지 못함: ref=%s type=%s",
                    error.ref,
                    type(record_error).__name__,
                )
                return FlowResult.failed(
                    RunFailedError("평가를 되돌렸지만 실패 묶음 기록도 저장하지 못했습니다.")
                )
        return FlowResult.failed(error)
