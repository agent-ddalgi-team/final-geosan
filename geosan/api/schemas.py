"""경계 파일: 고치려면 PM에게 먼저 말한다(계약 C1).

웹 API 응답·요청 모델(pydantic v2). FastAPI가 이 모델로 OpenAPI를 만들고 `export-contracts`가
`contracts/openapi.json`에 쓴다. JSON 키는 계약대로 camelCase(별칭), 파이썬 속성은 snake_case.
뒤 단위는 자기 경로 묶음 파일에서 모델을 "추가만" 하고 여기 있는 필드를 바꾸지 않는다.

더하는 변경(2026-10-21 PM 확인): OpportunityCard.scoreDisplay, meta.notEvaluatedCount,
brand.demoLabel.
고친 것(2026-10-22 PM 확인, 이슈 #33): Scores의 `E/P/S/R/C` 키를 대문자 별칭으로 고정
(약속 C1과 같음).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from geosan.rules.codes import (
    Certainty,
    CheckDisplay,
    ClassificationCode,
    DatasetKind,
    FilterState,
    NeededStage,
    Opinion,
    Purpose,
    QuestionStatus,
    QuestionTargetKind,
    RelationStatus,
    ReqLevel,
    ReviewStatus,
    SourceGrade,
)


class _ApiModel(BaseModel):
    """API 모델 공통 설정.

    응답은 모르는 키를 무시하고(받는 쪽 규칙), 요청은 `_RequestModel`에서 forbid로 조인다.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class _RequestModel(BaseModel):
    """요청 본문: 모르는 키는 400 (경계 검증, 보안 설계 2겹)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Meta(_ApiModel):
    """성공 응답 meta. 목록·상세·기록이 공통으로 쓴다."""

    updated_at: datetime | None = None
    has_virtual_data: bool = False
    dataset_kind: DatasetKind | None = None
    previous_value: dict[str, Any] | None = Field(
        default=None, description="동시 수정 때 이전 값(기록 종류별 객체)"
    )
    reevaluated: bool | None = None
    evaluated_as_new: bool | None = None
    total: int | None = None
    not_evaluated_count: int | None = Field(
        default=None, description="최신 FULL 묶음 뒤에 투입되어 아직 목록에 없는 기회 수"
    )


class Envelope[DataT](_ApiModel):
    """성공 응답 `{ data, meta }`."""

    data: DataT
    meta: Meta = Field(default_factory=Meta)


class ErrorField(_ApiModel):
    path: str
    message: str
    line: int | None = None


class ErrorBody(_ApiModel):
    message: str = Field(description="쉬운 한국어")
    next_action: str
    ref: str = Field(description="로그 대조용 짧은 식별자")
    kind: str | None = Field(default=None, description="화면 분기용(비노출)")
    fields: list[ErrorField] | None = None
    retry_after_seconds: int | None = None


class ErrorResponse(_ApiModel):
    """오류 응답 `{ error: { message, nextAction, ref, kind?, fields? } }` (계약 3장)."""

    error: ErrorBody


class RecordMeta(_ApiModel):
    """기록마다 붙는 동시 수정 정보."""

    version: int
    updated_by: str = Field(description="staffKey")
    updated_at: datetime


# ---------------------------------------------------------------------------
# GET /config/ui
# ---------------------------------------------------------------------------


class StaffEntry(_ApiModel):
    key: str
    display_name: str


class Brand(_ApiModel):
    logo_url: str | None = None
    brand_name: str
    color_primary: str
    demo_label: str | None = None


class ConfigUi(_ApiModel):
    staff: list[StaffEntry]
    brand: Brand
    classification_labels: dict[str, str] = Field(description="11분기 코드 → 쉬운 말(규칙 설정)")
    active_dataset_kind: DatasetKind
    access_protection_enabled: bool
    rule_version: str


# ---------------------------------------------------------------------------
# GET /opportunities (S1 카드)
# ---------------------------------------------------------------------------


class Blocker(_ApiModel):
    text: str
    blocks_approval: bool


class OpinionRecord(RecordMeta):
    opinion: Opinion | None = None
    reason: str | None = None
    memo: str | None = None


class CardRecords(_ApiModel):
    opinion: OpinionRecord | None = None
    bookmark: dict[str, Any] | None = Field(default=None, description="U5")


class OpportunityCard(_ApiModel):
    opp_id: str
    rank: int
    title: str = Field(description="기업 · 기회 이름")
    classification_code: ClassificationCode
    core_evidence_recheck: bool = False
    score_s: float | None = None
    score_display: str = Field(description="정수, '--', '참고 N' (BR10.2)")
    reason: str
    blocker: Blocker
    next_action: str
    records: CardRecords = Field(default_factory=CardRecords)
    stage: int | None = Field(default=None, ge=1, le=6)
    is_virtual: bool
    is_recontact: bool = False
    recontact: dict[str, Any] | None = None
    eval_id: str
    reevaluated: bool = False
    dataset_kind: DatasetKind


# ---------------------------------------------------------------------------
# GET /opportunities/{oppId} (S2 상세)
# ---------------------------------------------------------------------------


class DetailHeader(_ApiModel):
    title: str
    customer_name: str
    opportunity_item: str
    relation_status: RelationStatus
    relation_note: str | None = Field(default=None, description="예: 기존 (2024년 아연도금 견적)")
    purpose: Purpose
    owner: str | None = None
    classification_code: ClassificationCode
    core_evidence_recheck: bool = False
    score_display: str
    is_virtual: bool
    dataset_kind: DatasetKind
    is_recontact: bool = False


class Question(_ApiModel):
    question_id: str
    text: str
    target_kind: QuestionTargetKind
    target_id: str
    current_value: str | None = None
    effect_if_answered: str
    status: QuestionStatus
    requested_by: str | None = None
    requested_at: datetime | None = None
    due_at: str | None = None
    overdue: bool = False
    reply_text: str | None = None
    replied_at: str | None = None
    linked_opp_ids: list[str] = Field(default_factory=list)
    is_user_added: bool = False


class Reasons(_ApiModel):
    reason: str
    next_action: str
    questions: list[Question] = Field(default_factory=list)


class RequirementCheckView(_ApiModel):
    req_id: str
    name: str
    req_level: ReqLevel
    needed_stage: NeededStage
    due_at: str | None = None
    capability_status: ReviewStatus | None = Field(
        default=None, description="대조한 거산 값의 검수 상태. 대조 대상 없으면 null"
    )
    result: CheckDisplay
    reason: str


class ApprovalEligibility(_ApiModel):
    eligible: bool
    reason: str
    readiness_checked: bool
    readiness_needs_recheck: bool
    allowed_purposes: list[str] = Field(default_factory=list)


class ProcessLinkView(_ApiModel):
    link_id: str
    process_code: str
    process_name: str | None = None
    applied_material: str | None = None
    result: FilterState | None = None
    reason: str | None = None


class EvidenceView(_ApiModel):
    evidence_id: str
    source_grade: SourceGrade
    certainty: Certainty
    is_llm_proposed: bool
    quote: str
    source_ref: str
    occurred_at: str | None = None
    subject: str


class ScoreItemView(_ApiModel):
    item_code: str
    label: str
    state: str
    weight: int
    match_rate: float | None = None
    certainty: float | None = None
    decay: float | None = None
    score: int | None = None
    fact_judged: str | None = None
    summary: str | None = Field(
        default=None, description="상세용 쉬운 요약(더하는 변경 2026-10-26, #139). 없으면 null"
    )


class Scores(_ApiModel):
    """점수 영역. 다섯 점수 키는 약속 C1·화면 예시대로 대문자 `E/P/S/R/C`다.

    공통 camelCase 변환(to_camel)이 한 글자 키를 소문자로 바꾸므로 별칭을 직접 고정한다
    (2026-10-22 PM 확인, 이슈 #33).
    """

    E: int = Field(alias="E")
    P: int = Field(alias="P")
    S: float | None = Field(alias="S")
    R: int = Field(alias="R")
    C: float = Field(alias="C")
    items: list[ScoreItemView]
    rule_version: str
    dataset_kind: DatasetKind
    batch_id: str
    evaluated_at: datetime


class DetailRecords(_ApiModel):
    opinion: OpinionRecord | None = None
    bookmark: dict[str, Any] | None = None
    approval: dict[str, Any] | None = None
    outcome: dict[str, Any] | None = None


class OpportunityDetail(_ApiModel):
    """근거 상세 S2. 영역별 구성 함수(detail_sections)가 순서대로 조립한다 (BR10.5)."""

    header: DetailHeader
    stage: dict[str, Any] | None = None
    reasons: Reasons
    requirements: list[RequirementCheckView]
    approval_eligibility: ApprovalEligibility
    process_links: list[ProcessLinkView]
    evidence: list[EvidenceView]
    homepage_needs_confirm: bool = False
    scores: Scores | None = Field(default=None, description="평가가 아직 없으면 null")
    records: DetailRecords = Field(default_factory=DetailRecords)
    recontact: dict[str, Any] | None = None
    eval_id: str | None = None
    previous_eval_id: str | None = None
    reevaluated: bool = False


# ---------------------------------------------------------------------------
# POST /opportunities/{oppId}/opinions (S3 의견)
# ---------------------------------------------------------------------------


class OpinionRequest(_RequestModel):
    """W7 의견 저장 요청. NOT_TARGET이면 reason 1~200자 필수(BR9.1). memo·reason에 연락처 금지."""

    opinion: Opinion
    eval_id: str = Field(min_length=1)
    expected_version: int | None = None
    reason: str | None = Field(default=None, max_length=200)
    memo: str | None = Field(default=None, max_length=200)


class OpinionResponse(OpinionRecord):
    """응답 data: RecordMeta + opinion·reason·memo. 이전 값은 meta.previousValue."""


# 화면·테스트가 참고할 수 있는 응답 유형 별칭
ConfigUiEnvelope = Envelope[ConfigUi]
OpportunityListEnvelope = Envelope[list[OpportunityCard]]
OpportunityDetailEnvelope = Envelope[OpportunityDetail]
OpinionEnvelope = Envelope[OpinionResponse]
