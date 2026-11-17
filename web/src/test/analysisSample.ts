// 그래프·기간 시험에 쓰는 가상 영업 분석 응답(#760). 회사 이름·숫자 모두 가상이다.
import type { AnalysisStats, SalesAnalysis } from '../api/salesAnalysis';

export function sampleStats(overrides: Partial<AnalysisStats> = {}): AnalysisStats {
  return {
    contactedCount: 12,
    inProgressCount: 6,
    onHoldCount: 1,
    wonCount: 2,
    lostCount: 3,
    avgContactsToWon: 3.5,
    contactReach: {
      CALL: { reached: 6, tried: 10 },
      EMAIL: { reached: 1, tried: 4 },
      VISIT: { reached: 0, tried: 0 },
    },
    lostReasons: [
      { code: 'PRICE', count: 2 },
      { code: 'INCUMBENT_SUPPLIER', count: 1 },
    ],
    ratios: { won: 0.17, reach: { CALL: 0.6, EMAIL: 0.25, VISIT: null } },
    ...overrides,
  };
}

const reach = {
  CALL: { reached: 2, tried: 4 },
  EMAIL: { reached: 0, tried: 1 },
  VISIT: { reached: 0, tried: 0 },
};

export const SAMPLE: SalesAnalysis = {
  asOf: '2026-11-15T09:00:00+09:00',
  basis: { minSampleForRatio: 10, closedWindowDays: 365, companyCount: 12, olderClosedExcluded: 0 },
  byProcess: [
    {
      processCode: 'ZINC_PLATING',
      processName: '아연도금',
      ...sampleStats({ contactedCount: 8, wonCount: 2 }),
      overlapCount: 0,
      byIndustry: [],
    },
    {
      processCode: 'ANODIZING',
      processName: '아노다이징',
      ...sampleStats({ contactedCount: 4, wonCount: 0 }),
      overlapCount: 0,
      byIndustry: [],
    },
  ],
  companies: [
    {
      oppId: 'opp-sample-1',
      name: '가상정밀',
      processCodes: ['ZINC_PLATING'],
      industries: [],
      contactCount: { total: 3, call: 2, email: 1, visit: 0 },
      outcomeStatus: 'IN_PROGRESS',
      salesStep: 'REACHED',
      lostReasonCode: null,
      firstContactAt: '2026-10-05',
      lastContactAt: '2026-10-28',
      daysSinceFirstContact: 41,
      outcomeAt: null,
      daysToOutcome: null,
    },
  ],
  total: sampleStats(),
  bySalesStep: [
    {
      step: 'NOT_REACHED',
      contactedCount: 12,
      contactCount: 9,
      contactReach: reach,
      reachRatios: null,
      reachedCount: 0,
      contactsToReach: 0,
      avgContactsToReach: null,
    },
    {
      step: 'REACHED',
      contactedCount: 7,
      contactCount: 5,
      contactReach: reach,
      reachRatios: null,
      reachedCount: 7,
      contactsToReach: 14,
      avgContactsToReach: null,
    },
  ],
  aiProposalHit: { process: { confirmedCount: 0, hitCount: 0, ratio: null } },
};
