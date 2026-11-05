// 경계 파일: 고치려면 PM에게 먼저 말한다(계약 C1).
// 서버 응답 타입. 파이썬 `geosan/api/schemas.py`와 같은 모양이며 필드 이름은 계약 C1 그대로(camelCase).
// 화면은 모르는 필드를 무시하고(받는 쪽 규칙), 서버가 기준이다. 뒤 단위는 타입을 "추가만" 한다.

export type DatasetKind = 'VIRTUAL_REVIEWED' | 'BROCHURE' | 'COMPANY_CONFIRMED';

export type ClassificationCode =
  | 'FILTER_EXCLUDED'
  | 'FILTER_PENDING'
  | 'OPS_PENDING'
  | 'NOT_EVALUATED'
  | 'CONTACT_URGENT'
  | 'CONTACT_PLANNED'
  | 'CONTACT_REVIEW'
  | 'RESEARCH'
  | 'CONDITIONAL_WAIT'
  | 'WATCH'
  | 'LOW';

export type ReviewStatus = 'UNAVAILABLE' | 'PENDING' | 'REVIEWED' | 'RECHECK';
export type RelationStatus = 'NEW_CONFIRMED' | 'EXISTING_CONFIRMED' | 'UNCONFIRMED';
/** 점수 확인 상태(#263): CONFIRMED 확정, PENDING 거래 확인 전(값은 있으나 확정 전), NONE 점수 없음 */
export type ScoreState = 'CONFIRMED' | 'PENDING' | 'NONE';
export type Purpose = 'NEW_PROPOSAL' | 'FOLLOW_UP_PROPOSAL' | 'REORDER_CHECK';
export type ReqLevel = 'REQUIRED' | 'PREFERRED' | 'NOT_REQUIRED' | 'UNKNOWN';
export type NeededStage = 'NOW' | 'LATER' | 'UNKNOWN';
export type CheckDisplay =
  'PASS' | 'LATER_STAGE' | 'QUESTION_NEEDED' | 'PENDING_BLOCKS' | 'EXCLUDED';
export type FilterState = 'PASS' | 'PENDING' | 'EXCLUDED';
export type Certainty = 'CONFIRMED' | 'STRONG' | 'WEAK' | 'UNKNOWN';
export type SourceGrade = 'A' | 'B' | 'C' | 'D';
export type Opinion = 'WORTH_REVIEW' | 'NEED_CHECK' | 'NOT_TARGET';
export type QuestionStatus = 'WAITING' | 'REQUESTED' | 'REPLIED' | 'APPLIED';
export type QuestionTargetKind =
  'QUALIFICATION' | 'PROCESS' | 'CAPABILITY' | 'FIELD' | 'REQUIREMENT' | 'OPPORTUNITY';

/** 성공 응답 meta (C1 공통). */
export interface Meta {
  updatedAt?: string | null;
  hasVirtualData?: boolean;
  datasetKind?: DatasetKind | null;
  previousValue?: Record<string, unknown> | null;
  reevaluated?: boolean | null;
  evaluatedAsNew?: boolean | null;
  total?: number | null;
  notEvaluatedCount?: number | null;
}

/** 성공 응답 `{ data, meta }`. */
export interface Envelope<T> {
  data: T;
  meta: Meta;
}

export interface ErrorField {
  path: string;
  message: string;
  line?: number | null;
}

/** 오류 응답 `{ error: { message, nextAction, ref, kind?, fields? } }` (계약 3장). */
export interface ErrorBody {
  message: string;
  nextAction: string;
  ref: string;
  kind?: string | null;
  fields?: ErrorField[] | null;
  retryAfterSeconds?: number | null;
}

export interface ErrorResponse {
  error: ErrorBody;
}

/** 기록마다 붙는 동시 수정 정보. */
export interface RecordMeta {
  version: number;
  updatedBy: string;
  updatedAt: string;
}

// ---------- GET /config/ui ----------

export interface StaffEntry {
  key: string;
  displayName: string;
}

export interface Brand {
  logoUrl: string | null;
  brandName: string;
  colorPrimary: string;
  demoLabel: string | null;
}

/** 기록 설정(C7 records, 더하는 변경 #209). 서버가 아직 안 주면 없음. */
export interface RecordsConfig {
  approvalEnabled: boolean;
  noteMaxLength: number;
}

export interface ConfigUi {
  records?: RecordsConfig;
  staff: StaffEntry[];
  brand: Brand;
  classificationLabels: Record<string, string>;
  activeDatasetKind: DatasetKind;
  accessProtectionEnabled: boolean;
  ruleVersion: string;
}

// ---------- GET /opportunities (S1 카드) ----------

export interface Blocker {
  text: string;
  blocksApproval: boolean;
}

export interface OpinionRecord extends RecordMeta {
  opinion: Opinion | null;
  reason?: string | null;
  memo?: string | null;
}

/** 영업 단계 기록(C1 records.outcome). 카드에는 단계 꼬리표용으로 status만 쓴다. */
export type OutcomeStatus =
  | 'NOT_EXECUTED'
  | 'INTERESTED'
  | 'IN_PROGRESS'
  | 'SAMPLE_OR_REGISTRATION_APPROVED'
  | 'ON_HOLD'
  | 'WON'
  | 'LOST';
/** 거절 이유 코드(C0 lostReasonCode, 더하는 변경 2026-11-04). 영업 단계 LOST 저장 때 필수. */
export type LostReasonCode =
  'PRICE' | 'LEAD_TIME' | 'INCUMBENT_SUPPLIER' | 'NO_DEMAND' | 'QUALITY_CERT' | 'OTHER';
export type ContactMethod = 'CALL' | 'EMAIL' | 'VISIT';
export type ContactResult = 'REACHED' | 'ABSENT' | 'DECLINED';
export type NoteKind = 'MEMO' | 'RESEARCH';

export interface OutcomeRecord extends RecordMeta {
  status?: OutcomeStatus | null;
  /** 최신 단계가 LOST일 때의 거절 이유 코드, 아니면 null. */
  lostReasonCode?: LostReasonCode | null;
  nextScheduleAt?: string | null;
  nextScheduleNote?: string | null;
}

export interface CardRecords {
  opinion?: OpinionRecord | null;
  bookmark?: Record<string, unknown> | null;
  outcome?: OutcomeRecord | null;
}

export interface OpportunityCard {
  /** 점수 확인 상태(#263). 없으면(옛 응답) 지금처럼 보인다. */
  scoreState?: ScoreState;
  /** 거래 관계(#263). EXISTING_CONFIRMED면 점수 옆에 "기존 거래처" 꼬리표. */
  relationStatus?: RelationStatus;
  oppId: string;
  rank: number;
  title: string;
  classificationCode: ClassificationCode;
  coreEvidenceRecheck: boolean;
  scoreS: number | null;
  /** 서버가 만든 점수 글자 그대로 보인다: '77점 · 7/8', '참고 50점 · 3/8'(점수 · 조사한 항목 수/전체), 점수 전에는 '--' (BR10.2, #180) */
  scoreDisplay: string;
  reason: string;
  blocker: Blocker;
  nextAction: string;
  records: CardRecords;
  stage?: number | null;
  isVirtual: boolean;
  isRecontact: boolean;
  recontact?: Record<string, unknown> | null;
  evalId: string;
  reevaluated: boolean;
  datasetKind: DatasetKind;
}

// ---------- GET /opportunities/{oppId} (S2 상세) ----------

export interface DetailHeader {
  /** 점수 확인 상태(#263). 없으면(옛 응답) 지금처럼 보인다. */
  scoreState?: ScoreState;
  title: string;
  customerName: string;
  opportunityItem: string;
  relationStatus: RelationStatus;
  relationNote?: string | null;
  purpose: Purpose;
  owner?: string | null;
  classificationCode: ClassificationCode;
  coreEvidenceRecheck: boolean;
  scoreDisplay: string;
  /** 회사 페이지 뿌리 주소(더하는 변경 #176). 없으면 null/없음. 화면은 http(s)일 때만 링크로 보인다. */
  homepageUrl?: string | null;
  /** 회사 주소(C1 header.address). 지도 링크를 만드는 데만 쓴다. */
  address?: string | null;
  isVirtual: boolean;
  datasetKind: DatasetKind;
  isRecontact: boolean;
}

export interface Question {
  questionId: string;
  text: string;
  targetKind: QuestionTargetKind;
  targetId: string;
  currentValue?: string | null;
  effectIfAnswered: string;
  status: QuestionStatus;
  requestedBy?: string | null;
  requestedAt?: string | null;
  dueAt?: string | null;
  overdue: boolean;
  replyText?: string | null;
  repliedAt?: string | null;
  /** 답을 적은 담당자 키(더하는 변경 2026-11-04, 검토사항 [답 적기]). */
  repliedBy?: string | null;
  linkedOppIds: string[];
  isUserAdded: boolean;
}

export interface Reasons {
  reason: string;
  nextAction: string;
  questions: Question[];
}

export interface RequirementCheckView {
  reqId: string;
  name: string;
  reqLevel: ReqLevel;
  neededStage: NeededStage;
  dueAt?: string | null;
  capabilityStatus?: ReviewStatus | null;
  result: CheckDisplay;
  reason: string;
}

export interface ApprovalEligibility {
  eligible: boolean;
  reason: string;
  readinessChecked: boolean;
  readinessNeedsRecheck: boolean;
  allowedPurposes: string[];
}

export interface ProcessLinkView {
  linkId: string;
  processCode: string;
  processName?: string | null;
  appliedMaterial?: string | null;
  result?: FilterState | null;
  reason?: string | null;
}

export interface EvidenceView {
  evidenceId: string;
  sourceGrade: SourceGrade;
  certainty: Certainty;
  isLlmProposed: boolean;
  quote: string;
  sourceRef: string;
  occurredAt?: string | null;
  subject: string;
}

export interface ScoreItemView {
  itemCode: string;
  label: string;
  state: string;
  weight: number;
  matchRate?: number | null;
  certainty?: number | null;
  decay?: number | null;
  score?: number | null;
  factJudged?: string | null;
  /** 상세용 쉬운 요약 한 줄(더하는 변경 #139). 없으면 null/없음. */
  summary?: string | null;
  /** 이 항목에 쓴 근거 ID 목록(더하는 변경 #176). evidence[]에서 같은 evidenceId를 찾는다. */
  evidenceIds?: string[];
}

export interface Scores {
  E: number;
  P: number;
  S: number | null;
  R: number;
  C: number;
  items: ScoreItemView[];
  ruleVersion: string;
  datasetKind: DatasetKind;
  batchId: string;
  evaluatedAt: string;
}

export interface ContactCount {
  total: number;
  call: number;
  email: number;
  visit: number;
}

export interface DetailRecords {
  opinion?: OpinionRecord | null;
  bookmark?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
  outcome?: OutcomeRecord | null;
  contactCount?: ContactCount | null;
}

/** 검토사항 한 줄(C1 reviewItems, 더하는 변경 2026-11-03 밤). 목록은 평가 결과에서 파생되고 체크 상태만 저장된다. */
export type ReviewItemKind = 'QUESTION' | 'DATA_NOT_FOUND' | 'DATA_INSUFFICIENT';
export type ReviewItemSource = 'AI' | 'CASE_FILE' | 'RULE';
export type ReviewTargetLabel = '상대 회사' | '거산';

export interface ReviewItem {
  itemId: string;
  kind: ReviewItemKind;
  source: ReviewItemSource;
  text: string;
  targetLabel?: ReviewTargetLabel | null;
  checked: boolean;
  checkedBy?: string | null;
  checkedAt?: string | null;
  /** 질문 줄(QUESTION)의 최신 답. 질문 표의 회신 칸 그대로(더하는 변경 2026-11-04). */
  replyText?: string | null;
  repliedAt?: string | null;
  repliedBy?: string | null;
}

export interface OpportunityDetail {
  header: DetailHeader;
  stage?: Record<string, unknown> | null;
  reasons: Reasons;
  requirements: RequirementCheckView[];
  approvalEligibility: ApprovalEligibility;
  processLinks: ProcessLinkView[];
  evidence: EvidenceView[];
  homepageNeedsConfirm: boolean;
  scores: Scores | null;
  records: DetailRecords;
  /** 서버가 아직 안 주면 없음 → 화면은 예전처럼 1번 영역 안의 확인 질문을 보인다. */
  reviewItems?: ReviewItem[];
  recontact?: Record<string, unknown> | null;
  evalId: string | null;
  previousEvalId: string | null;
  reevaluated: boolean;
}

// ---------- POST /opportunities/{oppId}/opinions (S3 의견) ----------

export interface OpinionRequest {
  opinion: Opinion;
  evalId: string;
  expectedVersion?: number | null;
  reason?: string | null;
  memo?: string | null;
}

export type OpinionResponse = OpinionRecord;

// ---------- POST /notes, POST /outcomes (U5 기록) ----------

export interface NoteRequest {
  text: string;
  kind?: NoteKind;
  evalId?: string | null;
}

export interface NoteResponse extends RecordMeta {
  noteId: string;
}

export interface OutcomeRequest {
  status: OutcomeStatus;
  evalId?: string | null;
  expectedVersion?: number | null;
  reason?: string;
  /** status가 LOST일 때만 보낸다(필수). 다른 단계에서 보내면 서버가 400. OTHER면 reason도 필수. */
  lostReasonCode?: LostReasonCode;
  nextScheduleAt?: string;
  nextScheduleNote?: string;
  method?: ContactMethod;
  result?: ContactResult;
  attemptedAt?: string;
}

export interface OutcomeResponse extends RecordMeta {
  status: OutcomeStatus;
  lostReasonCode?: LostReasonCode | null;
  nextScheduleAt?: string | null;
  nextScheduleNote?: string | null;
}

// ---------- POST /review-items/{itemId}/check, GET /activity (검토사항·타임라인) ----------

export interface ReviewCheckRequest {
  checked: boolean;
  evalId: string;
}

export interface ReviewCheckResponse {
  itemId: string;
  checked: boolean;
  checkedBy?: string | null;
  checkedAt?: string | null;
}

// ---------- POST /questions/{questionId}/reply (검토사항 [답 적기], 2026-11-04) ----------

export interface ReplyRequest {
  /** 500자까지. */
  replyText: string;
  /** 날짜(YYYY-MM-DD). */
  repliedAt: string;
}

export interface ReplyResponse {
  questionId: string;
  replyText: string;
  repliedAt: string;
  repliedBy: string | null;
}

export type ActivityKind =
  | 'CLASSIFICATION'
  | 'OPINION'
  | 'BOOKMARK'
  | 'APPROVAL'
  | 'CONTACT_ATTEMPT'
  | 'REPLY'
  | 'OUTCOME'
  | 'EVIDENCE_GRADE_CONFIRMED'
  | 'NOTE';

/** 활동 이력 한 줄(C1 ActivityItem). actor는 담당자 키 또는 system. */
export interface ActivityItem {
  at: string;
  actor: string;
  kind: ActivityKind;
  summary: string;
  previousValue?: string | null;
  evalId?: string | null;
}

export type ConfigUiEnvelope = Envelope<ConfigUi>;
export type OpportunityListEnvelope = Envelope<OpportunityCard[]>;
export type OpportunityDetailEnvelope = Envelope<OpportunityDetail>;
export type OpinionEnvelope = Envelope<OpinionResponse>;
