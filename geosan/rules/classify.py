"""순서가 있는 열한 분류와 목록·상세 표시값 (BR5.6, BR6.1~6.3, BR10.2~10.3)."""

from geosan.rules.codes import (
    CheckDisplay,
    CoreEvidenceMet,
    DatasetKind,
    FilterState,
    ItemState,
    classification_entry,
)
from geosan.rules.codes import (
    ClassificationCode as Code,
)
from geosan.rules.items import calculate_items, round_half_up
from geosan.rules.models import DisplayTexts, EvaluationInput, TimingRequirements, Totals
from geosan.rules.requirements import RequirementAssessment

ITEM_SHORT_NAMES = {
    "NEW_PRODUCT": "제품",
    "NEW_MATERIAL": "소재",
    "NEW_RECORD": "납품실적",
    "NEW_PERF": "목적",
    "SIG_EXPAND": "증설",
    "SIG_ORDER": "수주",
    "SIG_BID": "공고",
    "SIG_HIRE": "채용",
}


def _next_action(data: EvaluationInput, fallback: str) -> str:
    """첫 질문과 실제 미확보 항목을 배점순으로 안내한다 (BR10.3, #139 PM 결정)."""
    parts = []
    if data.research_readiness and data.research_readiness.question_set:
        parts.append(data.research_readiness.question_set[0])
    missing = [
        ITEM_SHORT_NAMES[item.item_code]
        for item in sorted(calculate_items(data), key=lambda item: item.weight, reverse=True)
        if item.state == ItemState.UNAVAILABLE
    ]
    if missing:
        parts.append("미확보: " + "·".join(missing))
    return " · ".join(parts) if parts else fallback


def classify(
    data: EvaluationInput,
    filter_state: FilterState,
    totals: Totals,
    core: CoreEvidenceMet,
    timing: TimingRequirements,
    research_ready: bool,
) -> Code:
    """반올림한 표시 점수 대신 E·P·R로 첫 해당 분류를 정한다 (BR6.1~6.3, BR5.6)."""
    if filter_state == FilterState.EXCLUDED:
        return Code.FILTER_EXCLUDED
    if filter_state == FilterState.PENDING:
        return Code.FILTER_PENDING
    if data.dataset_kind == DatasetKind.BROCHURE:
        if any(
            r.req_level == "REQUIRED"
            and r.needed_stage != "LATER"
            and r.req_kind != "QUANTITY_DELIVERY"
            for r in data.requirements
        ):
            return Code.FILTER_PENDING
        return Code.OPS_PENDING
    if not data.operational_ready:
        return Code.OPS_PENDING
    if totals.P == 0:
        return Code.NOT_EVALUATED
    cut = data.rule_config.thresholds
    if core == CoreEvidenceMet.MET:
        if totals.E >= cut.urgent_e and all(
            (timing.direct_signal, timing.agreed_window, timing.readiness)
        ):
            return Code.CONTACT_URGENT
        if totals.E >= cut.planned_e:
            return Code.CONTACT_PLANNED
        if totals.E >= cut.review_e and totals.P >= cut.review_p:
            return Code.CONTACT_REVIEW
    if totals.R >= cut.research_r:
        return Code.RESEARCH if research_ready else Code.CONDITIONAL_WAIT
    if totals.R >= cut.watch_r_min:
        return Code.WATCH
    return Code.LOW


def display_texts(
    data: EvaluationInput,
    code: Code,
    assessment: RequirementAssessment,
    totals: Totals,
    core: CoreEvidenceMet,
    missing_research: list[str],
) -> DisplayTexts:
    """분류·요구·관계 확인 상태를 설명하고 승인 가능 여부를 한 번만 계산한다 (BR10.2~10.3)."""
    label = data.rule_config.classification_labels[code]
    blockers = []
    if classification_entry(code).blocks_approval:
        blockers.append(label)
    for check in assessment.requirement_checks:
        if check.display_result == CheckDisplay.PENDING_BLOCKS:
            blockers.append(check.reason)
    if data.dataset_kind == DatasetKind.BROCHURE:
        blockers.append("거산 확인 전")
    if data.opportunity.relation_status == "UNCONFIRMED":
        blockers.append("거래 관계 확인 전")
    blocked = bool(blockers)
    blocker = "; ".join(dict.fromkeys(blockers)) if blocked else "없음 — 지금 단계 필수 요구 통과"
    blocker += " (승인 막힘)" if blocked else " (승인은 막지 않음)"
    score = "--" if totals.S is None else str(round_half_up(totals.S))
    if code in {Code.FILTER_PENDING, Code.OPS_PENDING} and totals.S is not None:
        score = f"참고 {score}" if data.dataset_kind == DatasetKind.BROCHURE else "--"
    reason = f"{label}: 확인된 점수 {totals.E}, 판정한 배점 {totals.P}"
    if core == CoreEvidenceMet.RECHECK:
        reason += "; 핵심 근거 재확인 필요"
    if code == Code.CONDITIONAL_WAIT:
        reason += "; 조사 재개 조건: " + ", ".join(missing_research)
    actions = {
        Code.FILTER_EXCLUDED: "제외된 공정과 필수 요구의 사유를 확인하세요",
        Code.FILTER_PENDING: "관계·공정·필수 요구의 미확인 내용을 확인하세요",
        Code.OPS_PENDING: "사용한 거산 값의 검수와 자료 사용 허용을 확인하세요",
        Code.NOT_EVALUATED: "판정에 필요한 근거를 확보하세요",
        Code.CONTACT_URGENT: "유효 기한 안에 연락 준비와 담당자 검토를 진행하세요",
        Code.CONTACT_PLANNED: "연락 계획과 기한 내 대응 가능 여부를 확인하세요",
        Code.CONTACT_REVIEW: "보완할 근거를 확인한 뒤 연락을 검토하세요",
        Code.RESEARCH: "준비된 질문을 허용된 경로로 확인하세요",
        Code.CONDITIONAL_WAIT: "부족한 조사 요건을 갖춘 뒤 다시 평가하세요",
        Code.WATCH: "새로운 근거나 행동 신호가 생기면 다시 평가하세요",
        Code.LOW: "새 근거를 확보하면 우선순위를 다시 검토하세요",
    }
    return DisplayTexts(
        reason=data.opportunity.card_reason or reason,
        blocker_text=blocker,
        blocks_approval=blocked,
        score_display=score,
        next_action=_next_action(data, actions[code]),
    )
