"""평가 흐름 ⓪: 입력 → 엔진 → 순위 → 기록·공정 상태·질문을 한 번에 저장한다."""

from __future__ import annotations

import logging
import os
import re
import subprocess
from collections import Counter
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan import __version__
from geosan.config.errors import AppError, InputError, RunFailedError
from geosan.config.registry import RuntimeConfig, load_runtime_config
from geosan.evaluation.inputs import has_ai_pending_inputs
from geosan.evaluation.ledger import (
    create_batch,
    latest_full_batch,
    readiness_reset_reason,
    save_evaluation,
)
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.evaluation.snapshot import Snapshot, build_snapshot, canonical_hash
from geosan.opportunity.models import Customer, Opportunity
from geosan.questions.store import upsert_question
from geosan.rules.codes import ClassificationCode, RelationStatus, SortGroup
from geosan.rules.engine import evaluate, rank
from geosan.rules.models import EvaluationOutput, RankInput, SortKey
from geosan.storage.session import session_scope
from geosan.workflows.models import FlowResult

logger = logging.getLogger(__name__)


def _not_evaluated_output(snapshot: Snapshot, customer: Customer) -> EvaluationOutput:
    """PM #440: 실제 입력 없는 수집 후보는 점수 없이 평가 전 기록만 남긴다."""
    output = EvaluationOutput.model_validate(evaluate(snapshot.evaluation_input))
    if output.totals.S is not None or any(row.score is not None for row in output.items):
        raise RunFailedError("점수 입력 전 후보의 평가 결과를 확인해 주세요.")
    # 입력 행은 만들지 않는다. 누락 항목의 미확보 판정·합계는 기존 엔진 결과 그대로다.
    output.question_candidates = []
    output.classification_code = ClassificationCode.NOT_EVALUATED
    output.score_state = "NONE"
    output.sort_key.group = SortGroup.OTHER
    output.display.reason = customer.pick_reason or ""
    output.display.blocker_text = "점수 입력 전 · 필수조건 확인 전"
    output.display.blocks_approval = True
    output.display.score_display = "--"
    output.display.next_action = "AI 조사 결과 확인 뒤 점수 입력"
    return output


def _evaluate_snapshot(session, snapshot: Snapshot, customer: Customer) -> EvaluationOutput:
    """입력 없는 수집 후보는 평가 전 기록, 있으면 규칙 엔진.

    AI 제안(확인 전)으로 계산한 점수는 PENDING으로 표시한다(#286).
    """
    if not snapshot.evaluation_input.item_inputs:
        return _not_evaluated_output(snapshot, customer)
    output = EvaluationOutput.model_validate(evaluate(snapshot.evaluation_input))
    if output.score_state == "CONFIRMED" and has_ai_pending_inputs(
        session, snapshot.evaluation_input.opportunity.opp_id
    ):
        output.score_state = "PENDING"
    return output


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


# 배포 서비스가 커밋 번호를 알려 주는 환경 변수 이름. 앞의 것이 먼저다(#719).
# GEOSAN_CODE_VERSION은 우리 이름(운영자가 직접 정함), 뒤는 Railway가 준다고 알려진 이름이다.
CODE_VERSION_ENV_NAMES = ("GEOSAN_CODE_VERSION", "RAILWAY_GIT_COMMIT_SHA")
# 평가 기록의 버전 칸(80자)에 "패키지 버전+값"이 들어가도록 값의 길이를 묶는다.
CODE_VERSION_MAX_LENGTH = 40
_CODE_VERSION_VALUE = re.compile(rf"[0-9A-Za-z._-]{{1,{CODE_VERSION_MAX_LENGTH}}}")
# 커밋 번호를 알 수 없을 때 버전 값에 붙는 표시. 숨기지 않고 값에 드러낸다.
NO_COMMIT_MARK = "nogit"


@dataclass(frozen=True)
class CodeVersion:
    """평가 기록에 적을 코드 버전과 그 값을 어디서 얻었는지(ENV·GIT·FALLBACK)."""

    value: str
    source: str
    refused: list[str] = field(default_factory=list)


def resolve_code_version() -> CodeVersion:
    """코드 버전을 ① 환경 변수 ② git 정보 ③ 패키지 버전 + "커밋 번호 없음" 순서로 구한다(#719).

    git 정보가 없는 환경(저장소 사본·배포 서버)에서도 평가는 저장돼야 한다. 버전을 모르는 채로
    저장하되 그 사실이 값(`0.1.0+nogit`)에 남는다. 환경 변수 값이 영문·숫자·`.`·`_`·`-` 40자
    이내가 아니면(공백·줄바꿈·너무 긴 값) 그 값은 쓰지 않고 `refused`에 이름만 남긴다.
    """
    refused: list[str] = []
    for name in CODE_VERSION_ENV_NAMES:
        raw = os.environ.get(name, "").strip()
        if not raw:
            continue
        if _CODE_VERSION_VALUE.fullmatch(raw):
            return CodeVersion(f"{__version__}+{raw}", "ENV", refused)
        refused.append(name)
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[2],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        commit = result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        # git 명령이 없거나 git 정보가 없는 폴더다. 아래 대체 값으로 적는다.
        commit = ""
    if commit and _CODE_VERSION_VALUE.fullmatch(commit):
        return CodeVersion(f"{__version__}+{commit}", "GIT", refused)
    return CodeVersion(f"{__version__}+{NO_COMMIT_MARK}", "FALLBACK", refused)


def code_version() -> str:
    return resolve_code_version().value


def validate_output(snapshot: Snapshot, output: EvaluationOutput) -> None:
    source = snapshot.evaluation_input
    totals = output.totals
    expected_items = source.item_inputs
    if not expected_items and output.classification_code == ClassificationCode.NOT_EVALUATED:
        expected_items = source.rule_config.new_profile_items
        if (
            output.score_state != "NONE"
            or totals.S is not None
            or any(row.state != "UNAVAILABLE" or row.score is not None for row in output.items)
        ):
            raise RunFailedError("점수 입력 전 후보의 항목 판정을 확인해 주세요.")
    valid = (
        0 <= totals.E <= totals.P <= 100
        and totals.E <= totals.R <= 100
        and totals.E == totals.F + totals.T
        and len(output.items) == len(expected_items)
        and {item.item_code for item in output.items} == {item.item_code for item in expected_items}
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
    relations = dict(
        session.execute(
            select(Opportunity.opp_id, Customer.relation_status)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_(population))
        ).all()
    )
    if population - relations.keys():
        raise RunFailedError("목록의 현재 거래 관계를 확인할 수 없습니다.")
    # 거래 관계는 회사의 현재 값이다. 옛 평가 입력으로 되돌리지 않는다.
    # 목록 밖의 기회에서 바꾼 관계도 같은 회사의 기존 카드 정렬에 반영한다.
    # 점수·분류·평가 번호·입력 스냅샷은 다시 계산하거나 덮어쓰지 않는다.
    ranks = _rank_inputs(
        [
            replacements[opp_id]
            if opp_id in replacements
            else _stored_rank_input(
                latest[opp_id], relation_status=RelationStatus(relations[opp_id])
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
                customer = session.get(Customer, opportunity.customer_id)
                snapshot = build_snapshot(
                    session,
                    opportunity.opp_id,
                    base_date=batch.base_date,
                    dataset_kind=batch.dataset_kind,
                    rule_config=runtime.rule_config,
                    allow_empty_inputs=bool(customer and customer.ingest_batch_id is not None),
                )
                if snapshot is None:
                    skipped.append(f"{opportunity.opp_id}: 항목 입력 없음")
                    continue
                output = _evaluate_snapshot(session, snapshot, customer)
                validate_output(snapshot, output)
                reset_reason = readiness_reset_reason(session, snapshot, output)
                if reset_reason:
                    snapshot.evaluation_input.readiness_check = None
                    snapshot.document["readinessCheck"] = None
                    snapshot.snapshot_hash = canonical_hash(snapshot.document)
                    output = _evaluate_snapshot(session, snapshot, customer)
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
