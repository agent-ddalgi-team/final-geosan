// 쉬운 말 대응표 — 화면 문구의 유일한 출처(BR10.9, NFR11.4). 화면 코드에 문구를 직접 적지 않는다.
// 뒤 단위는 여기에 항목을 "추가만" 하고 기존 키를 바꾸지 않는다(U1 확장 지점 규칙).
// 분류 11개의 쉬운 말은 서버 규칙 설정(classificationLabels)이 원본이며, 아래 값은 서버 응답이 없을 때의
// 기본값이다(같은 값, 규칙 설정 BR6.3). 코드표 밖 코드는 `labelFor`가 코드 그대로를 돌려주고 콘솔에 경고한다.
import type { StatusTone } from '../theme/tokens';
import type {
  ActivityKind,
  CheckDisplay,
  ClassificationCode,
  DatasetKind,
  FilterState,
  Opinion,
  QuestionStatus,
  ReviewItemKind,
  ReviewStatus,
} from '../api/types';

export const classificationLabels: Record<ClassificationCode, string> = {
  FILTER_EXCLUDED: '대상 아님(제외)',
  FILTER_PENDING: '필수조건 확인 필요',
  OPS_PENDING: '거산 역량 확인 필요',
  NOT_EVALUATED: '평가 전',
  CONTACT_URGENT: '지금 바로 연락 검토',
  CONTACT_PLANNED: '계획해서 연락 검토',
  CONTACT_REVIEW: '확인 후 연락 검토',
  RESEARCH: '추가 조사 필요',
  CONDITIONAL_WAIT: '조건 충족 후 재검토',
  WATCH: '동향 모니터링',
  LOW: '검토 우선순위 낮음',
};

export const classificationTone: Record<ClassificationCode, StatusTone> = {
  FILTER_EXCLUDED: 'no',
  FILTER_PENDING: 'wait',
  OPS_PENDING: 'neutral',
  NOT_EVALUATED: 'neutral',
  CONTACT_URGENT: 'ok',
  CONTACT_PLANNED: 'ok',
  CONTACT_REVIEW: 'ask',
  RESEARCH: 'ask',
  CONDITIONAL_WAIT: 'neutral',
  WATCH: 'neutral',
  LOW: 'neutral',
};

export const coreEvidenceRecheckLabel = '핵심 근거 재확인 필요';

/** 거산 값 검수 상태(reviewStatus). */
export const reviewStatusLabels: Record<ReviewStatus, string> = {
  REVIEWED: '확인됨',
  PENDING: '확인 기다림',
  UNAVAILABLE: '자료 없음',
  RECHECK: '다시 확인',
};

export const reviewStatusTone: Record<ReviewStatus, StatusTone> = {
  REVIEWED: 'ok',
  PENDING: 'wait',
  UNAVAILABLE: 'neutral',
  RECHECK: 'recheck',
};

/** 요구 판정 표시값(checkDisplay). */
export const checkDisplayLabels: Record<CheckDisplay, string> = {
  PASS: '통과 (응모 가능)',
  PENDING_BLOCKS: '확인 대기 (승인 막힘)',
  QUESTION_NEEDED: '질문 필요 (승인은 막지 않음)',
  LATER_STAGE: '나중 단계',
  EXCLUDED: '제외',
};

export const checkDisplayTone: Record<CheckDisplay, StatusTone> = {
  PASS: 'ok',
  PENDING_BLOCKS: 'wait',
  QUESTION_NEEDED: 'ask',
  LATER_STAGE: 'neutral',
  EXCLUDED: 'no',
};

/** 의견 3값과 버튼 문구. */
export const opinionLabels: Record<Opinion, string> = {
  WORTH_REVIEW: '검토 권고',
  NEED_CHECK: '추가 확인 필요',
  NOT_TARGET: '검토 대상 제외',
};

export const reqLevelLabels = {
  REQUIRED: '꼭 필요',
  PREFERRED: '있으면 좋음',
  NOT_REQUIRED: '필요 없음',
  UNKNOWN: '모름',
} as const;

export const neededStageLabels = {
  NOW: '지금(응모)',
  LATER: '나중(양산)',
  UNKNOWN: '모름',
} as const;

export const relationStatusLabels = {
  NEW_CONFIRMED: '신규',
  EXISTING_CONFIRMED: '기존',
  UNCONFIRMED: '확인 전',
} as const;

export const purposeLabels = {
  NEW_PROPOSAL: '신규 제안',
  FOLLOW_UP_PROPOSAL: '기존 제안 후속',
  REORDER_CHECK: '재발주 확인',
} as const;

export const certaintyLabels = {
  CONFIRMED: '사실(확인)',
  STRONG: '추정(강한)',
  WEAK: '추정(약한)',
  UNKNOWN: '미확인',
} as const;

/** 띠 문구(BR10.4). */
export const banner = {
  internalOnly: '내부용 · 고객 제출용 아님',
  virtualData: '가상 데이터 표시 중 (가상·거산 실제 사양 아님)',
  brochure: '거산 확인 전: 참고 추천이며 접촉 승인은 열리지 않습니다',
  narrowScreen: '넓은 화면에서 써 주세요 (1024px 이상)',
  reevaluated: '재평가됨',
  updatedAtPrefix: '갱신',
} as const;

/** 다섯 상태·공통 문구(BR10.7, 상세 화면 설계 3-3·4-3). */
export const states = {
  loading: '불러오는 중',
  listEmpty: '아직 추천할 기회가 없습니다. 운영자가 후보를 넣으면 여기에 나타납니다.',
  listError: '목록을 불러오지 못했습니다.',
  detailError: '상세 내용을 불러오지 못했습니다.',
  detailNotFound: '이 기회를 찾을 수 없습니다.',
  loadingSlow: '조금 오래 걸리고 있습니다',
  retry: '다시 시도',
  noRequirements: '확인된 요구가 없습니다. 질문 목록을 보세요',
  noEvidence: '아직 근거 자료가 없습니다.',
  notEvaluatedYet: '아직 평가가 없습니다. 운영자가 평가를 실행하면 여기에 나타납니다.',
  notEvaluatedCount: (n: number) => `평가 전 ${n}건`,
  noProcessLinks: '연결된 공정이 없습니다.',
} as const;

/** 의견 영역 문구(BR10.6, BR9.1). */
export const opinionArea = {
  groupLabel: '담당자 검토 의견',
  savedPrefix: '저장됨',
  savedSummaryPrefix: '의견:',
  edit: '수정',
  saveFailed: '저장하지 못했습니다. 다시 시도',
  reasonLabel: '검토 대상 제외 사유',
  reasonRequired: '사유를 적어 주세요',
  memoLabel: '메모(선택, 200자)',
  pickStaffFirst: '먼저 담당자를 고르세요',
  changedByOther: '다른 담당자가 방금 바꿨습니다',
  save: '저장',
  cancel: '취소',
  saving: '저장 중',
  contactHint: '전화번호·이메일 같은 연락처는 적지 마세요.',
  previousPrefix: '이전:',
} as const;

/** 공통 틀 문구. */
export const frame = {
  skipToContent: '본문으로 건너뛰기',
  menuOpportunities: '영업 후보 목록',
  staffSelectLabel: '담당자',
  staffPlaceholder: '담당자를 고르세요',
  backToList: '목록으로',
  viewDetail: '자세히 보기',
  pageTitleList: '영업 후보 목록',
  pageTitleDetail: '기업 검토 상세',
  navLabel: '주 메뉴',
  staffLoadFailed: '담당자 목록을 불러오지 못했습니다. 화면을 새로고침해 주세요.',
  menuDashboard: '대시보드',
  pageTitleDashboard: '대시보드',
} as const;

/** 대시보드(S4) 문구. 건수 두 구역("관심 기업"·"영업 진행")·일정·최근 기록·검색·공정/산업군 막대. */
export const dashboardTexts = {
  searchLabel: '회사 이름 검색',
  searchPlaceholder: '회사 이름을 입력하세요',
  searchButton: '검색',
  countUnits: {
    NOT_CONTACTED: '곳',
    IN_CONTACT: '곳',
    QUOTE_SAMPLE: '곳',
    SCHEDULE_DUE: '건',
    BOOKMARKED: '곳',
    NO_OPINION: '곳',
    NEED_CHECK: '곳',
    NOT_TARGET: '곳',
    ON_HOLD: '곳',
    DONE: '곳',
  },
  /** 칸 이름. 목록 머리의 "무엇으로 걸렀는지"도 같은 말을 쓴다. */
  countNames: {
    NOT_CONTACTED: '미접촉',
    IN_CONTACT: '접촉 중',
    QUOTE_SAMPLE: '견적·샘플',
    SCHEDULE_DUE: '이번 주 일정',
    BOOKMARKED: '관심 기업',
    NO_OPINION: '의견 전',
    NEED_CHECK: '추가 확인 필요',
    NOT_TARGET: '제외',
    ON_HOLD: '보류',
    DONE: '완료',
  },
  /** 두 구역(#357, 2026-11-06 PM 결정): 관심으로 고른 회사만 센다. */
  bookmarkSectionTitle: '관심 기업',
  progressSectionTitle: '영업 진행',
  progressSectionHint: '관심 기업 가운데 검토 권고를 받은 뒤의 진행',
  /** "미접촉" 칸의 작은 풀이: 검토 권고를 받았고 아직 접촉하지 않은 곳. */
  notContactedHint: '검토 권고 · 접촉 전',
  /** 관심 기업이 0곳일 때 안내 한 줄. 가운데 말이 추천 목록으로 가는 링크다. */
  bookmarkEmptyLead: '아직 관심으로 고른 회사가 없습니다.',
  bookmarkEmptyLink: '추천 목록',
  bookmarkEmptyTail: '에서 [관심]을 눌러 담아 보세요',
  /** 서버가 아직 옛 집계를 줄 때. 뜻이 달라진 숫자를 새 칸에 넣어 보이지 않는다. */
  countsOutdated:
    '관심 기업 건수를 아직 받지 못했습니다. 서버가 새 집계로 바뀌면 여기에 나타납니다.',
  scheduleTitle: '일정',
  scheduleEmpty: '예정된 일정이 없습니다.',
  scheduleOverdue: '지남',
  recentTitle: '최근 내 기록',
  recentEmpty: '아직 남긴 기록이 없습니다.',
  activityKinds: {
    NOTE: '메모',
    STAGE: '단계',
    CONTACT_ATTEMPT: '접촉 시도',
    SCHEDULE: '일정',
    OPINION: '의견',
  },
  breakdownProcessTitle: '공정별',
  breakdownIndustryTitle: '산업군별',
  breakdownBasis: (total: number) => `대시보드 대상 ${total}곳`,
  breakdownProposed: 'AI 제안 포함',
  breakdownEmptyText: '관심 표시한 회사가 아직 없어요.',
  breakdownEmptyAction: '추천 목록 가기',
  loadError: '대시보드를 불러오지 못했습니다.',
  goToList: '영업 후보 목록으로 이동',
} as const;

/** 카드·상세 줄 머리말. */
export const cardRows = {
  reason: '추천 근거',
  blocker: '검토사항',
  nextAction: '후속 조치',
  rankPrefix: '순위',
  scorePrefix: '점수',
  blocksApproval: '(승인 막힘)',
  notBlocksApproval: '(승인은 막지 않음)',
  virtualTag: '가상 사례',
  referenceScorePrefix: '참고',
  reevaluated: '재평가됨',
  brochureTag: '거산 확인 전',
} as const;

/** 점수 옆 꼬리표(#264). 거래 확인 전 점수는 흐리게 보이고, 거래 중으로 확인된 회사는 "기존 거래처"가 붙는다. */
export const scoreTags = {
  pending: '거래 확인 전',
  existing: '기존 거래처',
} as const;

/** 상세 제목 아래 회사 홈페이지 링크 글(#175, 용어 #202). 홍보관(블로그) 주소도 있어 "기업 소개 페이지"로 쓴다. */
export const homepageLinkLabel = '기업 소개 페이지';

/** 점수 글자를 화면 낭독용으로 읽는 문구(#183). '판정'이 아니라 '조사'로 쓴다. */
export const scoreAria = {
  label: (score: string, done: string, total: string, reference: boolean) =>
    `${reference ? '참고 ' : ''}점수 ${score}점, ${total}개 항목 중 ${done}개 조사`,
  unavailable: '점수 산정 전',
};

/** 상세 영역 제목(BR10.5 순서). */
export const detailSections = {
  reasons: '1. 추천 근거와 후속 조치',
  requirements: '2. 고객이 요구하는 것과 거산의 준비 상태',
  processLinks: '3. 공정 적합성 검토',
  evidence: '4. 근거 자료',
  scores: '5. 점수 자세히 보기',
  estimateMark: '(추정)',
  questionsHeading: '거산 역량 확인사항',
  questionsHint:
    "점수 계산에 쓴 거산 소개서 값입니다. 거산이 '맞다'고 확인하면 검수 완료로 바뀌고 이 기회를 다시 평가합니다. 상대 회사에 물을 것은 위의 '후속 조치'에 있고, 답 기록 기능은 11월에 들어갑니다.",
  expandQuestions: (n: number) => `나머지 ${n}개 펼치기`,
  collapseQuestions: '접기',
  approvalEligible: '승인 가능 여부',
  requirementsTableLabel: '요구 판정 표',
  requirementColumns: {
    name: '요구',
    level: '꼭 필요한가',
    stage: '언제 필요',
    capability: '거산 상태',
    result: '판정',
  },
} as const;

/** 쪽 넘김 문구. */
export const pagination = {
  total: (from: number, to: number, total: number) => `${from}~${to} / ${total}건`,
  perPage: '20건씩',
  totalLine: (total: number) => `전체 ${total}곳`,
} as const;

/** 오류 응답에 쓰는 보조 문구(ref는 작게). */
export const errorTexts = {
  refPrefix: '문의 시 이 번호:',
  network: '서버에 연결하지 못했습니다.',
  timeout: '응답이 너무 오래 걸립니다 (10초).',
  nextActionDefault: '잠시 뒤 다시 시도해 주세요.',
} as const;

/**
 * 코드 → 쉬운 말. 코드표 밖 코드는 코드 그대로를 돌려주고 콘솔 경고를 남긴다(조용히 빈 글자를 보이지 않음).
 * 서버에서 받은 대응표(/config/ui classificationLabels)가 있으면 그것을 먼저 쓴다.
 */
export function labelFor<K extends string>(
  table: Record<K, string>,
  code: string,
  overrides?: Record<string, string>,
): string {
  if (overrides && code in overrides) return overrides[code];
  if (code in table) return table[code as K];
  console.warn(`쉬운 말 대응표에 없는 코드: ${code}`);
  return code;
}

// ---------- 상세 화면(S2) 문구 — 추가만 ----------

export const detailHeader = {
  relation: '고객 관계',
  purpose: '대응',
  owner: '담당',
} as const;

/** 추천 목록 머리의 공정 탭·지역·산업 선택과 카드 꼬리표(#210, 결정 2026-11-03 밤). */
export const listFilters = {
  tabsLabel: '공정',
  regionLabel: '지역',
  industryLabel: '산업',
  all: '전체',
  /** "천안 인근 8" */
  option: (name: string, count: number) => `${name} ${count}`,
  /** "전기아연도금 (9)" */
  tab: (name: string, count: number) => `${name} (${count})`,
  /** 조건을 걸었는데 0건일 때. */
  filteredEmpty: "이 조건에 맞는 후보가 없습니다. 지역·산업을 '전체'로 바꿔 보세요",
  /** 대시보드 건수·검색으로 넘어와 걸러진 목록이 비었을 때. */
  noMatch: '이 조건에 맞는 후보가 없습니다.',
  regionUnknown: '지역 미확인',
  industryUnknown: '산업 미확정',
} as const;

/**
 * 추천 목록 머리의 "관심 기업" 보기(#357, 2026-11-06 PM 결정)와, 대시보드 칸을 누르고 넘어온 목록의 이름 줄.
 * 칸 이름 자체는 대시보드와 같은 말(`dashboardTexts.countNames`)을 쓴다.
 */
export const bookmarkList = {
  title: '관심 기업',
  showOnly: '관심 기업만 보기',
  opinionGroupLabel: '검토 의견으로 거르기',
  /** 거르기 단추 다섯 개. "기타"는 세 의견 중 아무것도 고르지 않은 회사만 나온다. */
  opinionFilters: {
    ALL: '전체 보기',
    WORTH_REVIEW: '검토 권고',
    NEED_CHECK: '추가 확인 필요',
    NOT_TARGET: '제외 기업',
    NONE: '기타',
  },
  /** 관심 기업 보기인데 관심으로 고른 회사가 하나도 없을 때. */
  empty: '관심으로 고른 회사가 없습니다. 카드의 [관심]을 눌러 담아 보세요',
  filterPrefix: '거른 조건',
  /** 주소의 조건 값이 대시보드 칸 이름표에 없을 때 대신 보이는 말. */
  filterUnknown: '대시보드에서 고른 조건',
  clearFilter: '거르기 풀기',
} as const;

/** 후보 찾기 화면(#316, 결정 2026-11-05): 목록 머리 수집 요약·"이번 수집만/전체" 전환과 카드의 고른 이유·점수 전·이번에 들어옴. */
export const candidateSearch = {
  /** 카드 "고른 이유" 줄 이름. AI가 이 회사를 목록에 넣은 이유 한 줄이 옆에 보인다. */
  pickReasonRow: '고른 이유',
  /** 점수가 아직 없는 찾은 회사. 서버 점수 글자("--") 대신 보인다. */
  beforeScore: '점수 전',
  /** "이번에 들어옴" 꼬리표. 날짜를 알면 "이번에 들어옴 · 11/20"으로 보인다. */
  newInBatch: '이번에 들어옴',
  newInBatchWithDate: (date: string) => `이번에 들어옴 · ${date}`,
  /** 머리 수집 요약 줄(상태별). 건수를 모르는 칸은 뺀다. */
  summaryTitle: '후보 가져오기',
  running: '지금 가져오는 중입니다',
  failed: '후보 가져오기에 실패했습니다. 잠시 뒤 다시 시도해 주세요.',
  scanned: (n: number) => `훑어본 회사 ${n.toLocaleString('ko-KR')}곳`,
  picked: (n: number) => `고른 회사 ${n.toLocaleString('ko-KR')}곳`,
  researched: (done: number, total: number) => `조사 ${done}/${total}`,
  mergeCandidates: (n: number) => `확인 필요 ${n}곳`,
  /** "이번 수집만 / 전체" 전환. */
  scopeLabel: '보기',
  scopeLatest: '이번 수집만',
  scopeAll: '전체',
  /** "이번 수집만"인데 고른 회사가 하나도 없을 때. */
  latestEmpty: '이번에 새로 들어온 회사가 없습니다. 보기를 "전체"로 바꿔 보세요',
  /** 조건 칸(#316): 담당자가 공정·지역·산업을 고르고 [새 후보 가져오기]를 누른다. 모달 없이 인라인이다. */
  formTitle: '새 후보 찾기 조건',
  processLabel: '공정',
  processHint: '공정을 하나 이상 고르세요',
  regionLabel: '지역',
  regionHint: '안 고르면 설정된 지역 전체에서 찾습니다',
  industryLabel: '산업',
  industryHint: '안 고르면 산업을 가리지 않습니다',
  fetchButton: '새 후보 가져오기',
  fetching: '가져오는 중',
  pickStaffFirst: '담당자를 고르면 가져올 수 있습니다',
  started: '가져오기를 시작했습니다. 아래에서 진행을 볼 수 있습니다',
  alreadyRunning: '지금 가져오는 중입니다. 끝난 뒤에 다시 눌러 주세요',
  sourceFailed: '공개 자료를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요',
  invalidCondition: '고른 조건을 서버가 받지 않았습니다',
  startFailed: '후보 가져오기를 시작하지 못했습니다',
} as const;

/** 상세 머리 "기업 요약"(#210): 조사일·한 줄·특징·대표번호와 홈페이지 상태 띠. */
export const companySummary = {
  title: '회사 소개',
  /** "조사 11/5 (3일 전)" */
  researched: (date: string, ago: string) => `조사 ${date} (${ago})`,
  /** 사례 파일로만 만든 요약(AI 조사 전). */
  caseFileBasis: '사례 파일 기준',
  stale: '오래됨',
  aiSuggestion: 'AI 제안',
  summaryLine: '한 줄',
  highlights: '특징',
  /** "거산에서 12.3km" */
  distance: (km: number) => `거산에서 ${km}km`,
  mainPhone: '대표',
  phoneSource: '출처',
  phoneSourceHomepage: '홈페이지',
  phoneSourceCsv: '공장현황 자료',
  phoneUnconfirmed: '담당자 확인 전',
  /** "담당자 확인 11/5 영업 담당" */
  phoneConfirmed: (date: string, name: string) => `담당자 확인 ${date} ${name}`,
  phoneConfirmButton: '맞음',
  phoneConfirmFailed: '대표번호를 확인하지 못했습니다.',
  phoneStale: '그 사이 번호가 바뀌었습니다. 상세를 새로 불러온 뒤 다시 눌러 주세요.',
  pickStaffFirst: '담당자를 고르면 확인할 수 있습니다.',
  reload: '새로 불러오기',
  bandNeedsConfirmation: '홈페이지 확인 필요',
  bandNotFound: '홈페이지 못 찾음',
  /** 오늘 기준 며칠 전. */
  today: '오늘',
  daysAgo: (days: number) => `${days}일 전`,
} as const;

/** 상세 머리 거래 관계 줄(#266): 지금 상태 글자, 바꾸는 단추, 안내·오류 문구. */
export const relationControl = {
  title: '거래 관계',
  state: { NEW_CONFIRMED: '거래 없음', EXISTING_CONFIRMED: '거래 중', UNCONFIRMED: '확인 전' },
  /** 지금 상태가 아닌 두 가지로 바꾸는 단추 글자. */
  action: { NEW_CONFIRMED: '거래 없음', EXISTING_CONFIRMED: '거래 중', UNCONFIRMED: '확인 전으로' },
  hint: '바꾸면 이 회사를 다시 평가합니다.',
  pickStaffFirst: '담당자를 고르면 바꿀 수 있습니다.',
  saved: '거래 관계를 바꾸고 다시 평가했습니다.',
  saveFailed: '거래 관계를 저장하지 못했습니다.',
  stale: '그 사이 다시 평가되었습니다. 상세를 새로 불러온 뒤 다시 눌러 주세요.',
  reload: '새로 불러오기',
} as const;

/** 확인 질문 상태(QuestionStatus). */
export const questionStatusLabels: Record<QuestionStatus, string> = {
  WAITING: '대기',
  REQUESTED: '요청됨',
  REPLIED: '회신됨',
  APPLIED: '반영됨',
};

export const questionStatusTone: Record<QuestionStatus, StatusTone> = {
  WAITING: 'wait',
  REQUESTED: 'ask',
  REPLIED: 'ok',
  APPLIED: 'ok',
};

export const questionRows = {
  effectPrefix: '답을 받으면',
} as const;

export const requirementCells = {
  notApplicable: '해당 없음',
} as const;

/** 요구 판정 앞 아이콘 글자(색에만 기대지 않기, 접근성 A3). */
export const checkDisplayIcons: Record<CheckDisplay, string> = {
  PASS: '✔',
  PENDING_BLOCKS: '⏳',
  QUESTION_NEEDED: '?',
  LATER_STAGE: '→',
  EXCLUDED: '✕',
};

export const approvalLine = {
  recheck: '조건이 바뀌어 다시 확인해 주세요',
  eligible: '✔',
  notEligible: '⚠',
} as const;

/** 공정 연결 판정(FilterState)과 적용 소재 쉬운 말. 소재 코드표 밖 코드는 labelFor가 코드 그대로 보인다. */
export const filterStateLabels: Record<FilterState, string> = {
  PASS: '통과',
  PENDING: '확인 대기',
  EXCLUDED: '제외',
};

export const filterStateTone: Record<FilterState, StatusTone> = {
  PASS: 'ok',
  PENDING: 'wait',
  EXCLUDED: 'no',
};

export const materialLabels: Record<string, string> = {
  AL: '알루미늄',
  AL_CASTING: '알루미늄 주물',
  FE: '철',
  CU: '구리',
  SUS: '스테인리스',
};

export const processRows = {
  material: '적용 소재',
} as const;

export const evidenceRows = {
  gradePrefix: '출처 등급',
  llmProposed: 'LLM 제안',
  homepageNeedsConfirm: '홈페이지 주소 확인이 필요합니다.',
} as const;

/** 거산 값 묶음 이름. */
export const datasetKindLabels: Record<DatasetKind, string> = {
  VIRTUAL_REVIEWED: '가상 검수',
  BROCHURE: '소개서',
  COMPANY_CONFIRMED: '거산 확인 완료',
};

/** 영업 기록·검토사항의 쉬운 말 (약속 C0, C1). */
export const outcomeStatusLabels = {
  NOT_EXECUTED: '미접촉',
  IN_PROGRESS: '접촉',
  SAMPLE_OR_REGISTRATION_APPROVED: '견적·샘플',
  ON_HOLD: '보류',
  WON: '성사',
  LOST: '거절',
} as const;

export const contactMethodLabels = { CALL: '전화', EMAIL: '메일', VISIT: '방문' } as const;
export const contactResultLabels = { REACHED: '연결됨', ABSENT: '부재', DECLINED: '거절' } as const;
/** 거절 이유 코드(LostReasonCode) 쉬운 말. 영업 단계가 거절일 때 고른다. */
export const lostReasonLabels = {
  PRICE: '가격',
  LEAD_TIME: '납기',
  INCUMBENT_SUPPLIER: '기존 거래처 유지',
  NO_DEMAND: '수요 없음',
  QUALITY_CERT: '품질·인증 요건',
  OTHER: '기타',
} as const;
export const noteKindLabels = { MEMO: '메모', RESEARCH: '자료 조사' } as const;
export const reviewItemKindLabels = {
  QUESTION: 'AI 확인 질문',
  DATA_NOT_FOUND: '자료 못 찾음',
  DATA_INSUFFICIENT: '자료 부족',
} as const;
/** 꼬리표 글자. 질문은 뒤에 "·상대 회사" / "·거산"이 붙는다. */
export const reviewItemKindTagLabels = {
  QUESTION: 'AI 질문',
  DATA_NOT_FOUND: '자료 못 찾음',
  DATA_INSUFFICIENT: '자료 부족',
} as const;
export const reviewItemSourceLabels = {
  AI: 'AI 조사',
  CASE_FILE: '사례 파일',
  RULE: '평가 규칙',
} as const;

/** 카드 영업 단계 꼬리표 색. 미접촉은 꼬리표를 보이지 않는다. */
export const outcomeStatusTone: Record<string, StatusTone> = {
  IN_PROGRESS: 'wait',
  SAMPLE_OR_REGISTRATION_APPROVED: 'ok',
  ON_HOLD: 'neutral',
  WON: 'ok',
  LOST: 'no',
};

/** 상세 하단 "기록" 영역(U5): 접촉 시도 / 영업 메모 / 영업 단계 / 다음 일정. */
export const recordsArea = {
  title: '기록',
  /** 접촉 시도와 영업 메모를 한 칸으로 합친 입력(2026-11-04 PM): 종류를 고르면 아래 입력이 바뀐다. */
  entryTitle: '기록 남기기',
  entryKind: '종류',
  contactMethod: '방법',
  contactResult: '결과',
  contactDate: '날짜',
  contactSave: '접촉 기록 저장',
  /** 상세 머리 "접촉 3회 (전화 2 · 방문 1)". 0회인 방법은 빼고, 접촉이 없으면 "접촉 없음". */
  contactCount: (total: number, call: number, email: number, visit: number) => {
    const parts = [
      call > 0 ? `전화 ${call}` : '',
      visit > 0 ? `방문 ${visit}` : '',
      email > 0 ? `메일 ${email}` : '',
    ].filter(Boolean);
    return total === 0 ? '접촉 없음' : `접촉 ${total}회 (${parts.join(' · ')})`;
  },
  noteLabel: '메모 내용',
  noteCounter: (used: number, max: number) => `${used} / ${max}자`,
  noteHint: '메모는 덧붙이기만 되고 고치거나 지울 수 없습니다. 이 메모는 외부로 나가지 않습니다.',
  noteSave: '메모 남기기',
  researchSave: '자료 조사 남기기',
  stageTitle: '영업 단계',
  stageCurrent: '현재 단계',
  stageNone: '아직 기록 없음',
  stageReasonLabel: '거절 사유',
  stageReasonRequired: '거절 사유를 적어 주세요',
  /** 거절 이유 선택 상자(2026-11-04). 코드를 고르고, 기타일 때만 자유 글이 필수다. */
  stageLostCodeLabel: '거절 이유',
  stageLostCodeRequired: '거절 이유를 고르세요',
  stageOtherReasonRequired: '기타를 고르면 이유를 적어 주세요',
  stageReasonOptionalLabel: '거절 사유 (선택)',
  /** "거절 · 가격" */
  stageCurrentLost: (label: string) => `거절 · ${label}`,
  stageSave: '단계 저장',
  scheduleTitle: '다음 일정',
  scheduleDate: '날짜',
  scheduleNote: '할 일 한 줄',
  scheduleSave: '일정 저장',
  savedPrefix: '저장됨',
  saveFailed: '저장하지 못했습니다. 다시 시도',
  pickStaffFirst: '먼저 담당자를 고르세요',
  required: '필수',
  selectPlaceholder: '고르세요',
} as const;

/**
 * [관심] 단추(#357, 약속 v3 #356): 목록 카드와 상세 머리. 관심은 영업 단계가 아니라 켜고 끄는 표시다.
 * 끄기가 거부될 때의 문구는 서버가 주는 글을 그대로 보이므로 여기에 두지 않는다.
 */
export const bookmarkTexts = {
  /** 꺼져 있을 때 단추 글자. 누르면 관심 기업으로 담긴다. */
  off: '관심',
  /** 켜져 있을 때 단추 글자. */
  on: '관심 기업',
  pickStaffFirst: '담당자를 고르면 관심으로 담을 수 있습니다',
} as const;

/** 상세 "검토사항" 영역(U5): 담당자가 확인하면 체크. 목록은 평가 결과에서 나오고 체크 상태만 저장된다. */
export const reviewArea = {
  title: '검토사항',
  /** "확인 2 / 5" */
  progress: (done: number, total: number) => `확인 ${done} / ${total}`,
  hint: '담당자가 확인한 항목에 체크하세요. 체크와 체크 해제는 모두 기록으로 남고 지워지지 않습니다.',
  empty: '검토할 항목이 없습니다.',
  listLabel: '검토사항 목록',
  /** 꼬리표: [AI 질문·상대 회사] [AI 질문·거산] [자료 못 찾음] [자료 부족] */
  tag: (kind: string, targetLabel?: string | null) => {
    const base =
      kind in reviewItemKindTagLabels ? reviewItemKindTagLabels[kind as ReviewItemKind] : kind;
    return kind === 'QUESTION' && targetLabel ? `${base}·${targetLabel}` : base;
  },
  checkedBy: (name: string, date: string) => `${name} · ${date} 확인`,
  checkLabel: (text: string) => `확인함: ${text}`,
  saveFailed: '저장하지 못했습니다. 다시 시도',
  pickStaffFirst: '먼저 담당자를 고르세요',
  /** 질문 줄의 [답 적기] / [답 고치기] (2026-11-04). 답은 영업 메모처럼 내부 전용이다. */
  replyAdd: '답 적기',
  replyEdit: '답 고치기',
  replyButtonLabel: (text: string) => `답 적기: ${text}`,
  replyInputLabel: '질문에 대한 답',
  replyPlaceholder: '들은 답을 한두 문장으로 적으세요',
  replyHint:
    '답은 내부에서만 보이고 밖으로 나가지 않습니다. 저장하면 이전 답은 활동 이력에 남습니다.',
  replyMaxLength: 500,
  replyCounter: (count: number, max: number) => `${count} / ${max}자`,
  replySave: '답 저장',
  replyCancel: '취소',
  replyRequired: '답을 적어 주세요',
  /** "답: 2024년에 KS 인증 받았다고 함" */
  replyPrefix: '답:',
  /** "박 이사 · 11/6" */
  repliedBy: (name: string, date: string) => `${name} · ${date}`,
  replySaveFailed: '답을 저장하지 못했습니다. 다시 시도',
} as const;

/** 상세 "기록" 아래 타임라인(U5): GET /activity를 최근 순으로. */
export const timelineArea = {
  title: '활동 이력',
  empty: '아직 기록이 없습니다.',
  loadFailed: '활동 이력을 불러오지 못했습니다.',
  retry: '다시 불러오기',
  loading: '불러오는 중',
  system: '시스템',
  listLabel: '활동 이력 목록',
} as const;

/** 활동 이력 종류(ActivityKind) 쉬운 말. */
export const activityKindLabels: Record<ActivityKind, string> = {
  CLASSIFICATION: '분류',
  OPINION: '의견',
  BOOKMARK: '관심',
  APPROVAL: '승인',
  CONTACT_ATTEMPT: '접촉 시도',
  REPLY: '답 기록',
  OUTCOME: '영업 단계',
  EVIDENCE_GRADE_CONFIRMED: '근거 등급 확인',
  RELATION_CONFIRMED: '거래 관계',
  NOTE: '메모',
};

/** 상세 머리 지도 링크 글자. */
export const mapLinkLabels = {
  naver: '네이버 지도에서 보기',
  kakao: '카카오맵에서 보기',
} as const;

/** 상세 "추천 이유"의 요약 줄 앞에 쓰는 짧은 항목 이름(PM 결정 2026-10-27, #145). 표에 없는 코드는 긴 이름을 그대로 쓴다. */
export const itemShortLabels: Record<string, string> = {
  NEW_PRODUCT: '제품',
  NEW_MATERIAL: '소재',
  NEW_RECORD: '납품실적',
  NEW_PERF: '처리 목적',
  SIG_EXPAND: '증설',
  SIG_ORDER: '수주',
  SIG_BID: '공고',
  SIG_HIRE: '채용',
};

/** 점수 자세히 보기 — 전문 용어(E/P/S/R)는 여기서만 쓴다(BR10.9). */
export const scoreDetails = {
  E: '현재 평가점수 E',
  P: '조사 항목 배점 합계 P',
  S: '확인 비율 S (E÷P×100)',
  R: '조사 시 상한 R',
  C: '평가 항목 조사율 C',
  expand: '펼치기',
  collapse: '접기',
  itemColumns: {
    label: '항목',
    weight: '배점',
    matchRate: '평가 기준 적합도',
    certainty: '근거 확인 수준',
    decay: '최신성 반영계수',
    score: '점수',
    state: '상태',
  },
  unavailable: '자료 미확보',
  ruleVersionPrefix: '규칙 설정',
  datasetPrefix: '거산 역량 자료 구분',
  evaluatedPrefix: '평가',
} as const;

/** 점수 항목 상태. 표 밖 상태는 labelFor가 코드 그대로 보이고 콘솔에 경고한다. */
export const scoreStateLabels: Record<string, string> = {
  CONFIRMED: '확인',
  NO_SIGNAL: '신호 없음',
  STRONG: '강한 추정',
  WEAK: '약한 추정',
  MISMATCH: '불일치',
  NO_BONUS: '가점 없음',
  UNAVAILABLE: '자료 미확보',
};
