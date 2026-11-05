"""사용한 거산 값과 요구의 미확인 사항에 대한 질문 후보 (BR8.1, BR8.2)."""

from geosan.rules.codes import ProcessCode, ReviewStatus
from geosan.rules.codes import QuestionTargetKind as Kind
from geosan.rules.models import (
    EvaluationInput,
    ItemJudgmentOutput,
    QuestionCandidate,
    RequirementCheckOutput,
)

PROCESS_NAMES: dict[str, str] = {
    ProcessCode.ZINC_PLATING: "전기아연도금",  # 카드 제목과 같은 말(#26, PM 2026-10-24)
    ProcessCode.ANODIZING: "아노다이징",
    ProcessCode.BLACK_OXIDE: "흑착색",
    ProcessCode.CHROMATE: "크로메이트",
    ProcessCode.ELECTROPOLISHING: "전해연마",
    ProcessCode.CHROME_PLATING: "크롬도금",
    ProcessCode.ELECTROLESS_NICKEL: "무전해니켈",
    ProcessCode.PHOSPHATE_COATING: "인산염피막",
    ProcessCode.PASSIVATION: "부동태",
}
"""질문 문장에 넣는 공정 9종의 쉬운 이름 (이슈 #101).

규칙 엔진 입력(`ProcessInput`)에는 공정 이름 칸이 없어 코드만 들어오므로, 사람이 읽는 질문에는
이 표의 이름을 쓴다. 역량 파일 `processes[].name`과 같은 말이다. 표에 없는 코드는 코드 그대로 둔다.
입력 모델에 이름 칸을 더해 역량 파일 이름을 그대로 쓰는 것은 방문 뒤(#88).
"""


def process_display_name(code: str) -> str:
    """확인 질문에 보일 공정 이름을 찾는다. 표에 없으면 코드를 그대로 돌려준다 (BR8.1)."""
    return PROCESS_NAMES.get(code, code)


def question_candidates(
    data: EvaluationInput, items: list[ItemJudgmentOutput], checks: list[RequirementCheckOutput]
) -> list[QuestionCandidate]:
    """대상별 질문 하나만 만들고 검수 완료한 미사용 값에는 질문을 만들지 않는다 (BR8.1, BR8.2).

    BR8.2의 중복 방지는 이번 평가의 후보 안에서 적용한다. 기존 질문 재사용과 최초 평가 ID
    보존은 질문 저장소가 맡는다.
    """
    values = {}
    for process in data.capability.processes:
        values[process.process_id] = (
            Kind.PROCESS,
            process_display_name(process.code),
            process.review_status,
        )
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
