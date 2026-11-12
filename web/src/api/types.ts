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
/** 조사 상태(#596). 카드는 "조사 중"/"조사 중단"만, 상세는 멈춘 이유까지 보인다. */
export type ResearchState =
  'RUNNING' | 'NO_SCORE_EVIDENCE' | 'NOT_FOUND' | 'READ_FAILED' | 'NOT_TRIED';
export type HomepageStatus = 'AI_FOUND' | 'NEEDS_CONFIRMATION' | 'CONFIRMED' | 'NOT_FOUND';
export type Purpose = 'NEW_PROPOSAL' | 'FOLLOW_UP_PROPOSAL' | 'REORDER_CHECK';
export type ReqLevel = 'REQUIRED' | 'PREFERRED' | 'NOT_REQUIRED' | 'UNKNOWN';
export type NeededStage = 'NOW' | 'LATER' | 'UNKNOWN';
export type CheckDisplay =
  'PASS' | 'LATER_STAGE' | 'QUESTION_NEEDED' | 'PENDING_BLOCKS' | 'EXCLUDED';
export type FilterState = 'PASS' | 'PENDING' | 'EXCLUDED';
export type Certainty = 'CONFIRMED' | 'STRONG' | 'WEAK' | 'UNKNOWN';
export type SourceGrade = 'A' | 'B' | 'C' | 'D';

/** 후보 찾기의 공정 적합도(C0 fitLevel). */
export type FitLevel = 'HIGH' | 'MEDIUM' | 'LOW';
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
  /** 목록 머리 공정 선택란용(#210 → #361). 거산 공정 전부, 역량 파일 순서. 회사가 0곳인 공정도 count 0으로 온다. */
  processCounts?: ProcessCount[] | null;
  /** 지역·산업 선택지와 건수. 지금 고른 공정 안 건수이고 0건은 서버가 빼서 준다. */
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
  // ---- 아래는 더하는 칸(#442, PM 결정 2026-11-08). 서버가 아직 안 주면 없다. ----
  sourceId?: string;
  /** 찾기 조건. 조건 없이 돌린 회차는 null. */
  criteria?: IngestCriteria | null;
  /** 목록에 새로 들어온 회사 수. */
  newCount?: number | null;
  /** AI 한도에 걸려 판단이 남은 수. */
  judgePendingCount?: number | null;
  /** 찾기가 실패했을 때의 사유 한 줄(서버가 준 쉬운 말). 실패가 아니면 null. */
  failureReason?: string | null;
  webSearchUsed?: boolean;
  webCandidateCount?: number | null;
  /** 채용·유료 사이트 결과, 출처 없음, 홈페이지 미확인으로 버린 수. */
  webDroppedCount?: number | null;
  webFromCache?: boolean;
  /** 웹 검색을 건너뛴 이유 코드. 건너뛰지 않았으면 null. */
  webSkippedReason?: WebSkippedReason | null;
  /** 단지 목록 조회를 건너뛴 이유 코드. 건너뛰지 않았으면 null. */
  complexListSkippedReason?: ComplexListSkippedReason | null;
}

/** 찾기 회차의 조건(계약 C1 `POST /ingest` 본문과 같은 이름). */
export interface IngestCriteria {
  processCodes: string[];
  regions: string[];
  industries: string[];
}

/** 웹 검색을 건너뛴 이유(계약 C1): 하루 한도 / 꺼 둠. */
export type WebSkippedReason = 'DAILY_LIMIT' | 'DISABLED';

/** 단지 목록 조회를 건너뛴 이유(계약 C1): 하루 한도 / 소스 읽기 실패 / 꺼 둠. */
export type ComplexListSkippedReason = 'DAILY_LIMIT' | 'SOURCE_ERROR' | 'DISABLED';

/**
 * 후보 가져오기 요청(계약 C1 `POST /ingest` 본문, #316). 공정은 1개 이상 필수이고,
 * 지역·산업은 보내지 않으면 서버가 설정 전체로 본다. 설정에 없는 값은 서버가 400으로 돌려준다.
 */
export interface IngestRequest {
  processCodes: string[];
  regions?: string[];
  industries?: string[];
}

/**
 * 고른 조건의 맞는 공장 수(계약 C1 `GET /ingest/preview`, #549 1단계). 서버가 저장된 AI 판단만 세서 0원이다.
 * 예상 금액·잠금 칸은 2단계에서 더한다.
 */
export interface IngestPreview {
  matchedCount: number;
  fitCounts: { HIGH: number; MEDIUM: number; LOW: number };
  registeredCount: number;
  addableCount: number;
  addableHighCount: number;
  unjudgedCount: number;
  addCount: number;
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
  /** 기록 취소(#253·#254): true면 남의 기록도 취소할 수 있다. 안 주면 본인 기록만(false). */
  cancelByAnyStaff?: boolean;
}

/** 후보 가져오기 조건 칸의 선택지(C1 더하는 변경 #424). 서버가 아직 안 주면 없음. */
export interface IngestOptionsConfig {
  /** 활성 묶음 역량 파일의 공정 전부(기회 0건인 공정도 포함, 역량 파일 순서 그대로). */
  processes: { code: string; name: string }[];
  regions: string[];
  industries: string[];
}

export interface ConfigUi {
  records?: RecordsConfig;
  ingestOptions?: IngestOptionsConfig;
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
  'NOT_EXECUTED' | 'IN_PROGRESS' | 'SAMPLE_OR_REGISTRATION_APPROVED' | 'ON_HOLD' | 'WON' | 'LOST';
/** 거절 이유 코드(C0 lostReasonCode, 더하는 변경 2026-11-04). 영업 단계 LOST 저장 때 필수. */
export type LostReasonCode =
  'PRICE' | 'LEAD_TIME' | 'INCUMBENT_SUPPLIER' | 'NO_DEMAND' | 'QUALITY_CERT' | 'OTHER';
export type ContactMethod = 'CALL' | 'EMAIL' | 'VISIT';
export type ContactResult = 'REACHED' | 'ABSENT' | 'DECLINED';
export type JudgmentCheck = 'MATCHED' | 'MISMATCHED' | 'UNKNOWN';
export type NoteKind = 'MEMO' | 'RESEARCH';

export interface OutcomeRecord extends RecordMeta {
  status?: OutcomeStatus | null;
  /** 최신 단계가 LOST일 때의 거절 이유 코드, 아니면 null. */
  lostReasonCode?: LostReasonCode | null;
  nextScheduleAt?: string | null;
  nextScheduleNote?: string | null;
}

/**
 * 관심 표시(C1 records.bookmark, 약속 v3 2026-11-06 PM 결정 #356). 한 번도 켠 적이 없으면 null이고,
 * 관심 기업인지는 `active === true`로 본다. 팀이 함께 쓰는 값이라 누가 언제 바꿨는지가 같이 온다.
 */
export interface BookmarkRecord extends RecordMeta {
  active: boolean;
}

export interface CardRecords {
  opinion?: OpinionRecord | null;
  bookmark?: BookmarkRecord | null;
  outcome?: OutcomeRecord | null;
}

/** 팩토리온 공장조회에서 붙인 공장 등록 정보(C1 factoryProfile, #573). 순서·점수에는 쓰지 않는다. */
export interface FactoryProfile {
  rawMaterials: string | null;
  /** 공장 등록 때 적은 인원. 갱신되지 않을 수 있어 화면은 언제나 "(추정)"으로 보인다. */
  employeeCount: number | null;
  scale: string | null;
  /** 자료 기준일 YYYY-MM-DD */
  fileDate: string;
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
  /**
   * 표면처리를 직접 하는 회사일 수 있음(#319, 계약 C1). 참이면 꼬리표 "…확인 필요"를 붙인다.
   * 자동으로 빼지 않는다(FR9.3): 서버도 화면도 목록에서 회사를 빼지 않고, 제외는 담당자의 검토 의견으로만 한다.
   * 서버가 안 주거나 거짓이면 아무것도 보이지 않는다.
   */
  ownPlatingLineSuspected?: boolean;
  /** 그 표시의 근거 한 줄. 예: 생산품 "알루미늄 아노다이징". 없으면 꼬리표만 보인다. */
  ownPlatingLineBasis?: string | null;
  /** 공장 등록 정보(#573). 맞는 공장이 없으면 null이고 줄을 그리지 않는다. */
  factoryProfile?: FactoryProfile | null;
  /** 점수 확인 상태(#263). 없으면(옛 응답) 지금처럼 보인다. */
  scoreState?: ScoreState;
  /**
   * 점수가 아직 없는 찾은 회사의 조사 상태(#596). "점수 전" 옆에 "조사 중" 또는 "조사 중단"이 붙는다.
   * 점수가 있거나 사례 파일 회사면 null(또는 옛 응답이라 없음)이고 아무것도 붙지 않는다.
   */
  researchState?: ResearchState | null;
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
  /** 카드와 같은 조사 상태(#596). 점수 줄 옆에 "조사 중" 또는 "조사 중단 · 이유"가 붙는다. */
  researchState?: ResearchState | null;
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
  /** 표면처리를 직접 하는 회사일 수 있음(#319, #364). 참이면 머리 이름 옆에 꼬리표만 보인다(근거 줄은 카드·검토사항에서). 없거나 거짓이면 아무것도 안 보인다. */
  ownPlatingLineSuspected?: boolean;
  /** 회사 주소(C1 header.address). 지도 링크를 만드는 데만 쓴다. */
  address?: string | null;
  /** 후보 찾기 때 저장한 AI 판단(C1 header, #316·#563): 적합도와 고른 이유. 사례 파일 회사는 없음. */
  fitLevel?: FitLevel | null;
  pickReason?: string | null;
  /** 이 회사를 찾은 경로와 그 출처 주소(웹 검색으로 찾았을 때만 주소가 있다). */
  discoverySource?: string | null;
  discoverySourceUrl?: string | null;
  /** 산업 꼬리표(AI 제안 또는 사람이 고친 값). */
  industries?: string[];
  /** 공장 등록 정보(#573). 없으면 "이 회사 한눈에"에 줄을 그리지 않는다. */
  factoryProfile?: FactoryProfile | null;
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
  bookmark?: BookmarkRecord | null;
  approval?: Record<string, unknown> | null;
  outcome?: OutcomeRecord | null;
  contactCount?: ContactCount | null;
}

/** 검토사항 한 줄(C1 reviewItems, 더하는 변경 2026-11-03 밤). 목록은 평가 결과에서 파생되고 체크 상태만 저장된다. */
export type ReviewItemKind =
  | 'QUESTION'
  | 'DATA_NOT_FOUND'
  | 'DATA_INSUFFICIENT'
  /** 표면처리를 직접 하는 회사일 수 있음(#319, 계약 C1). 출처는 AI 또는 규칙. 서버가 값을 채우기 전에는 오지 않는다. */
  | 'OWN_PLATING_LINE_SUSPECTED'
  /** AI가 제안한 점수 입력 항목(#286·#498, 계약 C0·C1). 줄 번호는 `II:<항목코드>`. [확정]·[고치기]로 담당자 값이 된다. */
  | 'ITEM_INPUT_PROPOSAL'
  /** AI가 제안한 공정 연결(#286·#498). 줄 번호는 `PL:<공정코드>`. 1차는 [확정]만. */
  | 'PROCESS_LINK_PROPOSAL';
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
  /**
   * [고치기] 드롭다운의 선택지(#498, PM 결정 2026-11-09, 더하는 변경). 점수 입력 제안 줄(`II:`)에만 오고,
   * 그 항목의 설정 단계 이름이 설정 순서대로 들어 있다(예: ["정확히 일치", "일부 가능"]). 다른 줄은 null이거나 없다.
   */
  stepOptions?: string[] | null;
  /**
   * 자료 줄(DATA_NOT_FOUND·DATA_INSUFFICIENT)의 최신 자료 조사 메모 하나(#259·#260, 더하는 변경 2026-11-12).
   * 취소되지 않은 것만 온다. 없으면 null이고 다른 종류의 줄은 언제나 null이다. 영업 메모와 같은 취급(내부 전용).
   */
  note?: ReviewItemNote | null;
}

/** 자료 줄에 붙은 메모(C1 reviewItems[].note). by는 담당자 키. */
export interface ReviewItemNote {
  text: string;
  by: string;
  at: string;
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

// ---------- PUT /opportunities/{oppId}/bookmark (관심 켜고 끄기, #356) ----------

export interface BookmarkRequest {
  /** true면 관심으로 켜고 false면 끈다. 기록이 있는 회사는 서버가 끄기를 422로 거부한다. */
  active: boolean;
  expectedVersion?: number | null;
}

export type BookmarkResponse = BookmarkRecord;

// ---------- POST /notes, POST /outcomes (U5 기록) ----------

export interface NoteRequest {
  text: string;
  kind?: NoteKind;
  evalId?: string | null;
  /**
   * 검토사항 자료 줄 번호(#259·#260, 더하는 변경 2026-11-12). 있으면 kind는 RESEARCH여야 하고(아니면 400),
   * 질문 줄이면 400, 없는 줄이면 404, 글자 상한 500자. 없으면 지금과 같은 일반 메모.
   */
  itemId?: string | null;
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
  /** 접촉 때 AI 판단이 맞았나(#531). 접촉 기록에서만 보낸다. */
  judgmentCheck?: JudgmentCheck;
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
  /**
   * [고치기]로 고른 단계 이름(#498, PM 결정 2026-11-09, 더하는 변경). 점수 입력 제안 줄(`II:`)에서
   * `checked: true`와 함께 보내며 그 항목의 설정 단계 이름 중 하나여야 한다. 생략하면 [확정](AI 제안 값 그대로).
   */
  stepLabel?: string | null;
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

// ---------- POST /opportunities/{oppId}/homepage (홈페이지 [맞음]·[고치기]·[다시 조사], #210·#304) ----------

/** 세 가지 중 하나로 보낸다: `{confirmOnly: true}`(맞음), `{url}`(고치기), `{}`(다시 조사), `{pastedText}`(본문 붙여넣기). 맞음과 본문은 함께 못 보낸다(400). */
export interface HomepageRequest {
  url?: string;
  pastedText?: string;
  confirmOnly?: boolean;
}

/** 조사를 실행했을 때의 응답. */
export interface HomepageResearchResponse {
  evidenceCount: number;
  /** evidenceCount 가운데 "요구 후보(미확인)" 수. */
  requirementCandidateCount: number;
  questionCount: number;
  evalId: string;
}

/** [맞음](confirmOnly)을 눌렀을 때의 응답. 외부 호출·재평가 없음. */
export interface HomepageConfirmResponse {
  homepageUrl: string;
  homepageStatus: 'CONFIRMED';
  homepageSource: 'STAFF';
}

export type HomepageResponse = HomepageResearchResponse | HomepageConfirmResponse;

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
  | 'NOTE'
  | 'RECORD_CANCELLED';

/** 취소할 수 있는 저장 행의 종류(C1 ActivityItem.recordKind). NOTE = 메모·자료 조사·답 이력, OUTCOME = 접촉·단계·일정. */
export type RecordKind = 'NOTE' | 'OUTCOME';

/**
 * 활동 이력 한 줄(C1 ActivityItem). actor는 담당자 키 또는 system.
 * 기록 취소(#253·#254) 칸 5개는 서버가 모두 줄 수도, 옛 응답이라 하나도 안 줄 수도 있어 선택으로 둔다.
 */
export interface ActivityItem {
  at: string;
  actor: string;
  kind: ActivityKind;
  summary: string;
  previousValue?: string | null;
  evalId?: string | null;
  /** 이 줄을 만든 저장 행 번호. 취소 단추가 쓴다. 분류·의견·관심·거래 관계·취소 줄은 null. */
  recordId?: string | null;
  recordKind?: RecordKind | null;
  /** 잘못 입력으로 표시된 줄이면 true. 줄은 지우지 않고 화면이 줄을 긋는다. */
  cancelled?: boolean;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
}

// ---------- POST /opportunities/{oppId}/records/{recordId}/cancel (기록 취소 [잘못 입력], 2026-11-12) ----------

export interface RecordCancelRequest {
  /** 이유(선택, 200자까지). */
  reason?: string | null;
  /** 화면이 보고 있던 평가 번호(선택). */
  evalId?: string | null;
}

export interface RecordCancelResponse {
  recordId: string;
  recordKind: RecordKind;
  cancelledBy: string;
  cancelledAt: string;
}

// ---------- GET /opportunities/{oppId}/peers (비슷한 회사 참고, 2026-11-12, 더하는 변경 #268·#269) ----------

/** 접촉 방법 하나의 연결 수(연결됨 reached / 시도 tried). */
export interface PeerContactReach {
  reached: number;
  tried: number;
}

/**
 * 비슷한 회사 요약. 건수만 싣고 메모 글은 넣지 않는다.
 * stageCounts의 키는 영업 단계 코드(outcomeStatus), topLostReasons는 많은 순 최대 3.
 */
export interface PeersSummary {
  processCount: number;
  industryCount: number;
  stageCounts: Record<string, number>;
  topLostReasons: { code: string; count: number }[];
  contactReach: Partial<Record<ContactMethod, PeerContactReach>>;
}

/** 비슷한 회사의 최근 메모 한 줄(서버가 120자에서 자른다). 영업 메모와 같은 취급(내부 전용). */
export interface PeerNote {
  text: string;
  by: string;
  at: string;
}

export interface PeerCompany {
  oppId: string;
  name: string;
  processCodes: string[];
  industries: string[];
  /** 영업 단계 코드. 기록이 없으면 null. */
  outcomeStatus: string | null;
  /** 거절 이유 코드. 단계가 거절일 때만. */
  lostReasonCode: string | null;
  lastContactAt: string | null;
  lastContactMethod: ContactMethod | null;
  lastNote: PeerNote | null;
  sameProcess: boolean;
  sameIndustry: boolean;
}

export interface PeersResponse {
  summary: PeersSummary;
  /** 최대 5곳. 없으면 빈 배열. */
  companies: PeerCompany[];
}

export type ConfigUiEnvelope = Envelope<ConfigUi>;
export type OpportunityListEnvelope = Envelope<OpportunityCard[]>;
export type OpportunityDetailEnvelope = Envelope<OpportunityDetail>;
export type OpinionEnvelope = Envelope<OpinionResponse>;
