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
export type HomepageStatus = 'AI_FOUND' | 'NEEDS_CONFIRMATION' | 'CONFIRMED' | 'NOT_FOUND';
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
  /** 목록 머리용(#210). 공정 탭: 기회가 있는 공정만, 역량 파일 순서. */
  processCounts?: ProcessCount[] | null;
  /** 지역·산업 선택지와 건수. 현재 공정 탭 안 건수이고 0건은 서버가 빼서 준다. */
  regionCounts?: RegionCount[] | null;
  industryCounts?: IndustryCount[] | null;
  /** 마지막 후보 수집 회차 요약(#316, 계약 C1 `meta.latestIngest`). 한 번도 안 가져왔으면 null·없음. */
  latestIngest?: LatestIngest | null;
}

/** 후보 수집 회차 상태(계약 C1). 가져오는 중 / 끝남 / 실패. */
export type IngestStatus = 'RUNNING' | 'DONE' | 'FAILED';

/**
 * 마지막 후보 수집 회차 요약(계약 C1 `meta.latestIngest`, 2026-11-05 PM 결정 ①·후보 찾기 1차).
 * 목록 머리 "훑어본 ○곳 · 고른 ○곳 · 조사 ○/○"에 쓴다. 건수 칸은 서버가 아직 안 주면 없다.
 */
export interface LatestIngest {
  batchId: string;
  status: IngestStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  /** 파일에서 지역으로 추린 회사 수. */
  scannedCount?: number | null;
  /** AI가 판단을 끝낸 수. */
  judgedCount?: number | null;
  /** 고른 수(목록에 들어온 새 회사). */
  pickedCount?: number | null;
  /** 새 회사 가운데 자동 조사를 끝낸 수. */
  researchDoneCount?: number | null;
  /** 이름이 비슷해 "확인 필요"로 남은 수. */
  mergeCandidateCount?: number | null;
}

/**
 * 후보 가져오기 요청(계약 C1 `POST /ingest` 본문, #316). 공정은 1개 이상 필수이고,
 * 지역·산업은 보내지 않으면 서버가 설정 전체로 본다. 설정에 없는 값은 서버가 400으로 돌려준다.
 */
export interface IngestRequest {
  processCodes: string[];
  regions?: string[];
  industries?: string[];
}

/** 후보 가져오기 응답. 회차를 만든 직후 바로 오고, 진행은 목록 `meta.latestIngest`로 본다. */
export interface IngestResponse {
  batchId: string;
  newCount: number;
  mergeCandidateCount: number;
  skippedCount: number;
}

export interface ProcessCount {
  processCode: string;
  processName: string;
  count: number;
}
export interface RegionCount {
  region: string;
  count: number;
}
export interface IndustryCount {
  industry: string;
  count: number;
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

/**
 * 영업 단계 기록(C1 records.outcome). 카드에는 단계 꼬리표용으로 status만 쓴다.
 * "관심"은 단계가 아니라 따로 켜고 끄는 표시(`records.bookmark`)다(약속 v3, 2026-11-06 PM 결정 #356).
 */
export type OutcomeStatus =
  | 'NOT_EXECUTED'
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
  /** 이 회사 주소의 시·군(예: 아산시). 주소가 없으면 null이고 카드는 "지역 미확인"을 보인다(#210). */
  region?: string | null;
  /** 산업군(사례 파일에 사람이 적은 값, 최대 3개). 비어 있으면 카드는 "산업 미확정"을 보인다. */
  industries?: string[];
  /** 이 기회가 걸린 공정 코드들. 카드는 공정 이름 꼬리표로 바꿔 보인다. */
  processCodes?: string[];
  /** AI가 이 회사를 고른 이유 한 줄(#316, 후보 찾기로 들어온 회사만). 없으면 줄을 그리지 않는다. */
  pickReason?: string | null;
  /** 마지막 수집 회차에 들어온 회사면 true → 꼬리표 "이번에 들어옴". */
  isNewInLatestBatch?: boolean;
  /** 이 회사가 들어온 시각(ISO). 꼬리표 날짜에 쓴다. 사례 파일 회사는 null. */
  ingestedAt?: string | null;
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
  /** 거래 관계를 담당자가 마지막으로 바꾼 날(YYYY-MM-DD)과 담당자 키. 한 번도 안 바꿨으면 없음(#266). */
  relationConfirmedAt?: string | null;
  relationConfirmedBy?: string | null;
  /** 홈페이지 상태. NEEDS_CONFIRMATION·NOT_FOUND면 맨 위 띠가 보인다(결정 B). 없으면 띠 없음. */
  homepageStatus?: HomepageStatus | null;
  /** 거산에서 떨어진 거리(km). 거리 기능(#222) 전까지 null이고, 없으면 보이지 않는다. */
  distanceKm?: number | null;
  /** 회사 대표번호(내부 메모장용, 2026-11-03 PM 결정)와 출처·담당자 확인(#209). */
  mainPhone?: string | null;
  mainPhoneSource?: 'HOMEPAGE' | 'CSV' | null;
  mainPhoneSourceUrl?: string | null;
  mainPhoneConfirmedAt?: string | null;
  mainPhoneConfirmedBy?: string | null;
  /** 기업 요약: 한 줄 소개, 특징(최대 3개), 조사 시각, 출처(AI 또는 사례 파일), 오래됨. */
  summaryLine?: string | null;
  highlights?: string[];
  researchedAt?: string | null;
  researchSource?: 'AI' | 'CASE_FILE' | null;
  researchStale?: boolean;
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

// ---------- POST /opportunities/{oppId}/main-phone/confirm (대표번호 [맞음], #209) ----------

export interface MainPhoneConfirmRequest {
  /** 지금 화면에 보이는 번호. 그 사이 번호가 바뀌었으면 서버가 409(STALE_VALUE)로 막는다. */
  expectedPhone: string;
}

export interface MainPhoneConfirmResponse {
  mainPhone: string;
  mainPhoneConfirmedAt: string;
  mainPhoneConfirmedBy: string;
}

// ---------- POST /opportunities/{oppId}/relation (거래 관계 입력, #265·#266) ----------

export interface RelationRequest {
  relationStatus: RelationStatus;
  /** 지금 보고 있는 평가 ID. 그 사이 다시 평가됐으면 서버가 409(STALE_EVALUATION)로 막는다. */
  evalId: string;
}

export interface RelationResponse {
  relationStatus: RelationStatus;
  relationConfirmedAt: string;
  relationConfirmedBy: string;
  /** 저장 뒤 다시 평가한 새 평가 ID. */
  evalId: string;
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
  | 'RELATION_CONFIRMED'
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
