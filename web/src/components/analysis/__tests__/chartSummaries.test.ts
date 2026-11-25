// 그림 아래 요약 문장·말풍선(#898). 그림과 같은 값을 세기만 하고, 표본이 적으면 비율을 말하지 않는지 본다.
// 회사 이름·숫자는 모두 가상이다.
import { describe, expect, it } from 'vitest';
import { funnelStages } from '../AnalysisCharts';
import {
  breakdownReading,
  funnelReading,
  gridReading,
  lostReading,
  monthlyReading,
  timelineReading,
} from '../chartSummaries';
import type {
  CompanyAnalysisRow,
  IndustryAnalysisRow,
  ProcessAnalysisRow,
} from '../../../api/salesAnalysis';
import { labelFor, salesStepLabels } from '../../../labels/ko';
import { sampleStats } from '../../../test/analysisSample';

function company(overrides: Partial<CompanyAnalysisRow>): CompanyAnalysisRow {
  return {
    oppId: `opp-${overrides.name ?? 'x'}`,
    name: '가상',
    processCodes: [],
    industries: [],
    contactCount: { total: 1, call: 1, email: 0, visit: 0 },
    outcomeStatus: 'IN_PROGRESS',
    salesStep: 'NOT_REACHED',
    lostReasonCode: null,
    firstContactAt: '2026-10-01',
    lastContactAt: '2026-10-01',
    daysSinceFirstContact: 10,
    outcomeAt: null,
    daysToOutcome: null,
    furthestStep: 'NOT_REACHED',
    timeline: [],
    ...overrides,
  };
}

// 가상 6곳: 성사 1 · 수요 확인에서 거절 2 · 연결에서 보류 1 · 견적 진행 1 · 연결 전 1
const SIX: CompanyAnalysisRow[] = [
  company({ name: '가', outcomeStatus: 'WON', salesStep: null, furthestStep: 'VISIT_SAMPLE' }),
  company({ name: '나', outcomeStatus: 'LOST', salesStep: null, furthestStep: 'DEMAND_CONFIRMED' }),
  company({ name: '다', outcomeStatus: 'LOST', salesStep: null, furthestStep: 'DEMAND_CONFIRMED' }),
  company({ name: '라', outcomeStatus: 'ON_HOLD', salesStep: null, furthestStep: 'REACHED' }),
  company({ name: '마', salesStep: 'MATERIAL_QUOTE', furthestStep: 'MATERIAL_QUOTE' }),
  company({ name: '바' }),
];

function industry(name: string, contacted: number, won: number): IndustryAnalysisRow {
  return {
    ...sampleStats({ contactedCount: contacted, wonCount: won }),
    industry: name,
    overlapCount: 0,
  };
}

function processRow(
  code: string | null,
  name: string,
  byIndustry: IndustryAnalysisRow[],
): ProcessAnalysisRow {
  return { ...sampleStats(), processCode: code, processName: name, byIndustry, overlapCount: 0 };
}

describe('깔때기 요약', () => {
  it('어디까지 갔는지·성사·가장 많이 멈춘 단계를 말하고, 표본이 적으면 비율 대신 그 사실을 말한다', () => {
    const reading = funnelReading(funnelStages(SIX), 10);
    expect(reading?.summary).toBe(
      '접촉한 6곳 가운데 2곳이 견적·샘플까지 갔습니다. 성사는 1곳입니다. ' +
        '가장 많이 멈춘 단계는 수요 확인(2곳)입니다. 표본이 10곳보다 적어 비율은 아직 보지 않습니다.',
    );
    expect(reading?.callout).toEqual({ value: '2곳', label: '수요 확인에서 멈춤' });
  });

  it('그 단계가 표본 기준을 넘으면 다음으로 넘어간 비율을 말한다', () => {
    // 수요 확인까지 온 4곳 가운데 2곳이 견적·샘플로 넘어감 → 50%
    expect(funnelReading(funnelStages(SIX), 3)?.summary).toContain(
      '이 단계에서 다음으로 넘어간 비율은 50%입니다.',
    );
  });

  it('접촉이 없으면 요약하지 않는다', () => {
    expect(funnelReading(funnelStages([]), 10)).toBeNull();
  });

  it('아무도 연결되지 않았으면 그렇게 말한다', () => {
    const reading = funnelReading(funnelStages([company({ name: '가' })]), 10);
    expect(reading?.summary).toContain('접촉한 1곳 모두 아직 연결 전입니다. 아직 성사는 없습니다.');
  });
});

describe('거절 이유 요약', () => {
  it('가장 많은 이유 하나를 말한다', () => {
    const reading = lostReading(
      sampleStats({
        lostReasons: [
          { code: 'LEAD_TIME', count: 1 },
          { code: 'PRICE', count: 3 },
        ],
      }),
    );
    expect(reading?.summary).toBe('거절 4곳 가운데 가장 많은 이유는 가격(3곳)입니다.');
    expect(reading?.callout).toEqual({ value: '3곳', label: '가격' });
  });

  it('거절이 없으면 판 안 안내로 충분해 요약하지 않는다', () => {
    expect(lostReading(sampleStats({ lostReasons: [] }))).toBeNull();
  });
});

describe('공정 × 산업 요약', () => {
  it('확인 전 칸보다 확인된 조합을 먼저 말하고, 모두 표본 미만이면 성사율을 견주지 않는다고 말한다', () => {
    const reading = gridReading(
      [
        processRow('ZINC_PLATING', '아연도금', [
          industry('자동차 부품', 2, 1),
          industry('산업 확인 전', 1, 0),
        ]),
        processRow(null, '공정 확인 전', [industry('산업 확인 전', 5, 0)]),
      ],
      10,
    );
    expect(reading?.summary).toBe(
      '가장 많이 접촉한 조합은 아연도금 × 자동차 부품(2곳)입니다. ' +
        '성사가 가장 많이 나온 조합은 아연도금 × 자동차 부품(1곳)입니다. ' +
        '모든 조합이 표본 10곳 미만이라 성사율은 아직 견주지 않습니다.',
    );
    expect(reading?.callout).toEqual({ value: '2곳', label: '아연도금 × 자동차 부품' });
  });

  it('같은 수의 조합이 여럿이면 하나를 가장 많다고 하지 않고 몇 개가 같은지 말한다', () => {
    const reading = gridReading(
      [
        processRow('ZINC_PLATING', '아연도금', [
          industry('반도체 장비', 1, 0),
          industry('자동차 부품', 1, 0),
        ]),
        processRow('ANODIZING', '아노다이징', [industry('기계·설비', 1, 0)]),
      ],
      10,
    );
    expect(reading?.summary).toContain(
      '1곳씩 접촉한 조합이 3개로 가장 많습니다(예: 아연도금 × 반도체 장비).',
    );
    expect(reading?.callout).toEqual({ value: '1곳', label: '조합 3개가 같음' });
  });

  it('확인된 조합이 없으면 확인 전 칸으로 말하고, 성사가 없으면 그렇게 말한다', () => {
    const reading = gridReading(
      [processRow(null, '공정 확인 전', [industry('산업 확인 전', 12, 0)])],
      10,
    );
    expect(reading?.summary).toBe(
      '가장 많이 접촉한 조합은 공정 확인 전 × 산업 확인 전(12곳)입니다. 아직 성사가 나온 조합은 없습니다.',
    );
  });
});

describe('회사별 타임라인 요약', () => {
  it('끝난 상태별 수와 진행 중 회사가 가장 많이 머문 단계를 말한다', () => {
    const reading = timelineReading(SIX);
    expect(reading?.summary).toBe(
      '회사 6곳 가운데 진행 중 2곳 · 성사 1곳 · 거절 2곳 · 보류 1곳입니다. ' +
        `진행 중인 회사는 ${labelFor(salesStepLabels, 'MATERIAL_QUOTE')} 단계에 가장 많이 머물러 있습니다(1곳).`,
    );
    expect(reading?.callout).toEqual({ value: '2곳', label: '진행 중' });
  });
});

describe('월별 추세 요약', () => {
  it('이번 달과 지난달 차이, 가장 많았던 달, 12개월 성사·거절을 말한다', () => {
    const reading = monthlyReading([
      { month: '2026-09', contacted: 6, won: 1, lost: 0 },
      { month: '2026-10', contacted: 4, won: 0, lost: 1 },
      { month: '2026-11', contacted: 3, won: 0, lost: 0 },
    ]);
    expect(reading?.summary).toBe(
      '11월 접촉은 3곳으로 지난달보다 1곳 줄었습니다. ' +
        '최근 12개월 가운데 접촉이 가장 많았던 달은 9월(6곳)입니다. 12개월 동안 성사 1곳 · 거절 1곳입니다.',
    );
    expect(reading?.callout).toEqual({ value: '3곳', label: '11월 접촉 · 지난달 ↘ -1' });
  });

  it('기록이 하나도 없으면 요약하지 않는다', () => {
    expect(monthlyReading([{ month: '2026-11', contacted: 0, won: 0, lost: 0 }])).toBeNull();
  });
});

describe('관심 기업 분포 요약', () => {
  it('가장 많은 공정(비율)과 산업군을 말한다', () => {
    const reading = breakdownReading({
      basis: { statuses: [], total: 10 },
      byProcess: [
        { processCode: 'A', processName: '아연도금', count: 7, ratio: 0.7 },
        { processCode: 'B', processName: '아노다이징', count: 3, ratio: 0.3 },
      ],
      byIndustry: [{ industry: '자동차 부품', count: 4, ratio: 0.4, includesProposed: false }],
    });
    expect(reading?.summary).toBe(
      '공정은 아연도금 7곳(70%), 산업군은 자동차 부품 4곳으로 가장 많습니다. 관심 기업이 2개 공정에 나뉘어 있습니다.',
    );
    expect(reading?.callout).toEqual({ value: '70%', label: '아연도금' });
  });
});
