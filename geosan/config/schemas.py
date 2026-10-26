"""사람이 넣는 파일의 모양 (계약 C7): CaseFile·CapabilityFile pydantic 모델.

`contracts/case-file.schema.json`·`contracts/capability-file.schema.json`과 같은 뜻이며
`export-contracts`(Step 19)가 이 모델에서 스키마를 다시 만든다. 모르는 키는 거부하고(BR2.2),
`_설명` 키는 로더가 미리 뺀다. JSON 키는 camelCase(별칭), 파이썬 속성은 snake_case.

허용 값은 공통 코드표(`geosan/rules/codes.py`)의 열거값을 그대로 쓴다(C0).
파일 안 참조·단계값·연락처처럼 모델 하나로 못 보는 검사는 `file_checks.py`에 있다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from geosan.rules.codes import (
    Applicability,
    CapKind,
    Certainty,
    CheckDisplay,
    ClassificationCode,
    CoreEvidenceMet,
    DatasetKind,
    EvidenceSubject,
    FilterState,
    InteractionKind,
    ItemCode,
    ItemState,
    NeededStage,
    PathKind,
    ProcessCode,
    ProgressStatus,
    Purpose,
    QualificationKind,
    QualificationStatusCode,
    RelationStatus,
    ReqKind,
    ReqLevel,
    ReviewStatus,
    ScopeKind,
    SecurityGrade,
    SignalKind,
    SignalRelation,
    SourceGrade,
)

STAFF_KEY_PATTERN = r"^[a-z0-9-]{1,32}$"
CASE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]*$"
BIZ_NUMBER_PATTERN = r"^[0-9]{10}$"


class FileModel(BaseModel):
    """파일 모델 공통 설정: camelCase 별칭, 속성 이름도 허용, 모르는 키 거부."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


def _require_timezone(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("시각에는 시간대를 붙여 주세요 (예: 2026-10-19T09:00:00+09:00)")
    return value


# ---------------------------------------------------------------------------
# CaseFile — 사례 파일 (가상 사례·실제 기업)
# ---------------------------------------------------------------------------


class CaseCustomer(FileModel):
    name: str = Field(min_length=1)
    biz_number: str | None = Field(default=None, pattern=BIZ_NUMBER_PATTERN)
    address: str | None = None
    identity_basis: str | None = None
    relation_status: RelationStatus
    relation_confirmed_at: date | None = None
    security_grade: SecurityGrade


class CaseInteraction(FileModel):
    kind: InteractionKind
    occurred_at: date | None = None
    allowed_summary: str | None = None
    linked_to_opportunity: bool
    certainty: Certainty


class CaseOpportunity(FileModel):
    item: str = Field(min_length=1)
    project: str | None = None
    purpose: Purpose
    owner: str | None = Field(default=None, pattern=STAFF_KEY_PATTERN)
    card_reason: str | None = Field(
        default=None,
        description="추천 목록 카드의 추천 이유 한 문장(출처 제외 80자 안 권장, 넘으면 경고). "
        "작성자가 확인한 문장. 더하는 변경 2026-10-26 PM, #139",
    )


class CaseDiscoveryPath(FileModel):
    path_kind: PathKind
    source_id: str | None = None
    origin_key: str | None = None
    discovered_at: date | None = None


class CaseProcessLink(FileModel):
    process_code: ProcessCode
    applied_material: str | None = None


class CaseRequirement(FileModel):
    req_kind: ReqKind
    name: str = Field(min_length=1)
    content: str | None = None
    req_level: ReqLevel
    scope_kind: ScopeKind
    link_process_code: ProcessCode | None = None
    needed_stage: NeededStage
    due_at: date | None = None
    certainty: Certainty
    basis: str | None = None
    question: str | None = None
    required_value: float | None = None
    unit: str | None = None
    edition: str | None = None


class CaseAgreedWindow(FileModel):
    days: int = Field(ge=0)
    basis: str | None = None


class CaseSignal(FileModel):
    signal_kind: SignalKind
    occurred_at: date | None = None
    announced_at: date | None = None
    scheduled_at: date | None = None
    deadline_at: date | None = None
    progress_status: ProgressStatus | None = None
    agreed_window: CaseAgreedWindow | None = None
    certainty: Certainty
    relation: SignalRelation


class CaseEvidence(FileModel):
    source_grade: SourceGrade
    certainty: Certainty
    is_llm_proposed: bool
    subject: EvidenceSubject
    quote: str = Field(min_length=1)
    source_ref: str = Field(min_length=1)
    occurred_at: date | None = None
    security_grade: SecurityGrade
    external_ai_allowed: bool


class CaseUsedCapabilityRef(FileModel):
    kind: Literal["PROCESS", "CAPABILITY", "DELIVERY_RECORD"]
    process_code: ProcessCode
    name: str | None = None
    industry: str | None = None


class CaseItemInput(FileModel):
    item_code: ItemCode
    match_rate: float | str | None = Field(
        default=None,
        description="항목별 고정 단계값(숫자) 또는 단계 이름. 단계 밖 값은 오류(BR4.2)",
    )
    certainty: Literal["CONFIRMED", "STRONG", "WEAK"] | None = None
    state: ItemState
    fact_judged: str | None = None
    summary: str | None = Field(
        default=None,
        description="상세 화면용 쉬운 요약 1~2문장(원문 factJudged는 그대로 둠). "
        "더하는 변경 2026-10-26 PM, #139",
    )
    evidence_refs: list[int] = Field(default_factory=list)
    signal_refs: list[int] = Field(default_factory=list)
    used_capability_refs: list[CaseUsedCapabilityRef] = Field(default_factory=list)

    @field_validator("evidence_refs", "signal_refs")
    @classmethod
    def _non_negative(cls, refs: list[int]) -> list[int]:
        if any(ref < 0 for ref in refs):
            raise ValueError("배열 번호는 0 이상이어야 합니다")
        return refs


class CaseReadinessCheck(FileModel):
    checked: bool
    staff_key: str = Field(pattern=STAFF_KEY_PATTERN)
    checked_at: datetime

    @field_validator("checked_at")
    @classmethod
    def _tz(cls, value: datetime) -> datetime:
        return _require_timezone(value)


class CaseResearchReadiness(FileModel):
    question_set: list[str] = Field(default_factory=list)
    allowed_channel: str | None = None
    owner: str | None = None
    can_change_class: bool | None = None
    estimated_hours: float | None = Field(default=None, ge=0)
    max_hours: float | None = Field(default=None, ge=0)


class CaseExpected(FileModel):
    e: int = Field(alias="E", ge=0, le=100)
    p: int = Field(alias="P", ge=0, le=100)
    s: float | None = Field(default=None, alias="S")
    r: int = Field(alias="R", ge=0, le=100)
    c: float | None = Field(default=None, alias="C")
    filter_state: FilterState
    core_evidence_met: CoreEvidenceMet
    classification_code: ClassificationCode
    requirement_results: dict[str, CheckDisplay] = Field(default_factory=dict)


class CaseFile(FileModel):
    """사례 파일 한 건(C7 CaseFile). 더하는 변경(2026-10-21 PM 확인) 키를 포함한다."""

    case_id: str = Field(min_length=1, pattern=CASE_ID_PATTERN)
    base_date: date | None = None
    description: str
    is_virtual: bool
    dataset_kind: DatasetKind
    notes: list[str] = Field(default_factory=list)
    customer: CaseCustomer
    interactions: list[CaseInteraction] = Field(default_factory=list)
    opportunity: CaseOpportunity
    discovery_paths: list[CaseDiscoveryPath] = Field(default_factory=list)
    process_links: list[CaseProcessLink]
    requirements: list[CaseRequirement]
    signals: list[CaseSignal]
    evidence: list[CaseEvidence]
    item_inputs: list[CaseItemInput]
    readiness_check: CaseReadinessCheck | None = None
    research_readiness: CaseResearchReadiness | None = None
    expected: CaseExpected | None = None


# ---------------------------------------------------------------------------
# CapabilityFile — 거산 역량 파일 (묶음 하나)
# ---------------------------------------------------------------------------


class CapabilityItem(FileModel):
    cap_kind: CapKind
    name: str = Field(min_length=1)
    display_value: str | None = None
    numeric_min: float | None = None
    numeric_max: float | None = None
    unit: str | None = None
    standard_ref: str | None = None
    is_descriptive_only: bool
    review_status: ReviewStatus


class CapabilityDeliveryRecord(FileModel):
    industry: str = Field(min_length=1)
    part_type: str | None = None
    period: str | None = None
    allowed_basis: str | None = None
    review_status: ReviewStatus


class CapabilityProcess(FileModel):
    code: ProcessCode
    name: str = Field(min_length=1)
    category: str | None = None
    material_codes: list[str]
    performance_tags: list[str]
    registry_status: Literal["BROCHURE_NAME", "OFFICIAL_NAME"]
    review_status: ReviewStatus
    capabilities: list[CapabilityItem]
    delivery_records: list[CapabilityDeliveryRecord]


class QualificationScopeEntry(FileModel):
    scope_kind: Literal["PROCESS", "CUSTOMER", "OPPORTUNITY"]
    process_code: ProcessCode | None = None
    customer_ref: str | None = None
    applicability: Applicability
    basis: str | None = None
    review_status: ReviewStatus


class QualificationStatusEntry(FileModel):
    status: QualificationStatusCode
    occurred_at: date | None = None
    confirmed_at: date | None = None
    confirmed_by: str | None = None
    reason: str | None = None


class CapabilityQualification(FileModel):
    kind: QualificationKind
    official_name: str = Field(min_length=1)
    number: str | None = None
    edition: str | None = None
    holder: str = Field(min_length=1)
    site: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    review_status: ReviewStatus
    scopes: list[QualificationScopeEntry]
    statuses: list[QualificationStatusEntry] = Field(min_length=1)


class ReviewDefaults(FileModel):
    reviewer: str = Field(min_length=1)
    reviewed_at: date
    basis: str = Field(min_length=1)


class CapabilityFile(FileModel):
    """거산 역량 파일 한 개 = 거산 값 묶음(datasetKind) 하나(C7 CapabilityFile)."""

    dataset_kind: DatasetKind
    source_note: str
    processes: list[CapabilityProcess]
    qualifications: list[CapabilityQualification]
    review_defaults: ReviewDefaults
