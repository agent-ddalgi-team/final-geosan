"""핵심 근거·시점·조사 요건과 기한 체크의 재확인 필요 여부 (BR5, BR7.4)."""

from __future__ import annotations

from datetime import date

from geosan.rules.codes import CoreEvidenceMet, ItemCode, NeededStage, ReqLevel, ReviewStatus
from geosan.rules.items import linked_signals, representative_signal
from geosan.rules.models import (
    EvaluationInput,
    ItemJudgmentOutput,
    RequirementCheckOutput,
    SignalInput,
    TimingRequirements,
)


def core_evidence(data: EvaluationInput, items: list[ItemJudgmentOutput]) -> CoreEvidenceMet:
    """설정의 핵심 항목 상태와 대조에 쓰인 공정·소재 검수를 확인한다 (BR5.1)."""
    rule = data.rule_config.core_evidence.new
    by_code = {item.item_code: item for item in items}
    if not rule.items or any(
        code not in by_code or by_code[code].state not in rule.allowed_states for code in rule.items
    ):
        return CoreEvidenceMet.RECHECK
    if rule.require_reviewed_capability:
        statuses = {p.process_id: p.review_status for p in data.capability.processes}
        statuses.update({c.capability_id: c.review_status for c in data.capability.capabilities})
        used = {key for code in rule.items for key in by_code[code].used_capability_ids}
        if not used or any(statuses.get(key) != ReviewStatus.REVIEWED for key in used):
            return CoreEvidenceMet.RECHECK
    return CoreEvidenceMet.MET


def direct_action_signals(data: EvaluationInput) -> list[SignalInput]:
    """직접 확인된 행동 신호를 고른다. 공고는 현재 유효해야 한다 (BR5.2)."""
    return [
        s
        for s in data.signals
        if s.signal_kind in {"BID", "NEW_ORDER", "NEXT_CONTACT"}
        and s.relation == "DIRECT"
        and s.certainty == "CONFIRMED"
        and (
            s.signal_kind != "BID"
            or (
                s.deadline_at is not None
                and s.deadline_at >= data.base_date
                and s.progress_status not in {"CLOSED", "CANCELLED"}
            )
        )
    ]


def timing_requirements(data: EvaluationInput) -> TimingRequirements:
    """같은 행동 신호의 실행기간과 현재 담당자 체크를 반영한다 (BR5.2~5.4)."""
    actions = direct_action_signals(data)
    agreed = any(
        s.agreed_window is not None
        and (day := s.deadline_at or s.scheduled_at) is not None
        and 0 <= (day - data.base_date).days <= s.agreed_window.days
        for s in actions
    )
    if not data.rule_config.timing_requirements.agreed_window_required:
        agreed = bool(actions)
    return TimingRequirements(
        direct_signal=bool(actions),
        agreed_window=agreed,
        readiness=data.readiness_check is not None and data.readiness_check.checked,
    )


def valid_contact_until(data: EvaluationInput) -> date | None:
    """행동 신호의 기한 중 가장 이른 날. 항목의 대표 신호 선택을 유지한다 (BR4.4, BR6.4)."""
    represented = set()
    selected = set()
    for item in data.item_inputs:
        if item.item_code not in {ItemCode.SIG_BID, ItemCode.SIG_ORDER}:
            continue
        signals = linked_signals(item, data)
        represented.update(s.signal_id for s in signals)
        if signal := representative_signal(signals, data.base_date):
            selected.add(signal.signal_id)
    days = [
        day
        for s in direct_action_signals(data)
        if s.signal_id not in represented or s.signal_id in selected
        if (day := s.deadline_at or s.scheduled_at) is not None
    ]
    return min(days, default=None)


def research_missing(data: EvaluationInput) -> list[str]:
    """다섯 조사 요건의 부족 목록을 반환한다. 비어 있으면 조사 가능하다 (BR5.7)."""
    ready = data.research_readiness
    graded = any(
        e.source_grade in {"A", "B", "C"}
        and not e.blocked
        and e.security_grade in {"PUBLIC", "EXTERNAL_AI_OK", "INTERNAL_ONLY"}
        for e in data.evidence
    )
    limit = (
        ready.max_hours
        if ready and ready.max_hours is not None
        else data.rule_config.research_requirements.max_hours_default
    )
    checks = [
        (graded and ready is not None and ready.has_graded_evidence, "관련 A~C등급 근거"),
        (ready is not None and ready.has_question_set, "구체적인 확인 질문"),
        (ready is not None and ready.has_channel_and_owner, "허용된 확인 경로와 담당자"),
        (ready is not None and ready.question_can_change_class, "분류를 바꿀 수 있는 질문"),
        (
            ready is not None
            and ready.estimated_hours is not None
            and 0 <= ready.estimated_hours <= limit,
            "합의한 조사시간 안의 실행 여력",
        ),
    ]
    return [text for met, text in checks if not met]


def readiness_needs_reset(
    previous: EvaluationInput,
    current: EvaluationInput,
    previous_checks: list[RequirementCheckOutput],
    current_checks: list[RequirementCheckOutput],
) -> bool:
    """직전 확정 입력과 현재 입력의 기한·지금 필수 요구 결과를 비교한다 (BR7.4).

    Ledger가 직전 스냅샷과 체크를 제공하고 저장·초기화를 맡는다. 엔진은 이력 조회를 하지 않는다.
    """
    if previous.opportunity.opp_id != current.opportunity.opp_id:
        raise ValueError("같은 기회의 기한 체크만 비교할 수 있습니다")

    def signature(data: EvaluationInput, checks: list[RequirementCheckOutput]):
        deadlines = sorted(
            (s.signal_id, s.deadline_at, s.scheduled_at) for s in direct_action_signals(data)
        )
        by_id = {c.req_id: c for c in checks}
        required = []
        for req in data.requirements:
            if req.req_level == ReqLevel.REQUIRED and req.needed_stage == NeededStage.NOW:
                check = by_id[req.req_id]
                required.append((req.req_id, check.result))
        return deadlines, sorted(required)

    return signature(previous, previous_checks) != signature(current, current_checks)
