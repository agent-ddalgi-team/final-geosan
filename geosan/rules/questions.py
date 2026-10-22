"""사용한 거산 값과 요구의 미확인 사항에 대한 질문 후보 (BR8.1~8.2)."""

from geosan.rules.codes import QuestionTargetKind as Kind
from geosan.rules.codes import ReviewStatus
from geosan.rules.models import (
    EvaluationInput,
    ItemJudgmentOutput,
    QuestionCandidate,
    RequirementCheckOutput,
)


def question_candidates(
    data: EvaluationInput, items: list[ItemJudgmentOutput], checks: list[RequirementCheckOutput]
) -> list[QuestionCandidate]:
    """대상별 질문 하나만 만들고 검수 완료한 미사용 값에는 질문을 만들지 않는다 (BR8.1~8.2)."""
    values = {}
    for process in data.capability.processes:
        values[process.process_id] = (Kind.PROCESS, process.code, process.review_status)
    for cap in data.capability.capabilities:
        values[cap.capability_id] = (Kind.CAPABILITY, cap.name, cap.review_status)
    for record in data.capability.delivery_records:
        values[record.record_id] = (
            Kind.FIELD,
            record.part_type or record.industry,
            record.review_status,
        )
    for qual in data.capability.qualifications:
        values[qual.qual_id] = (Kind.QUALIFICATION, qual.official_name, qual.review_status)
    used = {key for item in items for key in item.used_capability_ids}
    used.update(check.qual_id for check in checks if check.qual_id is not None)
    if missing := used - values.keys():
        raise ValueError(f"입력에 없는 거산 값 참조: {sorted(missing)}")
    candidates = {}
    for key in sorted(used):
        kind, name, status = values[key]
        if status != ReviewStatus.REVIEWED:
            candidates[kind, key] = QuestionCandidate(
                target_kind=kind,
                target_id=key,
                text=f"{name}의 내용과 적용 범위가 맞습니까?",
                current_value=str(status),
                effect_if_answered="검수 완료로 바뀌면 이 값을 사용한 기회를 다시 평가합니다",
            )
    for req in data.requirements:
        parts = []
        if req.req_level == "UNKNOWN":
            parts.append(f"{req.name}이(가) 필수입니까?")
        if req.needed_stage == "UNKNOWN":
            parts.append(f"{req.name}은(는) 어느 단계에 필요합니까?")
        if parts:
            candidates[Kind.REQUIREMENT, req.req_id] = QuestionCandidate(
                target_kind=Kind.REQUIREMENT,
                target_id=req.req_id,
                text=" ".join(parts),
                current_value=f"수준 {req.req_level}, 단계 {req.needed_stage}",
                effect_if_answered="필수 여부와 단계를 확인하면 요구 판정과 승인을 다시 평가합니다",
            )
    return [candidates[key] for key in sorted(candidates)]
