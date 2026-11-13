// 영업 분석표 읽기(계약 C1 `GET /sales-analysis`, #608). 필드 이름은 계약 모양 그대로(camelCase).
// client.ts·types.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다. 읽기 전용이라 담당자 키를 보내지 않는다.
// 가짜 응답 모드(VITE_USE_FIXTURES=1)에는 이 경로의 고정값이 없어 화면이 "불러오지 못함"을 보인다.
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

export function getSalesAnalysis(signal?: AbortSignal): Promise<Envelope<SalesAnalysis>> {
  return request<SalesAnalysis>('/sales-analysis', { signal });
}
