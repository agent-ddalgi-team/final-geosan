"""평가 흐름 ⓪: 입력 → 엔진 → 순위 → 기록·공정 상태·질문을 한 번에 저장한다."""

from __future__ import annotations

import logging
import subprocess
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan import __version__
from geosan.config.errors import AppError, InputError, RunFailedError
from geosan.config.registry import load_runtime_config
from geosan.evaluation.ledger import create_batch, readiness_reset_reason, save_evaluation
from geosan.evaluation.models import EvaluationBatch
from geosan.evaluation.snapshot import Snapshot, build_snapshot, canonical_hash
from geosan.opportunity.models import Opportunity
from geosan.questions.store import upsert_question
from geosan.rules.models import EvaluationOutput, RankInput
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


def engine_functions():
    """개발용 엔진은 명시적으로만 선택한다. 실제 엔진의 실행 실패를 가짜로 대체하지 않는다."""
    from importlib.util import find_spec

    if find_spec("geosan.rules.engine") is not None:
        from geosan.rules.engine import evaluate, rank

        return evaluate, rank, False
    from tests.fakes.fake_engine import evaluate, rank

    return evaluate, rank, True


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


def run_evaluation(
    opp_ids: list[str] | None = None,
    base_date: date | None = None,
    requested_by: str = "system",
) -> FlowResult:
    failed_batch = None
    try:
        evaluate, rank, using_fake = engine_functions()
        skipped = []
        runs = []
        with session_scope() as session:
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
            ranked = rank(
                [
                    RankInput(
                        opp_id=output.sort_key.opp_id, profile="NEW", sort_key=output.sort_key
                    )
                    for _, output, _ in computed
                ],
                runtime.app_settings.active_dataset_kind,
                runtime.rule_config,
            )
            ranks = {row.opp_id: row.original_rank for row in ranked}
            if (
                len(ranked) != len(computed)
                or set(ranks) != {output.sort_key.opp_id for _, output, _ in computed}
                or sorted(ranks.values()) != list(range(1, len(computed) + 1))
            ):
                raise RunFailedError("규칙 엔진의 순위 결과를 확인해 주세요.", kind="RULE_CONFIG")
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
            if using_fake:
                summary += "; 개발용 가짜 엔진 결과(실제 규칙 계산 미검증)"
        return FlowResult(
            ok=True,
            affected_opp_ids=[run.opp_id for run in runs],
            new_eval_ids=[run.eval_id for run in runs],
            summary=summary,
        )
    except Exception as exc:
        error = exc if isinstance(exc, AppError) else RunFailedError("평가를 저장하지 못했습니다.")
        logger.error("평가 실패: ref=%s type=%s", error.ref, type(exc).__name__)
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
