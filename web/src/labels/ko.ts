// 쉬운 말 대응표 — 화면 문구의 유일한 출처(BR10.9, NFR11.4). 화면 코드에 문구를 직접 적지 않는다.
// 뒤 단위는 여기에 항목을 "추가만" 하고 기존 키를 바꾸지 않는다(U1 확장 지점 규칙).
// 분류 11개의 쉬운 말은 서버 규칙 설정(classificationLabels)이 원본이며, 아래 값은 서버 응답이 없을 때의
// 기본값이다(같은 값, 규칙 설정 BR6.3). 코드표 밖 코드는 `labelFor`가 코드 그대로를 돌려주고 콘솔에 경고한다.
import type { StatusTone } from '../theme/tokens';
import type { CheckDisplay, ClassificationCode, Opinion, ReviewStatus } from '../api/types';

export const classificationLabels: Record<ClassificationCode, string> = {
  FILTER_EXCLUDED: '대상 아님(제외)',
  FILTER_PENDING: '기다리는 중 (확인 필요)',
  OPS_PENDING: '준비 중',
  NOT_EVALUATED: '평가 전',
  CONTACT_URGENT: '지금 바로 연락 검토',
  CONTACT_PLANNED: '계획해서 연락 검토',
  CONTACT_REVIEW: '확인 후 연락 검토',
  RESEARCH: '더 알아봐야 함',
  CONDITIONAL_WAIT: '조건 갖춰지면 다시 봄',
  WATCH: '지켜보는 중',
  LOW: '나중에',
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

export const coreEvidenceRecheckLabel = '근거 다시 확인';

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
  WORTH_REVIEW: '검토할 만함',
  NEED_CHECK: '추가 확인',
  NOT_TARGET: '대상 아님',
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
  NEW_PROPOSAL: '처음 제안',
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
} as const;

/** 의견 영역 문구(BR10.6, BR9.1). */
export const opinionArea = {
  groupLabel: '내 의견',
  savedPrefix: '저장됨',
  savedSummaryPrefix: '의견:',
  edit: '수정',
  saveFailed: '저장하지 못했습니다. 다시 시도',
  reasonLabel: '대상 아님 사유',
  reasonRequired: '사유를 적어 주세요',
  memoLabel: '메모(선택, 200자)',
  pickStaffFirst: '먼저 담당자를 고르세요',
  changedByOther: '다른 담당자가 방금 바꿨습니다',
  save: '저장',
  cancel: '취소',
} as const;

/** 공통 틀 문구. */
export const frame = {
  skipToContent: '본문으로 건너뛰기',
  menuOpportunities: '추천 목록',
  staffSelectLabel: '담당자',
  staffPlaceholder: '담당자를 고르세요',
  backToList: '목록으로',
  viewDetail: '자세히 보기',
  pageTitleList: '추천 목록',
  navLabel: '주 메뉴',
  staffLoadFailed: '담당자 목록을 불러오지 못했습니다. 화면을 새로고침해 주세요.',
} as const;

/** 카드·상세 줄 머리말. */
export const cardRows = {
  reason: '추천 이유',
  blocker: '막는 조건',
  nextAction: '다음 할 일',
  rankPrefix: '순위',
  scorePrefix: '점수',
  blocksApproval: '(승인 막힘)',
  notBlocksApproval: '(승인은 막지 않음)',
  virtualTag: '가상 사례',
  referenceScorePrefix: '참고',
  reevaluated: '재평가됨',
} as const;

/** 상세 영역 제목(BR10.5 순서). */
export const detailSections = {
  reasons: '1. 추천 이유와 다음 할 일',
  requirements: '2. 고객이 요구하는 것과 거산의 준비 상태',
  processLinks: '3. 공정 연결',
  evidence: '4. 근거 자료',
  scores: '5. 점수 자세히 보기',
  questionsHeading: '확인 질문',
  expandQuestions: (n: number) => `나머지 ${n}개 펼치기`,
  collapseQuestions: '접기',
  approvalEligible: '승인 가능 여부',
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
