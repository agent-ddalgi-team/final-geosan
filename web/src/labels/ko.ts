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

/** 대시보드(S4) 문구. 건수 5개·일정·최근 기록·검색·공정/산업군 막대. */
export const dashboardTexts = {
  searchLabel: '회사 이름 검색',
  searchPlaceholder: '회사 이름을 입력하세요',
  searchButton: '검색',
  countsLabel: '영업 단계별 건수',
  countUnits: {
    NOT_CONTACTED: '곳',
    INTERESTED: '곳',
    IN_CONTACT: '곳',
    QUOTE_SAMPLE: '곳',
    SCHEDULE_DUE: '건',
  },
  countNames: {
    NOT_CONTACTED: '미접촉',
    INTERESTED: '관심',
    IN_CONTACT: '접촉 중',
    QUOTE_SAMPLE: '견적·샘플',
    SCHEDULE_DUE: '이번 주 일정',
  },
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
  INTERESTED: '관심',
  IN_PROGRESS: '접촉',
  SAMPLE_OR_REGISTRATION_APPROVED: '견적·샘플',
  ON_HOLD: '보류',
  WON: '성사',
  LOST: '거절',
} as const;

export const contactMethodLabels = { CALL: '전화', EMAIL: '메일', VISIT: '방문' } as const;
export const contactResultLabels = { REACHED: '연결됨', ABSENT: '부재', DECLINED: '거절' } as const;
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
  INTERESTED: 'ask',
  IN_PROGRESS: 'wait',
  SAMPLE_OR_REGISTRATION_APPROVED: 'ok',
  ON_HOLD: 'neutral',
  WON: 'ok',
  LOST: 'no',
};

/** 상세 하단 "기록" 영역(U5): 접촉 시도 / 영업 메모 / 영업 단계 / 다음 일정. */
export const recordsArea = {
  title: '기록',
  contactTitle: '접촉 시도',
  contactMethod: '방법',
  contactResult: '결과',
  contactDate: '날짜',
  contactSave: '접촉 기록 저장',
  contactCount: (total: number, call: number, email: number, visit: number) =>
    `접촉 ${total}회 (전화 ${call} · 메일 ${email} · 방문 ${visit})`,
  noteTitle: '영업 메모',
  noteKind: '종류',
  noteLabel: '메모 내용',
  noteCounter: (used: number, max: number) => `${used} / ${max}자`,
  noteHint: '메모는 덧붙이기만 되고 고치거나 지울 수 없습니다. 이 메모는 외부로 나가지 않습니다.',
  noteSave: '메모 남기기',
  stageTitle: '영업 단계',
  stageCurrent: '현재 단계',
  stageNone: '아직 기록 없음',
  stageReasonLabel: '거절 사유',
  stageReasonRequired: '거절 사유를 적어 주세요',
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
  BOOKMARK: '담기',
  APPROVAL: '승인',
  CONTACT_ATTEMPT: '접촉 시도',
  REPLY: '회신',
  OUTCOME: '영업 단계',
  EVIDENCE_GRADE_CONFIRMED: '근거 등급 확인',
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
