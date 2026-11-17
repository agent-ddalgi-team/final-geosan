"""경계 파일: 고치려면 PM에게 먼저 말한다(계약 C3).

규칙 엔진 입력·출력 모델(pydantic v2). EvaluationLedger가 스냅샷을 `EvaluationInput`으로
만들어 넘기고, RuleEngine은 `EvaluationOutput`만 돌려준다. 같은 입력 → 같은 출력(NFR1, BR4.8).

- JSON(스냅샷·테스트 데이터)은 계약대로 camelCase, 파이썬 속성은 snake_case다(alias 자동 변환).
  `EvaluationInput.model_validate(json_dict)`로 읽고 `.model_dump(by_alias=True)`로 쓴다.
- 더하는 변경(2026-10-21 PM 확인): `itemInputs`, `signals[].relation`·`scheduledAt`·`announcedAt`,
  `RuleConfig.otherGroupSort`.
- 더하는 변경(2026-11-13 PM 결정, #685): `RuleConfig.callSignals`, 통화 신호 종류 2개.
- `evaluate`·`rank`는 서명만 둔다. 본문은 Step 13(유동렬, `geosan/rules/engine.py`)에서 구현한다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from geosan.rules.codes import (
    Applicability,
    CapKind,
    Certainty,
    CheckDisplay,
    CheckResult,
    ClassificationCode,
    CoreEvidenceMet,
    DatasetKind,
    EvidenceSubject,
    ExclusionScope,
    FilterState,
    InteractionKind,
    ItemCode,
    ItemState,
    NeededStage,
    Profile,
    ProgressStatus,
    Purpose,
    QualificationKind,
    QualificationStatusCode,
    QuestionTargetKind,
    RelationStatus,
    ReqKind,
    ReqLevel,
    ReviewStatus,
    ScopeKind,
    SecurityGrade,
    SignalKind,
    SignalRelation,
    SortGroup,
    SourceGrade,
)


class _ContractModel(BaseModel):
    """계약 모델 공통 설정: camelCase 별칭, 모르는 키 거부, 속성 이름으로도 생성 가능."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=False,
    )


# ---------------------------------------------------------------------------
# RuleConfig (C7 규칙 설정 파일의 엔진 입력 모양). 버전·해시 기록은 config/rule_config.py(Step 11).
# ---------------------------------------------------------------------------


class ProfileItemConfig(_ContractModel):
    item_code: str
    label: str | None = None
    weight: int = Field(ge=0, le=100)
    match_rate_steps: dict[str, float]
    decay: Literal["NONE", "GENERAL", "BID_EXCEPTION", "HIRE"]


class CertaintyFactors(_ContractModel):
    CONFIRMED: float = Field(ge=0, le=1)
    STRONG: float = Field(ge=0, le=1)
    WEAK: float = Field(ge=0, le=1)


class DecayStep(_ContractModel):
    max_days: int | None = Field(default=None, ge=0)
    factor: float = Field(ge=0, le=1)


class ReorderCycleStep(_ContractModel):
    max_abs_days: int | None = Field(default=None, ge=0)
    factor: float = Field(ge=0, le=1)


class NextContactStep(_ContractModel):
    scheduled_within_days: int | None = Field(default=None, ge=0)
    past_within_days: int | None = Field(default=None, ge=0)
    factor: float = Field(ge=0, le=1)


class RecontactDates(_ContractModel):
    reorder_cycle: list[ReorderCycleStep]
    next_contact: list[NextContactStep]


class Thresholds(_ContractModel):
    urgent_e: int = Field(ge=0, le=100)
    planned_e: int = Field(ge=0, le=100)
    review_e: int = Field(ge=0, le=100)
    review_p: int = Field(ge=0, le=100)
    research_r: int = Field(ge=0, le=100)
    watch_r_min: int = Field(ge=0, le=100)


class Rounding(_ContractModel):
    item_score: Literal["HALF_UP_INT"]
    display: Literal["ONE_DECIMAL"]


class CoreEvidenceRule(_ContractModel):
    items: list[str]
    allowed_states: list[Literal["CONFIRMED", "STRONG", "WEAK"]]
    require_reviewed_capability: bool


class CoreEvidenceConfig(_ContractModel):
    new: CoreEvidenceRule
    recontact: CoreEvidenceRule


class TimingRequirementsConfig(_ContractModel):
    agreed_window_required: bool


class ResearchRequirementsConfig(_ContractModel):
    max_hours_default: float = Field(ge=0)


class SortKeySpec(_ContractModel):
    key: Literal["R", "E", "F", "P", "oppId"]
    order: Literal["asc", "desc"]


class OtherGroupSort(_ContractModel):
    default: list[SortKeySpec]
    brochure: list[SortKeySpec]


class CallSignalAnswer(_ContractModel):
    """꼬리 질문의 답 하나가 통화 신호의 어느 세기인지 (#685)."""

    question_id: str
    answer_id: str
    relation: SignalRelation


class CallSignalRule(_ContractModel):
    """점수 항목 하나를 채우는 통화 신호 종류와 답 대응표 (#685, PM 결정 2026-11-13)."""

    item_code: str
    signal_kind: Literal["CALL_INTENT", "CALL_INTEREST"]
    answers: list[CallSignalAnswer] = Field(min_length=1)


class RuleConfig(_ContractModel):
    """규칙 설정 파일 내용 + 버전·해시. 모든 수치는 기업 승인 전 가설(BR7.6)."""

    version: str
    hypothesis_note: str
    new_profile_items: list[ProfileItemConfig]
    recontact_profile_items: list[ProfileItemConfig]
    certainty: CertaintyFactors
    general_decay: list[DecayStep]
    recontact_dates: RecontactDates
    thresholds: Thresholds
    rounding: Rounding
    core_evidence: CoreEvidenceConfig
    timing_requirements: TimingRequirementsConfig
    research_requirements: ResearchRequirementsConfig
    classification_labels: dict[str, str]
    other_group_sort: OtherGroupSort
    existing_customer_placement: Literal["BOTTOM", "INLINE"] = "BOTTOM"
    # BLOCK: 거래 관계 "확인 전"이면 필터 대기(BR3.10, S06). IGNORE: 신규 잠재고객만 찾으므로
    # 확인 전을 대기 사유로 쓰지 않는다(PM 결정 2026-11-11, #567). 생략하면 BLOCK(이전 동작).
    relation_check: Literal["BLOCK", "IGNORE"] = "BLOCK"
    # 꼬리 질문 답 → 통화에서 확인한 신호 대응표(PM 결정 2026-11-13, #685). 생략하면 통화 신호 없음.
    call_signals: list[CallSignalRule] = Field(default_factory=list)
    dataset_kinds: list[DatasetKind]
    rule_hash: str | None = Field(default=None, description="파일 내용 SHA-256. 로더가 채운다")


# ---------------------------------------------------------------------------
# EvaluationInput (C3)
# ---------------------------------------------------------------------------


class OpportunityInput(_ContractModel):
    opp_id: str
    customer_id: str
    relation_status: RelationStatus
    purpose: Purpose
    company_filter_status: FilterState
    has_linked_interaction: bool
    linked_interaction_kinds: list[InteractionKind] = Field(default_factory=list)
    card_reason: str | None = Field(
        default=None,
        description="사례 파일 opportunity.cardReason. 있으면 카드 추천 이유로 그대로 쓴다 "
        "(더하는 변경 2026-10-26, #139)",
    )


class ProcessLinkInput(_ContractModel):
    link_id: str
    process_id: str | None = Field(
        default=None, description="활성 묶음에서 processCode를 해석한 ID. 없으면 연결 UNKNOWN"
    )
    process_code: str
    applied_material: str | None = None


class RequirementInput(_ContractModel):
    req_id: str
    link_id: str | None = None
    req_kind: ReqKind
    name: str
    content: str | None = None
    req_level: ReqLevel
    scope_kind: ScopeKind
    needed_stage: NeededStage
    due_at: date | None = None
    certainty: Certainty
    required_value: float | None = None
    unit: str | None = None
    edition: str | None = None
    holder: str | None = None
    site: str | None = None


class AgreedWindow(_ContractModel):
    days: int = Field(ge=0)
    basis: str | None = None


class SignalInput(_ContractModel):
    signal_id: str
    signal_kind: SignalKind
    occurred_at: date | None = None
    announced_at: date | None = None
    scheduled_at: date | None = None
    deadline_at: date | None = None
    progress_status: ProgressStatus | None = None
    agreed_window: AgreedWindow | None = None
    certainty: Certainty
    relation: SignalRelation
    evidence_ids: list[str] = Field(default_factory=list)


class InteractionInput(_ContractModel):
    interaction_id: str
    kind: InteractionKind
    occurred_at: date | None = None
    linked_to_opportunity: bool
    past_process_item: str | None = None
    order_count: int | None = None
    sample_approved: bool | None = None
    requirement_met: str | None = None
    loss_reason: str | None = None
    loss_resolved: bool | None = None
    last_delivery_at: date | None = None
    order_cycle: str | None = None
    certainty: Certainty


class EvidenceInput(_ContractModel):
    """FORBIDDEN·철회 자료는 Ledger가 미리 빼고 ID·차단 사유만 넘긴다(BR7.3)."""

    evidence_id: str
    source_grade: SourceGrade
    certainty: Certainty
    is_llm_proposed: bool
    subject: EvidenceSubject
    occurred_at: date | None = None
    security_grade: SecurityGrade
    blocked: bool = False
    blocked_reason: str | None = None


class ProcessInput(_ContractModel):
    process_id: str
    code: str
    # 역량 파일의 공정 이름 그대로(예: "아연도금(전기아연도금)"). 카드 막는 조건 문장에 쓴다.
    # 더하는 변경(2026-10-27 PM, #161): 없으면 None, 기존 입력은 그대로 통과한다.
    name: str | None = None
    material_codes: list[str]
    performance_tags: list[str]
    review_status: ReviewStatus
    dataset_kind: DatasetKind


class CapabilityInput(_ContractModel):
    capability_id: str
    process_id: str
    cap_kind: CapKind
    name: str
    numeric_min: float | None = None
    numeric_max: float | None = None
    unit: str | None = None
    is_descriptive_only: bool
    review_status: ReviewStatus


class DeliveryRecordInput(_ContractModel):
    record_id: str
    process_id: str
    industry: str
    part_type: str | None = None
    review_status: ReviewStatus


class QualificationInput(_ContractModel):
    qual_id: str
    kind: QualificationKind
    official_name: str
    number: str | None = None
    edition: str | None = None
    holder: str
    site: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    review_status: ReviewStatus
    current_status: QualificationStatusCode


class QualificationScopeInput(_ContractModel):
    scope_id: str
    qual_id: str
    scope_kind: Literal["PROCESS", "CUSTOMER", "OPPORTUNITY"]
    process_id: str | None = None
    customer_id: str | None = None
    opp_id: str | None = None
    applicability: Applicability
    review_status: ReviewStatus


class CapabilitySnapshot(_ContractModel):
    processes: list[ProcessInput] = Field(default_factory=list)
    capabilities: list[CapabilityInput] = Field(default_factory=list)
    delivery_records: list[DeliveryRecordInput] = Field(default_factory=list)
    qualifications: list[QualificationInput] = Field(default_factory=list)
    qualification_scopes: list[QualificationScopeInput] = Field(default_factory=list)


class ReadinessCheckInput(_ContractModel):
    checked: bool
    checked_at: datetime
    eval_id_at_check: str | None = None


class ResearchReadinessInput(_ContractModel):
    has_graded_evidence: bool
    has_question_set: bool
    has_channel_and_owner: bool
    question_can_change_class: bool
    estimated_hours: float | None = None
    max_hours: float | None = None
    question_set: list[str] = Field(
        default_factory=list,
        description=(
            "사례 파일 researchReadiness.questionSet 문장 그대로. "
            "첫 항목이 카드 '다음 할 일'이 된다 (더하는 변경 2026-10-26, #139)"
        ),
    )


class UsedCapabilityRef(_ContractModel):
    kind: Literal["PROCESS", "CAPABILITY", "DELIVERY_RECORD"]
    process_code: str
    name: str | None = None
    industry: str | None = None


class ItemInput(_ContractModel):
    """사례 파일 itemInputs를 저장한 ItemJudgmentInput의 최신 행 (BR4.1, 더하는 변경)."""

    item_code: ItemCode
    state: ItemState
    match_rate: float | None = Field(
        default=None, description="부록 A.1 고정 단계값(숫자로 변환된 값)"
    )
    match_rate_step: str | None = None
    fact_judged: str | None = None
    summary: str | None = Field(
        default=None,
        description="사례 파일 itemInputs[].summary 그대로 (더하는 변경 2026-10-26, #139)",
    )
    evidence_ids: list[str] = Field(default_factory=list)
    signal_ids: list[str] = Field(default_factory=list)
    used_capability_refs: list[UsedCapabilityRef] = Field(default_factory=list)
    used_capability_ids: list[str] = Field(
        default_factory=list, description="활성 묶음에서 해석한 거산 값 ID(Ledger가 채움)"
    )


class EvaluationInput(_ContractModel):
    """규칙 엔진 입력 스냅샷 전체 (C3)."""

    base_date: date
    profile: Profile
    rule_config: RuleConfig
    dataset_kind: DatasetKind
    opportunity: OpportunityInput
    process_links: list[ProcessLinkInput] = Field(default_factory=list)
    requirements: list[RequirementInput] = Field(default_factory=list)
    signals: list[SignalInput] = Field(default_factory=list)
    interactions: list[InteractionInput] = Field(default_factory=list)
    evidence: list[EvidenceInput] = Field(default_factory=list)
    capability: CapabilitySnapshot = Field(default_factory=CapabilitySnapshot)
    readiness_check: ReadinessCheckInput | None = None
    research_readiness: ResearchReadinessInput | None = None
    operational_ready: bool
    item_inputs: list[ItemInput] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# EvaluationOutput (C3)
# ---------------------------------------------------------------------------


class RequirementCheckOutput(_ContractModel):
    req_id: str
    result: CheckResult
    display_result: CheckDisplay
    stage_judged: NeededStage
    scope_judged: ScopeKind
    reason: str
    compared_value: dict[str, Any] | None = None
    qual_id: str | None = None
    link_id: str | None = None
    follow_up_condition: str | None = None


class ProcessLinkResult(_ContractModel):
    link_id: str
    result: FilterState
    reason: str


class ItemJudgmentOutput(_ContractModel):
    item_code: ItemCode
    state: ItemState
    weight: int
    match_rate: float | None = None
    certainty: float | None = None
    decay: float | None = None
    score: int | None = Field(default=None, description="UNAVAILABLE만 null (BR4.5)")
    fact_judged: str | None = None
    summary: str | None = None
    reasoning: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    used_capability_ids: list[str] = Field(default_factory=list)


class Totals(_ContractModel):
    """F·T·E·P·R 정수, S·C 소수 첫째 자리(HALF_UP). P=0이면 S는 None (BR4.6)."""

    E: int
    F: int
    T: int
    P: int
    R: int
    S: float | None
    C: float


class TimingRequirements(_ContractModel):
    direct_signal: bool
    agreed_window: bool
    readiness: bool


class DisplayFlags(_ContractModel):
    core_evidence_recheck: bool
    brochure_dataset: bool


class SortKey(_ContractModel):
    group: SortGroup
    relation_status: RelationStatus = RelationStatus.UNCONFIRMED
    valid_until: date | None = None
    E: int
    F: int
    direct_confirmed_weight: int
    P: int
    R: int
    opp_id: str


class QuestionCandidate(_ContractModel):
    target_kind: QuestionTargetKind
    target_id: str
    text: str
    current_value: str | None = None
    effect_if_answered: str


class DisplayTexts(_ContractModel):
    """평가 시점에 확정해 저장하는 표시값 (BR10.2, BR10.3)."""

    reason: str
    blocker_text: str
    blocks_approval: bool
    score_display: str
    next_action: str


class EvaluationOutput(_ContractModel):
    requirement_checks: list[RequirementCheckOutput]
    filter_state: FilterState
    exclusion_scope: ExclusionScope | None = None
    process_link_results: list[ProcessLinkResult]
    items: list[ItemJudgmentOutput]
    totals: Totals
    core_evidence_met: CoreEvidenceMet
    timing: TimingRequirements
    research_ready: bool
    classification_code: ClassificationCode
    score_state: Literal["CONFIRMED", "PENDING", "NONE"]
    display_flags: DisplayFlags
    sort_key: SortKey
    question_candidates: list[QuestionCandidate] = Field(default_factory=list)
    display: DisplayTexts


# ---------------------------------------------------------------------------
# rank (C3)
# ---------------------------------------------------------------------------


class RankInput(_ContractModel):
    opp_id: str
    profile: Profile
    sort_key: SortKey


class RankOutput(_ContractModel):
    opp_id: str
    original_rank: int = Field(ge=1)


# ---------------------------------------------------------------------------
# 함수 서명 (본문은 Step 13, geosan/rules/engine.py)
# ---------------------------------------------------------------------------


def evaluate(evaluation_input: EvaluationInput) -> EvaluationOutput:
    """입력 스냅샷 하나를 평가한다. 순수 계산이며 현재 시각·난수·I/O를 쓰지 않는다 (BR4.8).

    본문은 `geosan/rules/engine.py`(Step 13, 유동렬)에서 구현한다.
    이 서명은 경계이므로 바꾸지 않는다.
    """
    raise NotImplementedError(
        "규칙 엔진은 Step 13(유동렬)에서 구현한다: geosan/rules/engine.py evaluate"
    )


def rank(
    outputs: list[RankInput], dataset_kind: DatasetKind, rule_config: RuleConfig
) -> list[RankOutput]:
    """같은 묶음(같은 프로필)의 결과들에 sortKey를 적용해 originalRank(1부터)를 매긴다.

    규칙은 BR6.4·BR6.5. 본문은 `geosan/rules/engine.py`(Step 13, 유동렬)에서 구현한다.
    이 서명은 경계이므로 바꾸지 않는다.
    """
    raise NotImplementedError(
        "규칙 엔진은 Step 13(유동렬)에서 구현한다: geosan/rules/engine.py rank"
    )
