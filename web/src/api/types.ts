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
export type Purpose = 'NEW_PROPOSAL' | 'FOLLOW_UP_PROPOSAL' | 'REORDER_CHECK';
export type ReqLevel = 'REQUIRED' | 'PREFERRED' | 'NOT_REQUIRED' | 'UNKNOWN';
export type NeededStage = 'NOW' | 'LATER' | 'UNKNOWN';
export type CheckDisplay = 'PASS' | 'LATER_STAGE' | 'QUESTION_NEEDED' | 'PENDING_BLOCKS' | 'EXCLUDED';
export type FilterState = 'PASS' | 'PENDING' | 'EXCLUDED';
export type Certainty = 'CONFIRMED' | 'STRONG' | 'WEAK' | 'UNKNOWN';
export type SourceGrade = 'A' | 'B' | 'C' | 'D';
export type Opinion = 'WORTH_REVIEW' | 'NEED_CHECK' | 'NOT_TARGET';
export type QuestionStatus = 'WAITING' | 'REQUESTED' | 'REPLIED' | 'APPLIED';
export type QuestionTargetKind =
  | 'QUALIFICATION'
  | 'PROCESS'
  | 'CAPABILITY'
  | 'FIELD'
  | 'REQUIREMENT'
  | 'OPPORTUNITY';

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

export interface ConfigUi {
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

export interface CardRecords {
  opinion?: OpinionRecord | null;
  bookmark?: Record<string, unknown> | null;
}

export interface OpportunityCard {
  oppId: string;
  rank: number;
  title: string;
  classificationCode: ClassificationCode;
  coreEvidenceRecheck: boolean;
  scoreS: number | null;
  /** 정수, '--', '참고 N' (BR10.2) */
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

export interface DetailRecords {
  opinion?: OpinionRecord | null;
  bookmark?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
  outcome?: Record<string, unknown> | null;
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

export type ConfigUiEnvelope = Envelope<ConfigUi>;
export type OpportunityListEnvelope = Envelope<OpportunityCard[]>;
export type OpportunityDetailEnvelope = Envelope<OpportunityDetail>;
export type OpinionEnvelope = Envelope<OpinionResponse>;
