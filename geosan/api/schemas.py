"""경계 파일: 고치려면 PM에게 먼저 말한다(계약 C1).

웹 API 응답·요청 모델(pydantic v2). FastAPI가 이 모델로 OpenAPI를 만들고 `export-contracts`가
`contracts/openapi.json`에 쓴다. JSON 키는 계약대로 camelCase(별칭), 파이썬 속성은 snake_case.
뒤 단위는 자기 경로 묶음 파일에서 모델을 "추가만" 하고 여기 있는 필드를 바꾸지 않는다.

더하는 변경(2026-10-21 PM 확인): OpportunityCard.scoreDisplay, meta.notEvaluatedCount,
brand.demoLabel.
더하는 변경(2026-11-06 PM 확인, #342): 후보 찾기 응답 칸 — meta.latestIngest, 카드의 들어온
회차·고른 이유·공정 적합도 등, 상세 머리의 같은 칸. 값은 창구(#317)가 채운다.
더하는 변경(2026-11-06 PM 확인, #347): meta.latestIngest.failureReason(찾기 실패 사유 한 줄).
더하는 변경(2026-11-09 PM 확인, #497): ReviewItem.stepOptions·ReviewCheckRequest.stepLabel.
고친 것(2026-10-22 PM 확인, 이슈 #33): Scores의 `E/P/S/R/C` 키를 대문자 별칭으로 고정
(약속 C1과 같음).
바꾼 것(2026-11-06 PM 결정, #356, 계약 v3): 영업 단계에서 INTERESTED 삭제, 관심(찜) 모델
BookmarkRecord·BookmarkRequest·BookmarkResponse 추가, records.bookmark를 그 모양으로.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from geosan.rules.codes import (
    Certainty,
    CheckDisplay,
    ClassificationCode,
    DatasetKind,
    DiscoverySource,
    FilterState,
    FitLevel,
    JudgmentCheck,
    LostReasonCode,
    NeededStage,
    Opinion,
    ProcessCode,
    Purpose,
    QuestionStatus,
    QuestionTargetKind,
    RelationStatus,
    ReqLevel,
    ReviewItemKind,
    ReviewItemSource,
    ReviewStatus,
    SourceGrade,
)
from geosan.rules.codes import (
    OutcomeStatus as SalesOutcomeStatus,
)


class _ApiModel(BaseModel):
    """API 모델 공통 설정.

    응답은 모르는 키를 무시하고(받는 쪽 규칙), 요청은 `_RequestModel`에서 forbid로 조인다.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class _RequestModel(BaseModel):
    """요청 본문: 모르는 키는 400 (경계 검증, 보안 설계 2겹)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class ProcessCount(_ApiModel):
    process_code: str
    process_name: str
    count: int


class IndustryCount(_ApiModel):
    industry: str
    count: int


class RegionCount(_ApiModel):
    region: str
    count: int


class IngestCriteria(_ApiModel):
    """찾기 회차의 조건: 담당자가 고른 공정·지역·산업 (C1 POST /ingest 본문과 같은 이름)."""

    process_codes: list[str]
    regions: list[str]
    industries: list[str]


class LatestIngest(_ApiModel):
    """마지막 찾기 회차 요약 (C1 `meta.latestIngest`, #221·#313·#323).

    목록 머리 "훑어본 ○곳 · 판단 완료 ○곳 · 고른 ○곳 · 조사 ○/○"에 쓴다. 칸에 기본값을 두지 않아
    창구가 회차 행의 값을 빠짐없이 채워야 한다(안 채운 건수가 0으로 보이지 않게).
    """

    batch_id: str
    source_id: str
    started_at: datetime
    finished_at: datetime | None
    status: Literal["RUNNING", "DONE", "FAILED"]
    criteria: IngestCriteria | None = Field(description="조건 없이 돌린 회차는 null")
    new_count: int = Field(description="목록에 새로 들어온 회사 수")
    merge_candidate_count: int = Field(description='이름이 비슷해 "확인 필요"로 남은 수')
    research_done_count: int = Field(description="새 회사 가운데 자동 조사를 끝낸 수")
    scanned_count: int = Field(description="파일·조회에서 지역으로 추려 합친 회사 수")
    judged_count: int = Field(description="AI가 판단을 끝낸 수")
    picked_count: int = Field(description="AI가 고른 수")
    judge_pending_count: int = Field(description="AI 한도에 걸려 판단이 남은 수")
    web_search_used: bool
    web_candidate_count: int
    web_dropped_count: int = Field(
        description="채용·유료 사이트 결과, 출처 없음, 홈페이지 미확인으로 버린 수"
    )
    web_from_cache: bool
    web_skipped_reason: Literal["DAILY_LIMIT", "DISABLED"] | None
    complex_list_skipped_reason: Literal["DAILY_LIMIT", "SOURCE_ERROR", "DISABLED"] | None
    failure_reason: str | None = Field(
        description="찾기가 실패했을 때의 사유 한 줄(쉬운 말). 실패가 아니면 null (C1, #347)"
    )


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
    process_counts: list[ProcessCount] | None = None
    industry_counts: list[IndustryCount] | None = None
    region_counts: list[RegionCount] | None = None
    not_evaluated_count: int | None = Field(
        default=None, description="최신 FULL 묶음 뒤에 투입되어 아직 목록에 없는 기회 수"
    )
    latest_ingest: LatestIngest | None = Field(
        default=None, description="마지막 찾기 회차 요약. 한 번도 안 찾았으면 null (C1, #342)"
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


class RecordsUi(_ApiModel):
    approval_enabled: bool
    note_max_length: int


class IngestProcessOption(_ApiModel):
    code: ProcessCode
    name: str


class IngestOptions(_ApiModel):
    processes: list[IngestProcessOption]
    regions: list[str]
    industries: list[str]


class ConfigUi(_ApiModel):
    staff: list[StaffEntry]
    brand: Brand
    classification_labels: dict[str, str] = Field(description="11분기 코드 → 쉬운 말(규칙 설정)")
    active_dataset_kind: DatasetKind
    access_protection_enabled: bool
    rule_version: str
    records: RecordsUi
    ingest_options: IngestOptions


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


class BookmarkRecord(RecordMeta):
    """관심(찜) 표시의 최신 값(#356). 한 번도 켠 적이 없으면 records.bookmark가 null이다."""

    active: bool


class CardOutcome(_ApiModel):
    """카드용 최신 영업 단계만 공개한다(2026-11-04 PM 결정 #242)."""

    status: SalesOutcomeStatus


class CardRecords(_ApiModel):
    opinion: OpinionRecord | None = None
    bookmark: BookmarkRecord | None = Field(
        default=None, description="관심 표시의 최신 값. 한 번도 켠 적 없으면 null (#356)"
    )
    outcome: CardOutcome | None = Field(
        default=None, description="최신 영업 단계. 기록 없으면 null"
    )


ScoreState = Literal["CONFIRMED", "PENDING", "NONE"]


class OpportunityCard(_ApiModel):
    score_state: ScoreState
    relation_status: RelationStatus
    region: str | None = None
    industries: list[str] = Field(default_factory=list)
    process_codes: list[str] = Field(default_factory=list)
    contact_count: int = 0
    opp_id: str
    rank: int
    title: str = Field(description="기업 · 기회 이름")
    classification_code: ClassificationCode
    core_evidence_recheck: bool = False
    score_s: float | None = None
    score_display: str = Field(
        description=(
            "'<E>점 · <n>/<전체>'(예: '77점 · 7/8'), 판정 0개면 '--', "
            "소개서 묶음이면 '참고 ' 접두(예: '참고 50점 · 3/8') "
            "(BR10.2, PM 결정 2026-10-28 #180)"
        )
    )
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
    # 후보 찾기(#221, C1). 값은 창구(#317)가 회사 행에서 채운다.
    ingest_batch_id: str | None = Field(
        default=None, description="이 회사가 들어온 찾기 회차. 사례 파일 투입은 null"
    )
    ingested_at: datetime | None = Field(default=None, description="들어온 시각")
    is_new_in_latest_batch: bool = Field(
        default=False, description='마지막 찾기 회차에 들어온 회사면 true("이번에 들어옴")'
    )
    discovery_source: DiscoverySource = Field(
        default=DiscoverySource.CASE_FILE, description="회사가 목록에 들어온 길 (C1, #342)"
    )
    discovery_source_url: str | None = None
    registry_status: Literal["FOUND", "NOT_FOUND"] | None = Field(
        default=None, description="공공 등록 자료에서 확인됐는지. 웹에서 찾은 회사만 값이 있다"
    )
    fit_level: FitLevel | None = Field(
        default=None, description="AI가 본 공정 적합도. 점수 전 회사의 순서에만 쓴다"
    )
    pick_reason: str | None = Field(default=None, description="AI가 고른 이유 한 줄")
    own_plating_line_suspected: bool = Field(
        default=False,
        description="표면처리를 직접 하는 회사일 수 있음 (#319). 자동으로 빼지 않는다",
    )
    own_plating_line_basis: str | None = Field(default=None, description="그 표시의 근거 한 줄")


# ---------------------------------------------------------------------------
# GET /opportunities/{oppId} (S2 상세)
# ---------------------------------------------------------------------------


class DetailHeader(_ApiModel):
    score_state: ScoreState
    relation_confirmed_at: date | None
    relation_confirmed_by: str | None
    homepage_status: Literal["AI_FOUND", "NEEDS_CONFIRMATION", "CONFIRMED", "NOT_FOUND"] | None = (
        None
    )
    homepage_confidence: float | None = Field(
        default=None, description="0~1. AI가 찾았을 때만 (C1, #331)"
    )
    homepage_source: Literal["AI", "STAFF", "CASE_FILE"] | None = Field(
        default=None, description="홈페이지 주소를 누가 정했나: AI·담당자·사례 파일 (C1, #331)"
    )
    # 후보 찾기(#221, C1 "카드·상세에 더하는 칸"). 카드와 같은 이름·뜻.
    discovery_source: DiscoverySource = Field(
        default=DiscoverySource.CASE_FILE, description="회사가 목록에 들어온 길 (C1, #342)"
    )
    discovery_source_url: str | None = None
    registry_status: Literal["FOUND", "NOT_FOUND"] | None = Field(
        default=None, description="공공 등록 자료에서 확인됐는지. 웹에서 찾은 회사만 값이 있다"
    )
    fit_level: FitLevel | None = Field(
        default=None, description="AI가 본 공정 적합도. 점수 전 회사의 순서에만 쓴다"
    )
    pick_reason: str | None = Field(default=None, description="AI가 고른 이유 한 줄")
    own_plating_line_suspected: bool = Field(
        default=False,
        description="표면처리를 직접 하는 회사일 수 있음 (#319). 자동으로 빼지 않는다",
    )
    own_plating_line_basis: str | None = Field(default=None, description="그 표시의 근거 한 줄")
    industries: list[str] = Field(default_factory=list)
    industries_source: str | None = None
    address: str
    distance_km: float | None = None
    main_phone: str | None = None
    main_phone_source: Literal["HOMEPAGE", "CSV"] | None = None
    main_phone_source_url: str | None = None
    main_phone_confirmed_at: datetime | None = None
    main_phone_confirmed_by: str | None = None
    summary_line: str | None = None
    highlights: list[str] = Field(default_factory=list, max_length=3)
    researched_at: datetime | None = None
    research_source: Literal["AI", "CASE_FILE"] | None = None
    research_stale: bool = False
    title: str
    customer_name: str
    opportunity_item: str
    relation_status: RelationStatus
    relation_note: str | None = Field(default=None, description="예: 기존 (2024년 아연도금 견적)")
    purpose: Purpose
    owner: str | None = None
    classification_code: ClassificationCode
    core_evidence_recheck: bool = False
    score_display: str = Field(
        description=(
            "'<E>점 · <n>/<전체>'(예: '77점 · 7/8'), 판정 0개면 '--', "
            "소개서 묶음이면 '참고 ' 접두(예: '참고 50점 · 3/8') "
            "(BR10.2, PM 결정 2026-10-28 #180)"
        )
    )
    is_virtual: bool
    dataset_kind: DatasetKind
    is_recontact: bool = False
    homepage_url: str | None = Field(
        default=None,
        description=(
            "상대 회사 공개 홈페이지 뿌리 주소. 근거 출처(sourceRef)의 주소에서 가장 많이 나온 "
            "뿌리(scheme+host)를 쓴다. 주소 있는 근거가 없으면 null(더하는 변경 2026-10-27, #176)"
        ),
    )


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
    replied_by: str | None = None
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
    evidence_ids: list[str] = Field(
        default_factory=list,
        description=(
            "이 항목 판정에 쓴 근거 ID 목록(evidence[].evidenceId와 같은 값, 정렬). "
            "요약 줄 끝 출처를 원문 링크로 잇는 데 쓴다(더하는 변경 2026-10-27, #176)"
        ),
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


class ContactCount(_ApiModel):
    total: int = 0
    call: int = 0
    email: int = 0
    visit: int = 0


class DetailRecords(_ApiModel):
    contact_count: ContactCount = Field(default_factory=ContactCount)
    opinion: OpinionRecord | None = None
    bookmark: BookmarkRecord | None = None
    approval: dict[str, Any] | None = None
    outcome: dict[str, Any] | None = None


class ReviewItem(_ApiModel):
    item_id: str
    kind: ReviewItemKind
    source: ReviewItemSource
    text: str
    target_label: Literal["상대 회사", "거산"] | None = None
    checked: bool = False
    checked_by: str | None = None
    checked_at: datetime | None = None
    reply_text: str | None = None
    replied_at: str | None = None
    replied_by: str | None = None
    step_options: list[str] | None = Field(
        default=None, description="AI 점수 제안의 허용 단계 이름. 다른 검토사항은 null(#497)"
    )


class QuestionReplyRequest(_RequestModel):
    reply_text: str = Field(min_length=1, max_length=500, strict=True)
    replied_at: date


class QuestionReplyResponse(_ApiModel):
    question_id: str
    reply_text: str
    replied_at: date
    replied_by: str


class ReviewCheckRequest(_RequestModel):
    checked: bool = Field(strict=True)
    eval_id: str = Field(min_length=1)
    step_label: str | None = Field(
        default=None,
        strict=True,
        description="AI 점수 제안의 고칠 단계. 생략하면 그대로 확정(#497)",
    )


class ReviewCheckResponse(_ApiModel):
    item_id: str
    checked: bool
    checked_by: str
    checked_at: datetime


class OpportunityDetail(_ApiModel):
    """근거 상세 S2. 영역별 구성 함수(detail_sections)가 순서대로 조립한다 (BR10.5)."""

    header: DetailHeader
    review_items: list[ReviewItem] = Field(default_factory=list)
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
class NoteRequest(_RequestModel):
    kind: Literal["MEMO", "RESEARCH"] = "MEMO"
    text: str
    eval_id: str | None = None
    expected_version: int | None = Field(default=None, ge=0)
    memo: str | None = Field(default=None, max_length=200)


class NoteResponse(RecordMeta):
    note_id: str


class MainPhoneConfirmRequest(_RequestModel):
    expected_phone: str


class MainPhoneConfirmResponse(_ApiModel):
    main_phone: str
    main_phone_confirmed_at: datetime
    main_phone_confirmed_by: str


OutcomeStatus = Literal[
    "NOT_EXECUTED",
    "IN_PROGRESS",
    "SAMPLE_OR_REGISTRATION_APPROVED",
    "ON_HOLD",
    "WON",
    "LOST",
]


class OutcomeRequest(_RequestModel):
    """계약 C1의 코드 값. #211 공통 코드표와 같은 계약으로 연결한다."""

    status: OutcomeStatus
    reply_received: bool = False
    next_schedule_at: date | None = None
    next_schedule_note: str | None = None
    reason: str | None = None
    lost_reason_code: LostReasonCode | None = None
    action_id: str | None = None
    method: Literal["CALL", "EMAIL", "VISIT"] | None = None
    result: Literal["REACHED", "ABSENT", "DECLINED"] | None = None
    attempted_at: date | None = None
    judgment_check: JudgmentCheck | None = None
    eval_id: str | None = None
    expected_version: int | None = Field(default=None, ge=0)
    memo: str | None = Field(default=None, max_length=200)


class OutcomeResponse(RecordMeta):
    status: OutcomeStatus


class BookmarkRequest(_RequestModel):
    """관심 켜고 끄기 요청(#356). 관심은 평가와 무관해 evalId를 받지 않는다."""

    active: bool
    expected_version: int | None = Field(default=None, ge=0)


class BookmarkResponse(BookmarkRecord):
    """응답 data: RecordMeta + active. 이전 값은 meta.previousValue."""


class RelationRequest(_RequestModel):
    relation_status: RelationStatus
    eval_id: str = Field(min_length=1, strict=True)


class RelationResponse(_ApiModel):
    relation_status: RelationStatus
    relation_confirmed_at: date
    relation_confirmed_by: str
    eval_id: str


class ActivityItem(_ApiModel):
    at: datetime
    actor: str
    kind: str
    summary: str
    previous_value: str | None = None
    eval_id: str | None = None


OutcomeEnvelope = Envelope[OutcomeResponse]
BookmarkEnvelope = Envelope[BookmarkResponse]
RelationEnvelope = Envelope[RelationResponse]
QuestionReplyEnvelope = Envelope[QuestionReplyResponse]
ReviewCheckEnvelope = Envelope[ReviewCheckResponse]
MainPhoneConfirmEnvelope = Envelope[MainPhoneConfirmResponse]
ActivityEnvelope = Envelope[list[ActivityItem]]
NoteEnvelope = Envelope[NoteResponse]
ConfigUiEnvelope = Envelope[ConfigUi]
OpportunityListEnvelope = Envelope[list[OpportunityCard]]
OpportunityDetailEnvelope = Envelope[OpportunityDetail]
OpinionEnvelope = Envelope[OpinionResponse]
