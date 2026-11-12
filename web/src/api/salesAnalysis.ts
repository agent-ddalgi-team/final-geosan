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
}

export interface ProcessAnalysisRow extends AnalysisStats {
  /** 공정 연결이 없는 회사를 모은 줄은 null. */
  processCode: string | null;
  processName: string;
  byIndustry: IndustryAnalysisRow[];
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
}

export function getSalesAnalysis(signal?: AbortSignal): Promise<Envelope<SalesAnalysis>> {
  return request<SalesAnalysis>('/sales-analysis', { signal });
}
