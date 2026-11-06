"""규칙 엔진의 약속된 진입점. 모든 계산은 입력 스냅샷에만 의존한다 (BR4.8, C3)."""

from geosan.rules.classify import classify, display_texts
from geosan.rules.codes import ClassificationCode, CoreEvidenceMet, DatasetKind
from geosan.rules.items import calculate_items
from geosan.rules.models import (
    DisplayFlags,
    EvaluationInput,
    EvaluationOutput,
    RankInput,
    RankOutput,
    RuleConfig,
)
from geosan.rules.questions import question_candidates
from geosan.rules.rank import build_sort_key, rank_outputs
from geosan.rules.requirements import assess_requirements
from geosan.rules.timing import core_evidence, research_missing, timing_requirements
from geosan.rules.totals import calculate_totals


def evaluate(evaluation_input: EvaluationInput) -> EvaluationOutput:
    """요구·점수·시점·분류·질문을 계산한다. 입력 변경이나 저장을 하지 않는다 (BR4.8)."""
    data = evaluation_input
    assessment = assess_requirements(data)
    items = calculate_items(data)
    totals = calculate_totals(items, data.rule_config)
    core = core_evidence(data, items)
    timing = timing_requirements(data)
    missing = research_missing(data)
    code = classify(data, assessment.filter_state, totals, core, timing, not missing)
    return EvaluationOutput(
        requirement_checks=assessment.requirement_checks,
        filter_state=assessment.filter_state,
        exclusion_scope=assessment.exclusion_scope,
        process_link_results=assessment.process_link_results,
        items=items,
        totals=totals,
        core_evidence_met=core,
        timing=timing,
        research_ready=not missing,
        classification_code=code,
        score_state=(
            "NONE"
            if totals.S is None
            else "PENDING"
            if code in {ClassificationCode.FILTER_PENDING, ClassificationCode.OPS_PENDING}
            else "CONFIRMED"
        ),
        display_flags=DisplayFlags(
            core_evidence_recheck=core == CoreEvidenceMet.RECHECK,
            brochure_dataset=data.dataset_kind == DatasetKind.BROCHURE,
        ),
        sort_key=build_sort_key(data, code, items, totals),
        question_candidates=question_candidates(data, items, assessment.requirement_checks),
        display=display_texts(data, code, assessment, totals, core, missing),
    )


def rank(
    outputs: list[RankInput], dataset_kind: DatasetKind, rule_config: RuleConfig
) -> list[RankOutput]:
    """같은 프로필의 평가에 원래 순위를 매긴다 (BR6.4, BR6.5, C3)."""
    return rank_outputs(outputs, dataset_kind, rule_config)
