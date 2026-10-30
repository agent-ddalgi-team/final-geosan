"""평가 기록을 새 행으로 보관하고 현재 공정 결과와 기한 체크를 갱신한다."""

from __future__ import annotations

from datetime import date

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from geosan.config.errors import InputError
from geosan.config.registry import RuntimeConfig
from geosan.evaluation.inputs import current_readiness_check
from geosan.evaluation.models import (
    EvaluationBatch,
    EvaluationRun,
    ItemJudgment,
    JudgmentEvidence,
    RequirementCheck,
)
from geosan.evaluation.snapshot import Snapshot, canonical_hash
from geosan.opportunity.models import OppProcessLink
from geosan.rules.models import EvaluationOutput
from geosan.storage.base import new_id, utcnow


def create_batch(
    session: Session,
    runtime: RuntimeConfig,
    *,
    base_date: date,
    opp_ids: list[str] | None,
    code_version: str,
    requested_by: str,
) -> EvaluationBatch:
    dataset_kind = runtime.app_settings.active_dataset_kind.value
    batch = EvaluationBatch(
        batch_id=new_id("batch"),
        profile="NEW",
        scope="FULL" if opp_ids is None else "PARTIAL",
        base_date=base_date,
        rule_version=runtime.rule_version.rule_version,
        rule_hash=runtime.rule_version.rule_hash,
        code_version=code_version,
        llm_mode="NONE",
        population_spec="ALL" if opp_ids is None else list(opp_ids),
        status="RUNNING",
        sort_rule="brochureOther=E_FIRST" if dataset_kind == "BROCHURE" else "default",
        dataset_kind=dataset_kind,
        is_virtual=dataset_kind == "VIRTUAL_REVIEWED",
        created_by=requested_by,
    )
    session.add(batch)
    session.flush()
    return batch


def latest_full_batch(session: Session, *, dataset_kind: str) -> EvaluationBatch | None:
    return session.scalar(
        select(EvaluationBatch)
        .where(
            EvaluationBatch.scope == "FULL",
            EvaluationBatch.profile == "NEW",
            EvaluationBatch.status == "CONFIRMED",
            EvaluationBatch.dataset_kind == dataset_kind,
        )
        .order_by(EvaluationBatch.created_at.desc(), EvaluationBatch.batch_id.desc())
    )


def latest_confirmed_evaluation(session: Session, opp_id: str) -> EvaluationRun | None:
    return session.scalar(
        select(EvaluationRun)
        .join(EvaluationBatch, EvaluationRun.batch_id == EvaluationBatch.batch_id)
        .where(
            EvaluationRun.opp_id == opp_id,
            EvaluationRun.run_status == "CONFIRMED",
            EvaluationBatch.status == "CONFIRMED",
        )
        .order_by(EvaluationRun.created_at.desc(), EvaluationRun.eval_id.desc())
    )


def reusable_partial_evaluation(
    session: Session, snapshot: Snapshot, runtime: RuntimeConfig
) -> EvaluationRun | None:
    """동일 입력으로 확정한 부분 평가를 비교용으로 찾는다. 최신 상태는 바꾸지 않는다."""
    same_input = EvaluationRun.snapshot_hash == snapshot.snapshot_hash
    readiness = snapshot.document.get("readinessCheck")
    if readiness and readiness.get("evalIdAtCheck"):
        # BR7.4: 최초 저장 후 자동 연결된 자기 평가 ID만 이전 입력과 동일하게 취급한다.
        # 다른 입력과 실제 체크 변경은 그대로 해시에 남고, 저장된 원본 해시는 수정하지 않는다.
        before_anchor = snapshot.document | {"readinessCheck": readiness | {"evalIdAtCheck": None}}
        same_input = or_(
            same_input,
            and_(
                EvaluationRun.eval_id == readiness["evalIdAtCheck"],
                EvaluationRun.snapshot_hash == canonical_hash(before_anchor),
            ),
        )
    return session.scalar(
        select(EvaluationRun)
        .join(EvaluationBatch, EvaluationRun.batch_id == EvaluationBatch.batch_id)
        .where(
            EvaluationRun.opp_id == snapshot.evaluation_input.opportunity.opp_id,
            EvaluationRun.profile == "NEW",
            EvaluationRun.run_status.in_(("CONFIRMED", "SUPERSEDED")),
            EvaluationRun.capability_version == snapshot.capability_version,
            same_input,
            EvaluationBatch.scope == "PARTIAL",
            EvaluationBatch.profile == "NEW",
            EvaluationBatch.status == "CONFIRMED",
            EvaluationBatch.base_date == snapshot.evaluation_input.base_date,
            EvaluationBatch.rule_version == runtime.rule_version.rule_version,
            EvaluationBatch.rule_hash == runtime.rule_version.rule_hash,
            EvaluationBatch.dataset_kind == runtime.app_settings.active_dataset_kind.value,
        )
        .order_by(EvaluationRun.created_at.desc(), EvaluationRun.eval_id.desc())
    )


def _action_deadlines(document: dict) -> list[tuple]:
    """BR5.2의 직접 확인 행동 신호만 비교한다. 재투입 때 바뀌는 행 ID는 비교하지 않는다."""
    base = date.fromisoformat(document["baseDate"])
    candidates = []
    for row in document["signals"]:
        if (
            row["signalKind"] not in {"BID", "NEW_ORDER", "NEXT_CONTACT"}
            or row["relation"] != "DIRECT"
            or row["certainty"] != "CONFIRMED"
        ):
            continue
        if row["signalKind"] == "BID" and (
            row["deadlineAt"] is None
            or date.fromisoformat(row["deadlineAt"]) < base
            or row["progressStatus"] in {"CLOSED", "CANCELLED"}
        ):
            continue
        candidates.append((row["signalKind"], row["deadlineAt"]))
    return sorted(candidates, key=repr)


def _required_now_results(document: dict, results: dict[str, str]) -> list[tuple]:
    links = {row["linkId"]: row["processCode"] for row in document["processLinks"]}
    return sorted(
        (
            row["reqKind"],
            row["name"],
            row["scopeKind"],
            links.get(row["linkId"], ""),
            results[row["reqId"]],
        )
        for row in document["requirements"]
        if row["reqLevel"] == "REQUIRED" and row["neededStage"] == "NOW"
    )


def readiness_reset_reason(
    session: Session, snapshot: Snapshot, output: EvaluationOutput
) -> str | None:
    opp_id = snapshot.evaluation_input.opportunity.opp_id
    check = current_readiness_check(session, opp_id)
    if check is None or check.eval_id_at_check is None:
        return None
    previous = session.get(EvaluationRun, check.eval_id_at_check)
    if previous is None or previous.opp_id != opp_id:
        raise InputError("기한 체크의 이전 평가 연결을 확인해 주세요.")
    if _action_deadlines(previous.input_snapshot) != _action_deadlines(snapshot.document):
        return "행동 신호의 마감일이 바뀌어 다시 확인해 주세요."
    old_results = {
        row.req_id: row.result
        for row in session.scalars(
            select(RequirementCheck).where(RequirementCheck.eval_id == previous.eval_id)
        )
    }
    new_results = {row.req_id: row.result.value for row in output.requirement_checks}
    if _required_now_results(previous.input_snapshot, old_results) != _required_now_results(
        snapshot.document, new_results
    ):
        return "지금 단계의 필수 요구 판정이 바뀌어 다시 확인해 주세요."
    return None


def save_evaluation(
    session: Session,
    batch: EvaluationBatch,
    snapshot: Snapshot,
    output: EvaluationOutput,
    *,
    original_rank: int,
    requested_by: str,
    reset_reason: str | None = None,
) -> EvaluationRun:
    """커밋은 호출한 흐름이 한다. 중간 저장 실패는 호출자까지 전달한다."""
    opp_id = snapshot.evaluation_input.opportunity.opp_id
    previous = latest_confirmed_evaluation(session, opp_id)
    common = dict(
        dataset_kind=batch.dataset_kind,
        is_virtual=batch.is_virtual,
        created_by=requested_by,
    )
    run = EvaluationRun(
        eval_id=new_id("eval"),
        batch_id=batch.batch_id,
        opp_id=opp_id,
        profile="NEW",
        run_status="CONFIRMED",
        input_snapshot=snapshot.document,
        snapshot_hash=snapshot.snapshot_hash,
        capability_version=snapshot.capability_version,
        filter_state=output.filter_state.value,
        exclusion_scope=output.exclusion_scope.value if output.exclusion_scope else None,
        core_evidence_met=output.core_evidence_met.value,
        operational_ready=snapshot.evaluation_input.operational_ready,
        timing_requirements=output.timing.model_dump(mode="json", by_alias=True),
        research_ready=output.research_ready,
        score_e=output.totals.E,
        score_f=output.totals.F,
        score_t=output.totals.T,
        score_p=output.totals.P,
        score_r=output.totals.R,
        score_s=output.totals.S,
        completion_c=output.totals.C,
        classification_code=output.classification_code.value,
        core_evidence_recheck_flag=output.display_flags.core_evidence_recheck,
        direct_confirmed_weight=output.sort_key.direct_confirmed_weight,
        valid_until=output.sort_key.valid_until,
        original_rank=original_rank,
        previous_eval_id=previous.eval_id if previous else None,
        **output.display.model_dump(),
        **common,
    )
    if previous:
        previous.run_status = "SUPERSEDED"
    session.add(run)
    session.flush()
    for item in output.items:
        judgment = ItemJudgment(
            judgment_id=new_id("judgment"),
            eval_id=run.eval_id,
            **item.model_dump(exclude={"evidence_ids"}, mode="json"),
            **common,
        )
        session.add(judgment)
        session.flush()
        for evidence_id in sorted(set(item.evidence_ids)):
            session.add(
                JudgmentEvidence(
                    judgment_evidence_id=new_id("je"),
                    judgment_id=judgment.judgment_id,
                    evidence_id=evidence_id,
                    relation_type="SUPPORTS",
                    **common,
                )
            )
    for check in output.requirement_checks:
        session.add(
            RequirementCheck(
                check_id=new_id("check"),
                eval_id=run.eval_id,
                base_date=batch.base_date,
                **check.model_dump(mode="python"),
                **common,
            )
        )
    readiness = current_readiness_check(session, opp_id)
    if readiness is not None:
        if reset_reason:
            readiness.reset_reason = reset_reason
            readiness.reset_at = utcnow()
        elif readiness.eval_id_at_check is None:
            readiness.eval_id_at_check = run.eval_id
    for result in output.process_link_results:
        link = session.get(OppProcessLink, result.link_id)
        if link is None or link.opp_id != opp_id or link.superseded_at is not None:
            raise InputError("평가 결과의 공정 연결을 확인해 주세요.")
        link.current_result = result.result.value
        link.current_reason = result.reason
        link.source_eval_id = run.eval_id
    session.flush()
    return run
