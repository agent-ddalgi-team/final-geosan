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

/** 달러 금액을 보이는 글자로(#549). 예: 0.74 → "$0.74", 30 → "$30.00". 1센트보다 작으면 "$0.01 미만". */
export function usdText(value: number): string {
  if (value > 0 && value < 0.01) return '$0.01 미만';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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
  menuSalesAnalysis: '영업 분석',
  pageTitleSalesAnalysis: '영업 분석',
} as const;

/** 대시보드(S4) 문구. 건수 두 구역("관심 기업"·"영업 진행")·일정·최근 기록·검색·공정/산업군 막대. */
export const dashboardTexts = {
  calendarTitle: '일정 달력',
  calendarEmpty: '잡아 둔 일정이 아직 없어요.',
  calendarHint: '일정이 있는 날을 누르면 내용이 보입니다.',
  popoverClose: '닫기',
  popoverDetail: '상세 보기',
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

/** 대시보드 지도(#226·#641). 회사 이름·단계·거리는 우리 쪽 말풍선에만 쓰고 지도 SDK에는 넘기지 않는다. */
export const dashboardMapTexts = {
  title: '거산 주변 지도',
  loadError: '지도 정보를 불러오지 못했습니다.',
  hqLabel: '거산 본사',
  ringLabel: (km: number) => `${km}km`,
  groups: {
    INTERESTED: '관심',
    IN_PROGRESS: '진행 중',
    WON_THIS_YEAR: '올해 성공',
  },
  legendTitle: '범례',
  pointAria: (name: string, group: string, km: number) => `${name} · ${group} · ${km}km`,
  distance: (km: number) => `거산에서 ${km}km`,
  callout: '회사 정보',
  detailLink: '자세히 보기',
  close: '닫기',
  missingCoordinates: (count: number) => `좌표 없는 회사 ${count}곳`,
  emptyText: '관심 표시한 회사가 아직 없어요.',
  emptyAction: '추천 목록 가기',
  /** 네이버 지도 연결 전 자리표시. 원과 점의 상대 위치만 보인다. */
  placeholder: '지도 배경은 준비 중입니다. 원과 점의 상대 위치만 보여요.',
  /** 네이버 지도(#671)를 불러오는 동안. */
  mapLoading: '네이버 지도를 불러오는 중입니다.',
  /** 키 인증(허용 URL 미등록 등)·네트워크 실패. 원·점은 자리표시로 계속 보인다. */
  mapFailed: '네이버 지도를 불러오지 못해 원과 점의 상대 위치만 보여요.',
  /** 낭독기용 점 목록 이름. */
  pointList: '지도에 표시된 회사',
  /** "같이 들를 곳"(#673): 방문할 회사(진행 중·관심) 근처 반경 안 후보. */
  visitTitle: '같이 들를 곳',
  visitHint: (km: number) => `방문할 회사(진행 중·관심) 기준 ${km}km 안 · 누르면 지도에서 보여요`,
  /** 묶음 줄: "진행 중 · (주)정진에어로스페이스 · 거산에서 6km" 뒤에 "근처 3곳". */
  visitNearbyCount: (count: number) => `근처 ${count}곳`,
  /** 근처 회사 줄: "1.8km · 후보". 지도 대상이 아닌 회사는 "후보". */
  visitNearbyDistance: (km: number) => `${km}km`,
  /** 영업 후보 목록에 있지만 아직 관심 표시를 하지 않은 회사(#673, PM: "후보"는 관심 기업으로 읽혀 바꿈). */
  candidate: '관심 전',
  /** 근처 후보 말풍선: "코파스 주식회사에서 1.5km". */
  fromAnchor: (name: string, km: number) => `${name}에서 ${km}km`,
  visitMore: (count: number) => `${count}곳 더 보기`,
  visitNone: '이 반경 안에 같이 들를 다른 후보가 없어요.',
  visitEmpty: '진행 중·관심 회사가 없어 묶을 곳이 없어요.',
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
  /** AI가 제안한 값으로 계산된 점수(#498, 계약 C1 #286). 사람이 확정하기 전까지 흐리게 보인다. */
  aiProposal: 'AI 제안 · 확인 전',
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

/**
 * 추천 목록 머리의 공정·지역·산업 선택란과 카드 꼬리표(#210, 결정 2026-11-03 밤).
 * 공정은 탭에서 선택란으로 바뀌었다(#361, 2026-11-06 PM 결정).
 * 공정을 고르기 전에는 "전체(공정별로 묶음)"로 공정별 묶음을 본다(#383, 2026-11-07 PM 결정; #368의 빈 목록을 바꿈).
 */
export const listFilters = {
  processLabel: '공정',
  regionLabel: '지역',
  industryLabel: '산업',
  all: '전체',
  /** 공정 선택란 맨 위(#383). 고르면 공정마다 따로 불러 공정별 묶음으로 보인다. */
  processGrouped: '전체(공정별로 묶음)',
  /** 묶음 머리(#383). "아연도금(전기아연도금) · 천안 인근 · 자동차 부품 · 9곳"처럼 고른 조건 이름을 사이에 끼운다. */
  groupTitle: (processName: string, conditions: string[], count: number) =>
    [processName, ...conditions, `${count}곳`].join(' · '),
  /** 묶음 보기일 때 전체 곳 수 줄 뒤에 붙이는 말(#383). */
  groupedNote: '공정별로 묶어 보는 중',
  /** 전체 보기(#516)일 때 전체 곳 수 줄 뒤에 붙이는 말. 공정이 섞여 순위 번호는 보이지 않는다. */
  flatNote: '공정 상관없이 한 줄로 보는 중 · 순위 번호 없음',
  /** 한 공정이 묶음 상한(50곳)을 넘을 때 묶음 끝의 링크(#383). 그 공정 하나를 고른 보기로 간다. */
  onlyThisProcess: '이 공정만 보기',
  /** "천안 인근 8", "크롬 도금 0" */
  option: (name: string, count: number) => `${name} ${count}`,
  /** 조건을 걸었는데 0건일 때. */
  filteredEmpty: "이 조건에 맞는 후보가 없습니다. 지역·산업을 '전체'로 바꿔 보세요",
  /** 대시보드 건수로 넘어와 걸러진 목록이 비었을 때. */
  noMatch: '이 조건에 맞는 후보가 없습니다.',
  /** 고른 공정에 회사가 한 곳도 없을 때(#361). */
  processEmpty: '이 공정의 후보가 아직 없습니다. 후보 찾기로 회사를 찾으면 여기에 나타납니다',
  regionUnknown: '지역 미확인',
  industryUnknown: '산업 미확정',
} as const;

/**
 * 추천 목록 머리의 회사 이름 검색 칸과 정렬(#361, 2026-11-06 PM 결정).
 * 검색 칸 이름·자리 글자·단추는 대시보드 검색 칸과 뜻이 같아 같은 말을 쓴다.
 */
export const listSearch = {
  label: dashboardTexts.searchLabel,
  placeholder: dashboardTexts.searchPlaceholder,
  button: dashboardTexts.searchButton,
  /** 검색 중일 때 결과 위에 검색어와 함께 보인다. 검색은 고른 공정·지역·산업과 상관없이 전체 후보에서 한다. */
  resultTitle: '전체 후보에서 찾은 결과',
  clear: '검색 지우기',
  /** 검색했는데 0곳일 때. */
  empty: '이 이름으로 찾은 후보가 없습니다',
  sortLabel: '정렬',
  sortRank: '추천 순',
  /** 최근 들어온 순(#516): 들어온 시각이 최신인 회사가 위, 사례 파일 회사는 아래. */
  sortRecent: '최근 들어온 순',
  /** 거리 작업(#222, 2차) 전까지 고를 수 없게 흐리게만 보인다. */
  sortDistance: '가까운 순 (준비 중)',
  /** 정렬 줄 마지막 단추(#516, PM 지시 2026-11-09): 공정별 묶음을 풀고 모든 회사를 한 줄로 본다. 다시 누르면 묶음 보기. */
  viewAll: '전체 보기',
} as const;

/**
 * 추천 목록 머리의 "관심 기업" 보기(#357, 2026-11-06 PM 결정)와, 대시보드 칸을 누르고 넘어온 목록의 이름 줄.
 * 칸 이름 자체는 대시보드와 같은 말(`dashboardTexts.countNames`)을 쓴다.
 */
export const bookmarkList = {
  title: '관심 기업',
  showOnly: '관심 기업만 보기',
  opinionGroupLabel: '검토 의견으로 거르기',
  /**
   * 거르기 단추 네 개. "기타"는 의견을 아직 고르지 않은 회사만 나온다.
   * 검토 대상 제외로 저장한 회사는 관심 기업에서 빠지므로(#536) "제외한 회사" 보기에서 본다.
   */
  opinionFilters: {
    ALL: '전체 보기',
    WORTH_REVIEW: '검토 권고',
    NEED_CHECK: '추가 확인 필요',
    NONE: '기타',
  },
  /** 관심 기업 보기인데 관심으로 고른 회사가 하나도 없을 때. */
  empty: '관심으로 고른 회사가 없습니다. 카드의 [관심]을 눌러 담아 보세요',
  filterPrefix: '거른 조건',
  /** 주소의 조건 값이 대시보드 칸 이름표에 없을 때 대신 보이는 말. */
  filterUnknown: '대시보드에서 고른 조건',
  clearFilter: '거르기 풀기',
} as const;

/** 추천 목록 머리의 "제외한 회사" 보기(#536, 2026-11-10 PM 결정). 검토 대상 제외로 저장한 회사만 모아 본다. */
export const excludedList = {
  showOnly: '제외한 회사 보기',
  title: '제외한 회사',
  hint: '검토 대상 제외로 저장한 회사입니다. 검토 의견을 바꾸면 관심 기업으로 돌아갑니다',
  empty: '검토 대상 제외로 저장한 회사가 없습니다',
} as const;

/** 후보 찾기 화면(#316, 결정 2026-11-05 · #516 2026-11-09): 목록 머리 수집 요약과 카드의 고른 이유·점수 전·들어온 날짜. */
export const candidateSearch = {
  /** 카드 "고른 이유" 줄 이름. AI가 이 회사를 목록에 넣은 이유 한 줄이 옆에 보인다. */
  pickReasonRow: '고른 이유',
  /** 점수가 아직 없는 찾은 회사. 서버 점수 글자("--") 대신 보인다. */
  beforeScore: '점수 전',
  /** 카드 "점수 전" 옆 조사 상태(#596): RUNNING이면 "조사 중", 나머지는 모두 "조사 중단". */
  researchRunning: '조사 중',
  researchStopped: '조사 중단',
  /** 상세 점수 줄 옆 "조사 중단 · 이유"의 이유(#596). 서버 researchState 코드 → 쉬운 말. */
  researchStopReason: {
    NO_SCORE_EVIDENCE: '점수 근거 없음',
    NOT_FOUND: '홈페이지 못 찾음',
    READ_FAILED: '홈페이지 읽기 실패',
    NOT_TRIED: '조사 안 됨',
  } as Record<string, string>,
  /** 들어온 날짜 꼬리표(#516): "11/9 들어옴". 회차가 아니라 날짜 기준이라 다시 돌려도 바뀌지 않는다. */
  ingestedOn: (date: string) => `${date} 들어옴`,
  /** 머리 수집 요약 줄(상태별). 건수를 모르는 칸은 뺀다. */
  summaryTitle: '영업 후보 더하기',
  running: '지금 영업 후보로 더하는 중입니다',
  failed: '후보 가져오기에 실패했습니다. 잠시 뒤 다시 시도해 주세요.',
  /**
   * 한도 등으로 건너뛴 일(#442). 문장은 약속 C1에 정해진 그대로다(웹 검색 #313, 단지 조회 #323).
   * 대응표에 없는 코드(DISABLED처럼 꺼 둔 것, 모르는 코드)는 안내하지 않는다.
   */
  webSkipped: {
    DAILY_LIMIT: '오늘 웹 검색 한도 도달',
  },
  complexListSkipped: {
    DAILY_LIMIT: '산단공 조회를 다 못 불러옴 · 파일 목록으로 찾음',
    SOURCE_ERROR: '산단공 조회를 다 못 불러옴 · 파일 목록으로 찾음',
  },
  scanned: (n: number) => `훑어본 공장 ${n.toLocaleString('ko-KR')}곳`,
  picked: (n: number) => `고른 공장 ${n.toLocaleString('ko-KR')}곳`,
  researched: (done: number, total: number) => `조사 ${done}/${total}`,
  mergeCandidates: (n: number) => `확인 필요 ${n}곳`,
  /**
   * 조건 칸(#316): 담당자가 공정·지역·산업을 고르고 [영업 후보로 더하기 💰]를 누른다. 모달 없이 인라인이다.
   * 말 구분(#549 ③): AI가 판단만 한 것은 "공장", 목록에 들어와 조사된 것은 "영업 후보". 💰 = 돈이 드는 단추.
   */
  formTitle: '영업 후보로 더할 공장 조건',
  processLabel: '공정',
  processHint: '공정을 하나 이상 고르세요',
  regionLabel: '지역',
  regionHint: '안 고르면 설정된 지역 전체에서 찾습니다',
  industryLabel: '산업',
  industryHint: '안 고르면 산업을 가리지 않습니다',
  fetchButton: '영업 후보로 더하기 💰',
  fetching: '더하는 중',
  pickStaffFirst: '담당자를 고르면 더할 수 있습니다',
  started: '더하기를 시작했습니다. 아래에서 진행을 볼 수 있습니다',
  alreadyRunning: '지금 더하는 중입니다. 끝난 뒤에 다시 눌러 주세요',
  sourceFailed: '공개 자료를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요',
  invalidCondition: '고른 조건을 서버가 받지 않았습니다',
  startFailed: '영업 후보 더하기를 시작하지 못했습니다',
  /**
   * 맞는 공장 수 줄(#549 ①, 약속 C1 `GET /ingest/preview`). 조건을 고르면 서버가 저장된 AI 판단만 세서
   * 바로 보인다(외부 호출 없음, 0원). 예: "맞는 공장 1,518곳 (상 134 · 중 1,382 · 하 2) · 영업 후보로 들어온 곳 100곳"
   */
  previewMatched: (n: number) => `맞는 공장 ${n.toLocaleString('ko-KR')}곳`,
  previewFits: (high: number, medium: number, low: number) =>
    `(상 ${high.toLocaleString('ko-KR')} · 중 ${medium.toLocaleString('ko-KR')} · 하 ${low.toLocaleString('ko-KR')})`,
  previewRegistered: (n: number) => `영업 후보로 들어온 곳 ${n.toLocaleString('ko-KR')}곳`,
  previewAddableHigh: (n: number) => `아직 안 들어온 상 ${n.toLocaleString('ko-KR')}곳`,
  /** 고른 지역에 AI가 아직 판단하지 않은 공장이 있을 때(#549 ②). 예: "아직 AI 판단 전 17,358곳 · 판단에 약 $34.72" */
  previewUnjudged: (n: number, judgeUsd: number) =>
    `아직 AI 판단 전 ${n.toLocaleString('ko-KR')}곳 · 판단에 약 ${usdText(judgeUsd)}`,
  /** 누르기 전 확인 줄의 예상 금액(#549 ②). 예: "예상 약 $2.00" */
  previewEstimate: (totalUsd: number) => `예상 약 ${usdText(totalUsd)}`,
  /**
   * 한도를 넘어 단추를 잠글 때(#549 ②, 문장은 약속 C1 그대로).
   * 예: "이번 달 남은 금액으로 약 8,400곳까지 판단할 수 있습니다 · 시·군을 골라 나눠 진행해 주세요"
   */
  previewBlocked: (judgeableRows: number) =>
    `이번 달 남은 금액으로 약 ${judgeableRows.toLocaleString('ko-KR')}곳까지 판단할 수 있습니다 · 시·군을 골라 나눠 진행해 주세요`,
  /** 서버가 한도 초과로 거부했을 때(422 INGEST_OVER_BUDGET). 서버 문장 두 개를 이어 보인다. */
  overBudget: (message: string, nextAction: string) => `${message} · ${nextAction}`,
  /** 머리 수집 요약의 끝 줄(#549). 예: "20곳을 더했습니다 · 실제 $0.74" */
  addedWithCost: (n: number, actualUsd: number) =>
    `${n.toLocaleString('ko-KR')}곳을 더했습니다 · 실제 ${usdText(actualUsd)}`,
  previewAdd: (n: number) => `누르면 최대 ${n.toLocaleString('ko-KR')}곳을 영업 후보로 더합니다`,
  previewNothingToAdd: '더할 공장이 없습니다',
  previewFree: '조건을 바꿔 보는 것은 비용이 들지 않습니다',
  previewLoading: '맞는 공장을 세는 중',
  previewFailed: '맞는 공장 수를 불러오지 못했습니다',
} as const;

/**
 * 돈이 드는 단추(💰) 옆에 보이는 이번 달 AI 사용액(#549 ③). 서버의 월 합을 그대로 보인다.
 * 예: "이번 달 AI 사용 $3.20 / $20.00"
 */
export const monthSpend = {
  used: (usedUsd: number, limitUsd: number) =>
    `이번 달 AI 사용 ${usdText(usedUsd)} / ${usdText(limitUsd)}`,
  failed: '이번 달 AI 사용액을 불러오지 못했습니다',
} as const;

/** 상세 머리 "기업 요약"(#210): 조사일·한 줄·특징·대표번호와 홈페이지 상태 띠. */
/**
 * 상세 맨 위 "이 회사 한눈에"(#563): ① 홈페이지 ② 한두 줄 소개 ③ 왜 이 회사인지·적합도.
 * 모두 이미 저장된 값이라 새 AI 호출이 없다. 값이 없으면 그다음 근거로 대신한다.
 */
export const companyGlance = {
  title: '이 회사 한눈에',
  homepage: '홈페이지',
  /** 공식 홈페이지가 없을 때 대신 보이는 링크 이름. */
  searchPage: '검색에서 찾은 페이지',
  evidencePage: '근거가 나온 페이지',
  noHomepage: '홈페이지를 찾지 못했습니다',
  needsConfirm: '확인 필요',
  intro: '소개',
  /** 조사한 한 줄 소개가 없을 때: 공장 자료의 생산품·업종으로 만든 줄. */
  factoryBasis: '공장 자료 기준',
  produces: (item: string) => `${item} 생산`,
  why: '왜 이 회사',
  aiJudgment: 'AI 판단',
  fit: { HIGH: '적합도 상', MEDIUM: '적합도 중', LOW: '적합도 하' },
} as const;

/** 팩토리온 공장조회에서 붙인 공장 등록 정보(#573). 종업원 수는 실제와 많이 달라 화면에 보이지 않는다(#635). */
export const factoryProfileLabels = {
  row: '공장 정보',
  /** 공장 등록 업종명(#617). AI 추정이 아니라 등록 자료에 적힌 사실이다. */
  industry: (value: string) => `업종 ${value}`,
  rawMaterials: (value: string) => `원자재 ${value}`,
  /** 줄 끝 흐린 글자(출처 표시, #583): "한국산업단지공단 팩토리온 11/11 기준, 가공" */
  basis: (date: string) => `한국산업단지공단 팩토리온 ${date} 기준, 가공`,
} as const;

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

/**
 * 상세 머리 홈페이지 줄(#210, 서버 #304): [맞음]·[고치기]·[다시 조사]와 본문 붙여넣기 칸.
 * 실패 문구는 서버가 주는 message·nextAction을 그대로 보이므로 여기에는 모양에 쓰는 말만 둔다.
 */
export const homepageControls = {
  confirmButton: '맞음',
  editButton: '고치기',
  /** 홈페이지 주소가 아직 없을 때 [고치기] 자리에 보이는 단추. */
  addButton: '주소 넣기',
  rerunButton: '다시 조사 💰',
  urlLabel: '홈페이지 주소',
  urlPlaceholder: 'https://',
  runWithUrl: '이 주소로 조사',
  cancel: '취소',
  invalidUrl: '홈페이지 주소는 http:// 또는 https:// 로 시작해야 합니다.',
  pasteLabel: '공개 본문 붙여넣기',
  pastePlaceholder: '홈페이지에 공개된 소개 글을 여기에 붙여 넣어 주세요',
  pasteEmpty: '붙여 넣은 내용이 비어 있습니다.',
  runWithPaste: '붙여 넣은 내용으로 조사',
  running: '조사 중입니다. 최대 1분 걸릴 수 있습니다.',
  /** 못 눌러서 잠긴 이유(한도 초과·설정 전). 서버 안내 문구 아래에 작게 보인다. */
  locked: '이 조사는 지금 다시 누를 수 없습니다.',
  pickStaffFirst: '담당자를 고르면 누를 수 있습니다.',
  reload: '새로 불러오기',
  /** 문의 번호(서버 ref). 작게 보인다. */
  ref: (ref: string) => `문의 번호 ${ref}`,
  confirmed: '홈페이지 주소를 맞다고 확인했습니다.',
  /** "근거 3건(확인 필요 1건 포함)·질문 1건 저장, 재평가 완료" */
  researched: (evidence: number, candidates: number, questions: number) =>
    `근거 ${evidence}건${candidates > 0 ? `(확인 필요 ${candidates}건 포함)` : ''}·질문 ${questions}건 저장, 재평가 완료`,
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

/** 세부 단계(#607). 큰 단계 안의 단계라 카드는 "접촉 · 수요 확인"처럼 붙여 보인다. */
export const salesStepLabels = {
  NOT_REACHED: '연결 전',
  REACHED: '연결됨',
  DEMAND_CONFIRMED: '수요 확인',
  MATERIAL_QUOTE: '자료·견적',
  VISIT_SAMPLE: '방문·샘플',
} as const;

/** 상세 기록 구역의 꼬리 질문(#607, PM 결정 2026-11-12). 문구는 질문 파일에서 오고 여기는 틀만. */
export const salesQuestionTexts = {
  summaryTitle: '지금 세부 단계',
  /** "수요 확인 (10/22부터)" */
  stepSince: (label: string, since: string | null) =>
    since ? `${label} (${since.slice(5).replace('-', '/')}부터)` : label,
  stepNone: '아직 접촉 없음',
  stepClosed: '보류·성사·거절에는 세부 단계가 없습니다',
  overridden: '담당자가 고침',
  known: '알아낸 것',
  knownNone: '아직 없음',
  unknown: '아직 모르는 것',
  questionsTitle: '이번 접촉에서 알게 된 것',
  questionsHint: '아는 것만 고르세요. 고르지 않은 질문은 다음 접촉 때 다시 보입니다.',
  clearAnswer: '선택 지우기',
  memoLabel: '한 줄 메모 (선택)',
  memoHint: '질문에 없는 이야기만 짧게 적어 주세요. 이 메모는 외부로 나가지 않습니다.',
  overrideLabel: '세부 단계 고치기',
  overrideSave: '단계 고치기',
  loadFailed: '꼬리 질문을 불러오지 못했습니다. 접촉 기록은 그대로 저장할 수 있습니다.',
  /** 마무리 답을 골랐을 때 저장 전 미리 알림(#643). "저장하면 영업 단계가 '거절 · 가격'(으)로 바뀝니다." */
  closePreview: (stage: string) => `저장하면 영업 단계가 '${stage}'(으)로 바뀝니다.`,
  closeNeedsReason: '거절 이유를 골라야 저장할 수 있습니다.',
  closeOtherNeedsMemo: '기타를 골랐으면 한 줄 메모에 이유를 적어 주세요.',
} as const;

/** 꼬리 질문의 공정·산업 확인(#652): 여러 개를 고르면 그 회사의 공정·산업이 확정된다. */
export const salesChoiceTexts = {
  unknown: '아직 모름',
  aiTag: 'AI 제안',
  caseFileTag: '사례 파일',
  staffTag: '담당자 확정',
  confirmedTag: '확정됨',
  hint: '여러 개 고를 수 있습니다. AI 제안은 참고용이라 미리 골라 두지 않았습니다.',
  lockedHint: '이미 확정된 공정은 그대로 둡니다.',
  industryMax: (max: number) => `산업군은 ${max}개까지 고를 수 있습니다.`,
  /** "저장하면 이 회사의 공정이 '아연도금'(으)로 확정되고 다른 AI 제안 4개는 빠집니다." */
  processPreview: (names: string, dropped: number) =>
    dropped > 0
      ? `저장하면 이 회사의 공정이 '${names}'(으)로 확정되고 다른 AI 제안 ${dropped}개는 빠집니다.`
      : `저장하면 이 회사의 공정이 '${names}'(으)로 확정됩니다.`,
  industryPreview: (names: string) => `저장하면 이 회사의 산업이 '${names}'(으)로 확정됩니다.`,
  unknownPreview: '아직 모름이면 저장해도 바뀌지 않고, 다음 접촉에서 다시 묻습니다.',
  /** 이미 확정된 값이 있는 회사에서만 보이는 보기. 고르고 저장하면 확정된 값이 답이 된다. */
  keep: '지금 확정된 것이 맞음',
  keepProcessHint: (dropped: number) =>
    dropped > 0
      ? `확정된 공정이 맞으면 '지금 확정된 것이 맞음'을 고르고 저장하세요(남은 AI 제안 ${dropped}개는 빠집니다).`
      : `확정된 공정이 맞으면 '지금 확정된 것이 맞음'을 고르고 저장하세요.`,
  keepIndustryHint: `확정된 산업이 맞으면 '지금 확정된 것이 맞음'을 고르고 저장하세요.`,
  keepProcessPreview: (names: string, dropped: number) =>
    dropped > 0
      ? `저장하면 확정된 공정 '${names}'이(가) 맞는 것으로 남고 남은 AI 제안 ${dropped}개는 빠집니다.`
      : `저장하면 확정된 공정 '${names}'이(가) 맞는 것으로 남습니다.`,
  keepIndustryPreview: (names: string) =>
    `저장하면 확정된 산업 '${names}'이(가) 맞는 것으로 남습니다.`,
} as const;

export const contactMethodLabels = { CALL: '전화', EMAIL: '메일', VISIT: '방문' } as const;
export const contactResultLabels = { REACHED: '연결됨', ABSENT: '부재', DECLINED: '거절' } as const;
/** 접촉 때 AI 판단이 맞았나(#531). 외주처가 있어 거절해도 사실이 맞으면 "맞음"이다. */
export const judgmentCheckLabels = {
  MATCHED: '맞음',
  MISMATCHED: '다름',
  UNKNOWN: '모름',
} as const;
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
  OWN_PLATING_LINE_SUSPECTED: '표면처리를 직접 하는 회사일 수 있음',
  ITEM_INPUT_PROPOSAL: 'AI 제안 점수 입력',
  PROCESS_LINK_PROPOSAL: 'AI 제안 공정 연결',
} as const;
/** 꼬리표 글자. 질문은 뒤에 "·상대 회사" / "·거산"이 붙는다. */
export const reviewItemKindTagLabels = {
  QUESTION: 'AI 질문',
  DATA_NOT_FOUND: '자료 못 찾음',
  DATA_INSUFFICIENT: '자료 부족',
  OWN_PLATING_LINE_SUSPECTED: '표면처리 직접 · 확인 필요',
  ITEM_INPUT_PROPOSAL: 'AI 제안 점수 입력',
  PROCESS_LINK_PROPOSAL: 'AI 제안 공정 연결',
} as const;

/**
 * "표면처리를 직접 하는 회사일 수 있음" 표시(#319, 결정 2026-11-06). 카드 꼬리표 글자와 근거 줄 이름.
 * 거산이 표면처리를 하는 회사라서 같은 일을 하는 회사는 영업 대상이 아닐 수 있다. 자동으로 빼지 않고 담당자가 확인한다.
 */
export const ownPlatingLine = {
  tag: '표면처리를 직접 하는 회사일 수 있음 · 확인 필요',
  /** 근거 줄 이름. 카드에 이미 있는 "추천 근거"와 헷갈리지 않게 "확인 근거"로 한다. 예: 확인 근거 | 생산품 "알루미늄 아노다이징" */
  basisLabel: '확인 근거',
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
  judgmentCheck: 'AI 판단이 맞았나',
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
  /** 세 칸을 "한 일 → 지금 단계 → 다음 할 일" 순서로 읽게 하는 안내(#433, PM 결정 2026-11-08). */
  flowGuide: '① 한 일 적기(접촉·메모) → ② 지금 단계 → ③ 다음 할 일',
  stepOne: '①',
  stepTwo: '②',
  stepThree: '③',
  /**
   * 접촉을 저장하면 서버가 꼬리 질문 답에 따라 단계를 정한다(#607 앞으로만, #643 보류·성사·거절까지).
   * 아래 선택 칸은 잘못됐을 때 고치는 용도다.
   */
  stageAutoHint: '단계는 꼬리 질문 답에 따라 저절로 저장됩니다. 잘못됐을 때만 여기서 고치세요.',
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
  /**
   * AI 제안 줄의 [확정]·[고치기](#498, PM 결정 2026-11-09). 제안 줄에는 체크 상자 대신 이 단추가 붙는다.
   * [고치기]는 줄 안에 드롭다운이 열려(모달 없음) 단계 하나를 고른다. 공정 연결 제안은 1차에 [확정]만.
   */
  proposalConfirm: '확정',
  proposalFix: '고치기',
  proposalConfirmLabel: (text: string) => `확정: ${text}`,
  proposalFixLabel: (text: string) => `고치기: ${text}`,
  stepPickerLabel: '고칠 단계',
  stepPlaceholder: '단계를 고르세요',
  stepSave: '이 단계로 확정',
  stepCancel: '취소',
  /**
   * 자료 줄("자료 못 찾음"·"자료 부족")의 [붙여넣고 조사](#260, PM 결정 2026-11-04). 공개 본문만 붙여 넣고,
   * 서버는 기존 홈페이지 조사 요청(url + pastedText)으로 근거를 뽑아 다시 평가한다. 줄 안 인라인(모달 없음).
   */
  /**
   * 자료 줄의 [메모 적기]/[메모 고치기](#260, PM 결정 2026-11-04). 기록용이라 점수는 안 바뀌고 밖으로 나가지 않는다.
   * 줄 안 인라인 입력(모달 없음, 500자). 저장하면 줄 아래 "메모: … — 박 이사 · 11/20".
   */
  memoAdd: '메모 적기',
  memoEdit: '메모 고치기',
  memoButtonLabel: (text: string) => `메모 적기: ${text}`,
  memoInputLabel: '자료 조사 메모',
  memoPlaceholder: '찾은 내용과 출처 주소를 적으세요. 예: 홈페이지 연혁에 2023 납품 기재 https://…',
  memoHint:
    '기록용 메모입니다. 점수는 바뀌지 않고 밖으로 나가지 않습니다. 저장하면 이전 메모는 활동 이력에 남습니다.',
  memoMaxLength: 500,
  memoCounter: (count: number, max: number) => `${count} / ${max}자`,
  memoSave: '메모 저장',
  memoCancel: '취소',
  /** "메모: 홈페이지 연혁에 2023 납품 기재" */
  memoPrefix: '메모:',
  memoSaveFailed: '메모를 저장하지 못했습니다. 다시 시도',
  pasteButton: '붙여넣고 조사 💰',
  pasteButtonLabel: (text: string) => `붙여넣고 조사: ${text}`,
  pasteUrlLabel: '출처 주소 (공개 홈페이지·공고)',
  pasteUrlPlaceholder: 'https://',
  pasteTextLabel: '공개 본문',
  pasteTextPlaceholder: '공개된 홈페이지 글이나 공고 본문을 붙여 넣어 주세요',
  pasteHint: '공개 자료만 됩니다. 붙여넣은 글은 AI에 보내 근거를 뽑고 다시 평가합니다.',
  pasteInvalidUrl: '출처 주소는 http:// 또는 https:// 로 시작해야 합니다.',
  pasteEmpty: '붙여 넣은 내용이 비어 있습니다.',
  pasteSubmit: '조사',
  pasteCancel: '취소',
  pasteRunning: '조사 중입니다. 최대 1분 걸릴 수 있습니다.',
  pasteLocked: '이 조사는 지금 다시 누를 수 없습니다.',
  pasteReload: '새로 불러오기',
  /**
   * 줄이 많을 때의 묶음(#619, PM 요청 2026-11-13). "확인 필요"만 펼쳐 두고 나머지 두 묶음은 접어 둔다.
   * 줄 글은 서버가 준 그대로이고 여기에는 묶음 머리 문구만 둔다.
   */
  /** "확인 필요 0 / 3" — 펼쳐 둔 묶음의 줄만 센다. */
  askProgress: (done: number, total: number) => `확인 필요 ${done} / ${total}`,
  askEmpty: '지금 바로 확인할 줄은 없습니다. 아래 묶음은 눌러서 펼쳐 볼 수 있습니다.',
  /** "아직 근거·자료가 없는 항목 10개 보기" / "AI 공정 연결 제안 7개 보기 · 아연도금, 아노다이징 외 5개" */
  foldHead: (
    group: 'gap' | 'process',
    count: number,
    open: boolean,
    shown: readonly string[],
    rest: number,
    recorded: number,
  ) => {
    const title = group === 'gap' ? '아직 근거·자료가 없는 항목' : 'AI 공정 연결 제안';
    const nameText =
      shown.length > 0 ? ` · ${shown.join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''}` : '';
    const recordedText = recorded > 0 ? ` · 기록한 줄 ${recorded}개` : '';
    return `${open ? '▾' : '▸'} ${title} ${count}개 ${open ? '접기' : '보기'}${nameText}${recordedText}`;
  },
  foldListLabel: (group: 'gap' | 'process') =>
    group === 'gap' ? '근거·자료가 없는 항목 목록' : 'AI 공정 연결 제안 목록',
  /** 검토사항 맨 위 "왜 추천했나" 한 줄. 고른 이유·등록 사실은 바로 위 "이 회사 한눈에"에 있어 다시 적지 않는다. */
  whyTitle: '왜 추천했나',
  whyProcesses: (names: readonly string[]) => `연결된 공정: ${names.join(', ')}`,
  whySeeGlance: '고른 이유와 등록 사실은 위 "이 회사 한눈에"에 있습니다.',
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
  /** 묶음 전환 단추(#389). 기본은 전체. */
  groupFilterLabel: '활동 이력 거르기',
  groupAll: '전체',
  groupEmpty: (group: string) => `${group} 기록이 아직 없습니다.`,
  /** 기록 취소(#254): 내 기록 줄의 [잘못 입력]과 줄 안에 열리는 확인 한 줄(모달 없음). */
  cancelButton: '잘못 입력',
  cancelButtonLabel: (summary: string) => `잘못 입력으로 표시: ${summary}`,
  cancelPrompt: '이 기록을 잘못 입력으로 표시합니다. 이유(선택)',
  cancelReasonLabel: '취소 이유(선택)',
  cancelReasonMaxLength: 200,
  cancelConfirm: '표시',
  cancelClose: '닫기',
  cancelBusy: '표시하는 중',
  cancelFailed: '잘못 입력으로 표시하지 못했습니다.',
  /** 취소된 줄 아래 한 줄. 예: "취소 · 박 이사 · 11/06". */
  cancelledNote: (name: string, date: string) =>
    `취소 · ${[name, date].filter(Boolean).join(' · ')}`,
} as const;

/**
 * 상세 "비슷한 회사 참고"(#269, PM 결정 2026-11-04 A안)와 영업 전략 영역의 "참고한 이력" 상자.
 * 같은 공정·산업군 다른 회사 최대 5곳의 영업 단계·거절 이유·마지막 접촉·최근 메모를 내부에서만 본다.
 */
export const peersArea = {
  title: '비슷한 회사 참고',
  /** 영역 머리 한 줄. 메모가 들어 있어 영업 메모와 같은 취급이다. */
  internalNote: '내부 참고 · 밖으로 안 나감',
  loading: '불러오는 중',
  loadFailed: '비슷한 회사를 불러오지 못했습니다.',
  retry: '다시 불러오기',
  empty: '같은 공정·산업군의 다른 회사가 아직 없습니다.',
  listLabel: '비슷한 회사 목록',
  /** 요약 줄 묶음 사이 구분 "같은 공정 4곳 · 산업군 2곳 | 접촉 1 · 거절 1(가격) | 전화 연결 3/5". */
  summaryDivider: ' | ',
  summaryCounts: (processCount: number, industryCount: number) =>
    `같은 공정 ${processCount}곳 · 산업군 ${industryCount}곳`,
  /** "거절 3(가격 2 · 납기 1)" 처럼 거절 건수 뒤에 이유 상위를 붙인다. */
  stageCount: (label: string, count: number, reasons?: string) =>
    reasons ? `${label} ${count}(${reasons})` : `${label} ${count}`,
  reasonCount: (label: string, count: number) => `${label} ${count}`,
  reachCount: (method: string, reached: number, tried: number) =>
    `${method} 연결 ${reached}/${tried}`,
  sameProcess: '같은 공정',
  sameIndustry: '같은 산업군',
  noStage: '영업 기록 없음',
  /** 거절이면 "거절 · 가격". */
  lostWithReason: (stage: string, reason: string) => `${stage} · ${reason}`,
  noContact: '접촉 기록 없음',
  /** "11/06 전화" */
  lastContact: (date: string, method: string) => [date, method].filter(Boolean).join(' '),
  notePrefix: '메모:',
  /** 메모 줄은 120자에서 자르고 "…". */
  noteMaxLength: 120,
  openCompanyLabel: (name: string) => `${name} 상세 보기`,
  /** 영업 전략 영역(#27)의 "참고한 이력" 상자. 초안 글(공개 자료 기반 AI)과 섞지 않는다. */
  referenceTitle: '참고한 이력',
  referenceCompaniesShown: 2,
} as const;

/** 활동 이력 묶음(#389) 쉬운 말. 묶음 정의는 components/records/activityGroups.ts. */
export const activityGroupLabels = {
  SALES: '영업 활동',
  FACT: '사실',
  FEEDBACK: '의견',
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
  RECORD_CANCELLED: '기록 취소',
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

/**
 * 추천 목록 [엑셀 내려받기](#217). 지금 걸러 본 목록 전체를 내부용 엑셀로 받는다.
 * 파일에는 회사·공정·점수·단계·다음 일정 다섯 열만 있고 영업 메모·대표번호는 담지 않는다(약속 C4).
 */
export const listExport = {
  button: '엑셀 내려받기',
  /** 단추에 마우스를 올리면 보이는 풀이. */
  hint: '지금 걸러 본 목록 전체를 내부용 엑셀로 받습니다. 영업 메모와 대표번호는 담지 않습니다.',
  done: (fileName: string) =>
    `${fileName} 파일을 내려받았습니다. 내부용이며 고객 제출용이 아닙니다.`,
  failed: '엑셀을 내려받지 못했습니다.',
  /** 서버가 파일 이름을 주지 않았을 때 쓰는 이름. */
  defaultFileName: '거산_추천목록.xlsx',
  /** 서버 없이 가짜 응답으로 화면만 볼 때. */
  noFixture: '서버 없이 화면만 보는 중에는 엑셀을 만들 수 없습니다.',
} as const;

/** 영업 분석(#608): 영업 기록만으로 계산한 공정별·회사별 표. 내부 참고용이고 밖으로 나가지 않는다. */
export const salesAnalysisTexts = {
  loadError: '영업 분석표를 불러오지 못했습니다.',
  intro: '담당자가 남긴 접촉·단계·거절 이유 기록만으로 계산합니다. AI는 쓰지 않습니다.',
  /** "11/13 09:00 기준 · 접촉 기록이 있는 회사 3곳 · 성사·거절은 최근 365일 안의 것만" */
  basis: (asOf: string | null, companyCount: number, windowDays: number) =>
    [
      asOf ? `${asOf} 기준` : null,
      `접촉 기록이 있는 회사 ${companyCount}곳`,
      `성사·거절은 최근 ${windowDays}일 안의 것만`,
    ]
      .filter(Boolean)
      .join(' · '),
  olderExcluded: (count: number) => `그보다 오래된 성사·거절 ${count}곳은 표에서 빠졌습니다.`,
  countRule: (minSample: number) =>
    `표본이 ${minSample}건보다 적은 줄은 비율 없이 건수와 "표본 n건"만 보입니다. 한 회사가 공정·산업군이 여러 개면 각각 셉니다.`,
  /** #652부터: 확정된 공정·산업군만 센다. 확인 전 회사는 "확인 전" 한 줄에 모인다. */
  countRuleConfirmed: (minSample: number) =>
    `표본이 ${minSample}건보다 적은 줄은 비율 없이 건수와 "표본 n건"만 보입니다. 담당자가 확인한 공정·산업군으로만 세고, 아직 확인 전인 회사는 "공정 확인 전"·"산업 확인 전" 줄에 모읍니다. 확정된 공정·산업군이 여러 개인 회사는 각각 셉니다.`,
  /** 회사별 표에서 확정된 공정·산업군이 없을 때. */
  unconfirmed: '확인 전',
  empty:
    '아직 접촉 기록이 없습니다. 회사 상세의 영업 기록에 전화·메일·방문을 남기면 여기에 모입니다.',
  emptyAction: '영업 후보 목록으로',
  processTitle: '공정별',
  processTableLabel: '공정별 영업 분석표',
  companyTitle: '회사별',
  companyTableLabel: '회사별 영업 분석표',
  processColumns: {
    name: '공정 · 산업군',
    contacted: '접촉한 곳',
    inProgress: '진행 중',
    onHold: '보류',
    won: '성사',
    lost: '거절',
    avgToWon: '성사까지 평균 접촉',
    reach: '방법별 연결/시도',
    lostReasons: '거절 이유',
    ratio: '비율',
  },
  companyColumns: {
    name: '회사',
    process: '공정',
    industry: '산업군',
    contacts: '접촉',
    stage: '지금 단계',
    firstContact: '첫 접촉',
    lastContact: '마지막 접촉',
    sinceFirst: '첫 접촉 뒤',
    outcome: '결과',
  },
  none: '—',
  places: (count: number) => `${count}곳`,
  times: (value: number) => `${value}번`,
  days: (count: number) => `${count}일`,
  /** 공정 줄 아래 산업군 줄 앞머리. */
  industryPrefix: '└ ',
  /** "전화 2/3" — 연결/시도. */
  reach: (method: string, reached: number, tried: number) => `${method} ${reached}/${tried}`,
  reasonCount: (label: string, count: number) => `${label} ${count}`,
  methodCount: (label: string, count: number) => `${label} ${count}`,
  /** 표본이 기준보다 적을 때 비율 칸에 보이는 말. */
  sampleOnly: (count: number) => `표본 ${count}건`,
  wonRatio: (percent: number) => `성사 ${percent}%`,
  reachRatio: (method: string, percent: number) => `${method} 연결 ${percent}%`,
  /** "접촉 · 수요 확인" / "거절 · 가격" */
  stageWithDetail: (stage: string, detail: string) => `${stage} · ${detail}`,
  /** "첫 접촉 뒤 21일 만에 성사 (11/10)" */
  outcomeAfter: (days: number, stage: string, date: string | null) =>
    `첫 접촉 뒤 ${days}일 만에 ${stage}${date ? ` (${date})` : ''}`,
  openCompanyLabel: (name: string) => `${name} 상세 보기`,
} as const;

// 추천 목록의 세 묶음(#610). 코드는 계약 C0 contactBucket·bucketBasis 그대로다.
const contactBucketTitles = { NOW: '지금 연락할 곳', CHECK: '확인 필요', LATER: '나중' } as const;
export const contactBuckets = {
  titles: contactBucketTitles,
  /** 묶음이 바뀌는 자리의 제목. 예: "지금 연락할 곳 9곳" */
  title: (bucket: keyof typeof contactBucketTitles, count: number) =>
    `${contactBucketTitles[bucket]} ${count}곳`,
  /** 카드 꼬리표: 그 묶음에 든 이유. */
  basis: {
    EXCLUDED_OPINION: '검토 대상 제외',
    REQUIRED_FAILED: '필수조건 탈락',
    EXISTING_CUSTOMER: '거래 중',
    CLOSED_OR_HOLD: '성사·거절·보류',
    IN_PROGRESS: '접촉 진행 중',
    NEED_CHECK_OPINION: '추가 확인 의견',
    REQUIRED_PENDING: '필수조건 확인 전',
    OWN_PLATING: '표면처리 직접 여부 확인',
    NOT_EVALUATED_HIGH_FIT: '평가 전 · 적합도 상',
    NOT_EVALUATED_LOWER_FIT: '평가 전 · 적합도 낮음',
    EVIDENCE_RECHECK: '핵심 근거 재확인',
    REQUIRED_PASSED: '필수조건 통과',
    MONITOR: '지켜보기',
  },
  /** 카드의 조정 이유 줄 이름. */
  adjustRow: '순서 조정',
  /**
   * 조정 이유 한 줄. 예: "같은 공정·산업(아연도금 · 자동차 부품)에서 최근 12개월 성사 2곳 → 위로",
   * "…거절 3곳(수요 없음) → 아래로". 성사·거절 가운데 0곳인 쪽은 적지 않는다.
   */
  adjustLine: (adjust: {
    level: number;
    processName: string;
    industry: string;
    wonCount: number;
    lostCount: number;
    lostReasons: string[];
    windowDays: number;
  }) => {
    const months = Math.round((adjust.windowDays / 365) * 12);
    const period = months >= 1 ? `최근 ${months}개월` : `최근 ${adjust.windowDays}일`;
    const counts = [
      adjust.wonCount > 0 ? `성사 ${adjust.wonCount}곳` : null,
      adjust.lostCount > 0
        ? `거절 ${adjust.lostCount}곳${adjust.lostReasons.length > 0 ? `(${adjust.lostReasons.join('·')})` : ''}`
        : null,
    ].filter((part) => part !== null);
    return `같은 공정·산업(${adjust.processName} · ${adjust.industry})에서 ${period} ${counts.join(' · ')} → ${adjust.level > 0 ? '위로' : '아래로'}`;
  },
} as const;
