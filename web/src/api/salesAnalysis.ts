// 영업 분석표 읽기(계약 C1 `GET /sales-analysis`, #608). 필드 이름은 계약 모양 그대로(camelCase).
// client.ts·types.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다. 읽기 전용이라 담당자 키를 보내지 않는다.
// 가짜 응답 모드(VITE_USE_FIXTURES=1)에서는 src/test/fixtures/sales-analysis.json(가상 18곳, #760)을 돌려준다.
import { request } from './client';
import type { Envelope } from './types';

export type ContactMethodCode = 'CALL' | 'EMAIL' | 'VISIT';

export interface ReachCount {
  reached: number;
  tried: number;
}

/** 집계 칸. contactedCount가 표본 수이고 진행 중·보류·성사·거절의 합과 같다. */
export interface AnalysisStats {
  contactedCount: number;
  inProgressCount: number;
  onHoldCount: number;
  wonCount: number;
  lostCount: number;
  /** 성사한 회사들의 접촉 수 평균(소수 1자리). 성사가 없으면 null. */
  avgContactsToWon: number | null;
  contactReach: Record<ContactMethodCode, ReachCount>;
  lostReasons: { code: string; count: number }[];
  /** 표본이 설정 기준보다 적으면 null: 화면은 비율 없이 건수와 "표본 n건"만 보인다. */
  ratios: { won: number; reach: Record<ContactMethodCode, number | null> } | null;
}

export interface IndustryAnalysisRow extends AnalysisStats {
  industry: string;
  /** (#684) 이 줄의 회사 가운데 같은 공정 아래 다른 산업군 줄에도 든 회사 수. */
  overlapCount: number;
}

export interface ProcessAnalysisRow extends AnalysisStats {
  /** 공정 연결이 없는 회사를 모은 줄은 null. */
  processCode: string | null;
  processName: string;
  byIndustry: IndustryAnalysisRow[];
  /** (#684) 이 줄의 회사 가운데 다른 공정 줄에도 든 회사 수. */
  overlapCount: number;
}

/** (#684) 세부 단계 한 줄. 서버가 기록 행과 답으로 다시 계산한 단계로 센다. */
export interface StepAnalysisRow {
  step: string;
  /** 이 단계에 머무는 동안 접촉한 회사 수. */
  contactedCount: number;
  /** 이 단계에 머무는 동안의 접촉 시도 수. */
  contactCount: number;
  contactReach: Record<ContactMethodCode, ReachCount>;
  /** 접촉한 회사 수가 설정 기준보다 적으면 null. */
  reachRatios: Record<ContactMethodCode, number | null> | null;
  /** 이 단계에 이른 회사 수. */
  reachedCount: number;
  /** 그 회사들이 이 단계에 처음 이른 접촉까지의 접촉 수 합. */
  contactsToReach: number;
  /** 이른 회사 수가 설정 기준보다 적으면 null: 화면은 평균 없이 합과 회사 수만 보인다. */
  avgContactsToReach: number | null;
}

export interface CompanyAnalysisRow {
  oppId: string;
  name: string;
  processCodes: string[];
  industries: string[];
  contactCount: { total: number; call: number; email: number; visit: number };
  outcomeStatus: string;
  salesStep: string | null;
  lostReasonCode: string | null;
  firstContactAt: string;
  lastContactAt: string;
  daysSinceFirstContact: number;
  outcomeAt: string | null;
  daysToOutcome: number | null;
  /**
   * (#801) 기록으로 이른 가장 먼 세부 단계. 성사·거절·보류 회사도 값이 있다(salesStep은 끝난 회사면 null).
   * 옛 서버·가짜 응답에는 없을 수 있어 선택 칸이다. 없으면 화면은 salesStep으로 대신한다.
   */
  furthestStep?: string | null;
  /** (#801) 취소 안 한 기록 행(저장 순서). 없으면 화면은 첫·마지막 접촉 두 점만 그린다. */
  timeline?: TimelineEvent[];
}

/** (#801) 회사별 타임라인의 기록 행 하나. 코드값·날짜만(메모 글 없음). */
export interface TimelineEvent {
  /** 접촉 날짜(없으면 저장한 날, 한국 날짜 YYYY-MM-DD). */
  at: string;
  /** 접촉 없이 답·단계만 적은 행은 null. */
  method: ContactMethodCode | null;
  result: string | null;
  /** 그 행을 저장한 뒤의 세부 단계. */
  stepAfter: string | null;
  /** 그 행의 큰 단계. */
  status: string;
}

/** (#678) 담당자가 확정한 회사 수와 그 가운데 AI 제안 안에서 고른 회사 수. */
export interface ProposalHit {
  confirmedCount: number;
  hitCount: number;
  /** 확정한 회사 수가 설정 기준보다 적으면 null: 화면은 "12/15"처럼 건수만 보인다. */
  ratio: number | null;
}

export interface SalesAnalysis {
  asOf: string;
  basis: {
    minSampleForRatio: number;
    closedWindowDays: number;
    companyCount: number;
    olderClosedExcluded: number;
    /** (#760) 기간 모드에서 실제로 쓴 양끝(YYYY-MM-DD). 기간을 고르지 않았거나 옛 서버면 없음·null. */
    from?: string | null;
    to?: string | null;
  };
  byProcess: ProcessAnalysisRow[];
  companies: CompanyAnalysisRow[];
  /** (#684) 회사를 한 번씩만 센 합계. */
  total: AnalysisStats;
  /** (#684) 단계별 접촉. 접촉도 도달도 없는 단계는 없다. */
  bySalesStep: StepAnalysisRow[];
  /** (#678) AI 제안 적중. 지금은 공정만 센다(산업군은 확정 전 AI 제안이 저장에 남지 않는다). */
  aiProposalHit: { process: ProposalHit };
}

/** (#760) 분석 기간(한국 날짜 YYYY-MM-DD). 둘 다 null이면 기간 없이 전처럼 센다. */
export interface AnalysisPeriod {
  from: string | null;
  to: string | null;
}

export function getSalesAnalysis(
  signal?: AbortSignal,
  period?: AnalysisPeriod | null,
): Promise<Envelope<SalesAnalysis>> {
  const query = new URLSearchParams();
  if (period?.from) query.set('from', period.from);
  if (period?.to) query.set('to', period.to);
  const search = query.toString();
  return request<SalesAnalysis>(`/sales-analysis${search ? `?${search}` : ''}`, { signal });
}

// ---------------------------------------------------------------------------
// #802·#820: 패턴 펼쳐 보기(계약 C1 `GET /sales-analysis/patterns`). AI 없음, 저장된 기록만 센다.
// 미리 정한 신호·기준 숫자 없이 횟수별·간격별·답별로 펼치고, 표본 기준(minSampleForRatio) 하나로
// "눈에 띔"을 고른다(결론 아님). 응답에는 코드값·건수·비율만 있고 회사 이름·메모 글·답 글은 없다.
// ---------------------------------------------------------------------------

export interface PatternStepCount {
  /** 기록으로 이른 가장 먼 세부 단계. null이면 "연결 전"(단계 기록 없음). */
  step: string | null;
  count: number;
}

/** 펼친 표의 한 칸. 끝난 회사(성사+실패)가 표본 기준 밑이면 wonRatio null·judged false(회색). */
export interface PatternOutcomeCells {
  won: number;
  failed: number;
  inProgress: number;
  wonRatio: number | null;
  judged: boolean;
}

export type ContactBucket = 'ZERO' | 'ONE' | 'TWO' | 'THREE' | 'FOUR_PLUS';
export type GapBucket =
  'WITHIN_WEEK' | 'WITHIN_TWO_WEEKS' | 'WITHIN_MONTH' | 'OVER_MONTH' | 'SINGLE_CONTACT';

export interface PatternContactRow extends PatternOutcomeCells {
  /** 방문했나. 방문 없는 회사는 모든 접촉 수로 칸을 정한다. */
  visited: boolean;
  bucket: ContactBucket;
}

export interface PatternGapRow extends PatternOutcomeCells {
  bucket: GapBucket;
}

export interface PatternAnswerRow extends PatternOutcomeCells {
  questionId: string;
  answerId: string;
}

export interface PatternCombo {
  processCode: string | null;
  industry: string | null;
  region: string | null;
  contacted: number;
  won: number;
  lost: number;
  onHold: number;
  /** 성사 ÷ 끝난 회사. 표본 기준 밑이면 null. */
  wonRatio: number | null;
}

/** 눈에 띔 · 결론 아님 · 사람 확인 전. 칸을 가리키는 열쇠 + 그 칸과 전체의 성사율. */
export interface PatternStandout {
  table: 'CONTACTS_BEFORE_VISIT' | 'LONGEST_GAP' | 'ANSWER' | 'COMBO';
  won: number;
  failed: number;
  wonRatio: number;
  overallWonRatio: number;
  diff: number;
  visited: boolean | null;
  bucket: string | null;
  questionId: string | null;
  answerId: string | null;
  processCode: string | null;
  industry: string | null;
  region: string | null;
}

export interface PatternAnswerFill {
  questionId: string;
  step: string;
  eligible: number;
  answered: number;
  ratio: number | null;
  answers: { answerId: string; count: number }[];
  unknownShare: number | null;
  topShare: number | null;
}

export interface PatternHint {
  questionId: string;
  kind: 'SAME_ANSWER' | 'UNKNOWN_MANY';
  answerId: string | null;
  share: number | null;
}

export interface SalesPatterns {
  asOf: string;
  basis: {
    minSampleForRatio: number;
    closedCount: number;
    wonCount: number;
    overallWonRatio: number | null;
  };
  failure: {
    count: number;
    onHoldCount: number;
    byStep: PatternStepCount[];
    lostReasons: { code: string; count: number }[];
    stepAnswers: {
      step: string;
      questionId: string;
      answers: { answerId: string; count: number }[];
    }[];
  };
  success: {
    count: number;
    byStep: PatternStepCount[];
    avgContactsToWon: number | null;
    avgFirstVisitIndex: number | null;
    failedAvgFirstVisitIndex: number | null;
  };
  contactsBeforeVisit: PatternContactRow[];
  longestGap: PatternGapRow[];
  answerOutcomes: PatternAnswerRow[];
  combos: PatternCombo[];
  standouts: PatternStandout[];
  answerFill: PatternAnswerFill[];
  questionnaireHints: PatternHint[];
  coachEffect: { applied: number; progressed: number; companies: number };
}

export function getSalesPatterns(
  signal?: AbortSignal,
  period?: AnalysisPeriod | null,
): Promise<Envelope<SalesPatterns>> {
  const query = new URLSearchParams();
  if (period?.from) query.set('from', period.from);
  if (period?.to) query.set('to', period.to);
  const search = query.toString();
  return request<SalesPatterns>(`/sales-analysis/patterns${search ? `?${search}` : ''}`, {
    signal,
  });
}

// ---------------------------------------------------------------------------
// #824: AI 분석 피드백(계약 C1 `GET`·`POST /sales-analysis/feedback`). 숫자 표만 외부 AI에 보내고
// 실패를 먼저(어디서 → 왜 → 실패 전 신호 → 성공과 다른 점 → 다음엔), 성공, 다음 할 일을 근거 숫자와
// 받는다. 기간마다 저장하고, 같은 기간·같은 기록이면 다시 부르지 않는다(💰 단추로만 부른다).
// ---------------------------------------------------------------------------

export interface FeedbackClaim {
  text: string;
  /** 표의 숫자를 그대로 옮긴 근거(1개 이상). */
  evidence: string[];
}

export interface AnalysisFeedback {
  feedbackId: string;
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  generatedBy: string;
  model: string | null;
  promptVersion: string;
  inputHash: string;
  costUsd: number | null;
  failure: {
    where: FeedbackClaim[];
    why: FeedbackClaim[];
    signals: FeedbackClaim[];
    vsSuccess: FeedbackClaim[];
    next: FeedbackClaim[];
  };
  success: { where: FeedbackClaim[]; why: FeedbackClaim[]; signals: FeedbackClaim[] };
  next: FeedbackClaim[];
  heldBack: string[];
  /** 프로그램이 센 앞 기간 비교(AI가 만들지 않음). 기간이 없으면 null. */
  comparedToPrevious: {
    previousFrom: string;
    previousTo: string;
    rows: {
      key: 'CONTACTED' | 'WON' | 'LOST' | 'ON_HOLD' | 'IN_PROGRESS';
      current: number;
      previous: number;
    }[];
  } | null;
  aiGenerated: true;
}

export interface FeedbackState {
  feedback: AnalysisFeedback | null;
  /** 저장본이 지금 기록으로 만든 입력과 같으면 true. */
  current: boolean;
  /** 영업 기록을 외부 AI로 보내는 스위치가 켜져 있고 AI 설정이 EXTERNAL이면 true. */
  switchOn: boolean;
}

export function getSalesFeedback(
  signal?: AbortSignal,
  period?: AnalysisPeriod | null,
): Promise<Envelope<FeedbackState>> {
  const query = new URLSearchParams();
  if (period?.from) query.set('from', period.from);
  if (period?.to) query.set('to', period.to);
  const search = query.toString();
  return request<FeedbackState>(`/sales-analysis/feedback${search ? `?${search}` : ''}`, {
    signal,
  });
}

export function requestSalesFeedback(
  period: AnalysisPeriod | null,
  refresh: boolean,
  staffKey: string,
): Promise<Envelope<{ feedback: AnalysisFeedback; reused: boolean }>> {
  return request<{ feedback: AnalysisFeedback; reused: boolean }>('/sales-analysis/feedback', {
    method: 'POST',
    body: { from: period?.from ?? null, to: period?.to ?? null, refresh },
    staffKey,
    // AI가 답하는 동안 기다린다(서버 한도 60초).
    timeoutMs: 70_000,
  });
}
