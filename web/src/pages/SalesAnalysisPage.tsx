// 영업 분석(#608, PM 결정 2026-11-12: 대시보드와 따로 둔 화면). 영업 기록만으로 서버가 계산한 공정별·회사별 표를 보인다.
// 읽기 전용이라 보기 전용 담당자도 본다. 영업 기록에서 나온 내부 참고 화면이라 엑셀·AI로 내보내는 단추를 두지 않는다.
// 가상 묶음이면 응답 meta를 띠에 알려 "가상" 표시가 보인다.
// 맨 위 "관심 기업 분포"(#679, PM 결정 2026-11-13)는 대시보드에서 옮겨 온 공정별·산업군별 막대다.
// #760(PM 2026-11-15): 오른쪽 위 기간 선택("2026년 9월 1일 ~ 11월 15일")으로 고른 기간 안 접촉만 센다. 기간은
// 주소(?from=&to=)에 남아 새로 고쳐도 그대로다.
// #801(PM 지시 2026-11-16): 겹치는 숫자 칸 대신 네 그림(깔때기·거절 이유·공정 × 산업·회사별 타임라인)을 맨 위에 두고,
// 표와 관심 기업 분포는 [표로 보기]에 접어 둔다(기본 닫힘). 지금 상태 숫자(진행 중·보류)는 대시보드 몫이다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getDashboard } from '../api/dashboard';
import type { DashboardBreakdown } from '../api/dashboardTypes';
import { getSalesAnalysis } from '../api/salesAnalysis';
import type { AnalysisPeriod, SalesAnalysis } from '../api/salesAnalysis';
import type { Meta } from '../api/types';
import AnalysisCharts from '../components/analysis/AnalysisCharts';
import SalesPatterns from '../components/analysis/SalesPatterns';
import CompanyAnalysisTable from '../components/analysis/CompanyAnalysisTable';
import InterestBreakdown from '../components/analysis/InterestBreakdown';
import ProcessAnalysisTable from '../components/analysis/ProcessAnalysisTable';
import PeriodPicker from '../components/analysis/PeriodPicker';
import StepAnalysisTable from '../components/analysis/StepAnalysisTable';
import { proposalHitText } from '../components/analysis/analysisText';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { analysisCharts, peersArea, salesAnalysisTexts as texts } from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';
import { formatMonthDayTime } from '../utils/time';

interface Result {
  /** 어떤 요청의 결과인지(다시 시도 횟수). */
  key: number;
  /** 어떤 기간의 결과인지("from~to"). */
  period: string;
  data?: SalesAnalysis;
  meta?: Meta;
  error?: unknown;
}

const sectionStyle = {
  display: 'grid',
  gap: 12,
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: 12,
  padding: spacing.cardPadding,
} as const;
const titleStyle = { fontSize: typography.fontSizeCardTitle, margin: 0 } as const;
const secondary = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function SalesAnalysisPage() {
  const { setBannerMeta } = useFrame();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  // 기간은 주소에 둔다. 모양이 틀린 값은 버린다(서버에 보내지 않는다).
  const [params, setParams] = useSearchParams();
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const period = useMemo<AnalysisPeriod>(
    () => ({
      from: rawFrom && DAY.test(rawFrom) ? rawFrom : null,
      to: rawTo && DAY.test(rawTo) ? rawTo : null,
    }),
    [rawFrom, rawTo],
  );
  const periodKey = `${period.from ?? ''}~${period.to ?? ''}`;
  const changePeriod = (next: AnalysisPeriod) => {
    const nextParams = new URLSearchParams(params);
    for (const key of ['from', 'to'] as const) {
      if (next[key]) nextParams.set(key, next[key] as string);
      else nextParams.delete(key);
    }
    setParams(nextParams, { replace: true });
  };

  useEffect(() => {
    const controller = new AbortController();
    getSalesAnalysis(controller.signal, period)
      .then((envelope) => {
        if (controller.signal.aborted) return;
        setResult({ key: reload, period: periodKey, data: envelope.data, meta: envelope.meta });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: reload, period: periodKey, error });
      });
    return () => controller.abort();
    // periodKey가 period를 대신한다(같은 기간이면 다시 부르지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, periodKey]);

  const current = result?.key === reload && result.period === periodKey ? result : null;
  const meta = current?.meta ?? null;

  useEffect(() => {
    if (!meta) return undefined;
    setBannerMeta(meta);
    return () => setBannerMeta(null);
  }, [meta, setBannerMeta]);

  // "관심 기업 분포" 막대(#679): 새 경로 없이 대시보드 집계를 한 번 더 읽어 막대 값만 쓴다.
  // 담당자 키는 보내지 않는다(최근 내 기록은 쓰지 않는다). 못 읽어도 아래 표는 그대로 보인다.
  const [breakdown, setBreakdown] = useState<{
    key: number;
    value?: DashboardBreakdown | null;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getDashboard(controller.signal)
      .then((envelope) => {
        if (controller.signal.aborted) return;
        setBreakdown({ key: reload, value: envelope.data.breakdown ?? null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setBreakdown({ key: reload, failed: true });
      });
    return () => controller.abort();
  }, [reload]);
  const currentBreakdown = breakdown?.key === reload ? breakdown : null;

  const retry = useCallback(() => setReload((n) => n + 1), []);

  const data = current?.data;
  // "관심 기업 분포"(#679)는 기간과 상관없는 막대라 그래프 아래로 내렸다(#760, 숫자 칸·그래프를 맨 위에).
  const breakdownSection = (
    <InterestBreakdown
      breakdown={currentBreakdown?.value}
      failed={currentBreakdown?.failed === true}
    />
  );
  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (current.error) state = 'error';
  else if (!data || data.companies.length === 0) state = 'empty';

  // 기간 모드면 서버가 실제로 쓴 양끝으로 기준 줄을 쓴다(옛 서버면 기간 칸이 없어 전처럼).
  const periodMode = Boolean(data && (data.basis.from || data.basis.to));
  const usedRange = data
    ? analysisCharts.periodRange(data.basis.from ?? null, data.basis.to ?? null)
    : '';

  // AI 제안 적중(#678): 담당자가 공정을 확정한 회사가 없으면 줄을 숨긴다.
  const hitText = data ? proposalHitText(data.aiProposalHit.process) : null;
  const processNames: Record<string, string> = {};
  for (const row of data?.byProcess ?? []) {
    if (row.processCode) processNames[row.processCode] = row.processName;
  }

  return (
    <div style={{ display: 'grid', gap: spacing.cardGap }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <p data-testid="analysis-internal-note" style={{ ...secondary, flex: '1 1 320px' }}>
          {peersArea.internalNote} · {texts.intro}
        </p>
        <PeriodPicker value={period} onChange={changePeriod} />
      </div>
      <FiveStates
        data-testid="analysis"
        state={state}
        errorTitle={texts.loadError}
        error={current?.error}
        onRetry={retry}
        emptyText={texts.empty}
        emptyAction={
          <Link to="/opportunities" data-testid="analysis-empty-link">
            {texts.emptyAction}
          </Link>
        }
      >
        {data ? (
          <div style={{ display: 'grid', gap: spacing.sectionGap }}>
            <div style={{ display: 'grid', gap: 4 }}>
              <p data-testid="analysis-basis" style={secondary}>
                {periodMode
                  ? analysisCharts.basisPeriod(
                      formatMonthDayTime(data.asOf),
                      usedRange,
                      data.basis.companyCount,
                    )
                  : texts.basis(
                      formatMonthDayTime(data.asOf),
                      data.basis.companyCount,
                      data.basis.closedWindowDays,
                    )}
                {data.basis.olderClosedExcluded > 0
                  ? ` · ${
                      periodMode
                        ? analysisCharts.olderExcludedPeriod(data.basis.olderClosedExcluded)
                        : texts.olderExcluded(data.basis.olderClosedExcluded)
                    }`
                  : ''}
              </p>
              {periodMode ? (
                <p data-testid="analysis-period-rule" style={secondary}>
                  {analysisCharts.periodRule}
                </p>
              ) : null}
              <p data-testid="analysis-count-rule" style={secondary}>
                {texts.countRuleConfirmed(data.basis.minSampleForRatio)}
              </p>
              {hitText ? (
                <p data-testid="analysis-proposal-hit" style={{ margin: 0 }}>
                  {hitText}
                </p>
              ) : null}
            </div>
            <AnalysisCharts data={data} />
            {/* #802 1단계: 기록에서 배우기(실패 먼저). AI 없이 저장된 기록만 센 값. */}
            <SalesPatterns period={period} reloadKey={reload} processNames={processNames} />
            <details data-testid="analysis-tables" style={{ display: 'grid' }}>
              <summary
                data-testid="analysis-tables-toggle"
                style={{
                  cursor: 'pointer',
                  fontSize: typography.fontSizeCardTitle,
                  fontWeight: 600,
                }}
              >
                {analysisCharts.tablesToggle}
              </summary>
              <div style={{ display: 'grid', gap: spacing.sectionGap, marginTop: 16 }}>
                {/* 관심 기업 분포(#679)는 기간과 상관없는 막대라 표 묶음 맨 위에 둔다. */}
                {breakdownSection}
                <h2
                  data-testid="analysis-tables-title"
                  style={{ ...titleStyle, marginBottom: -16 }}
                >
                  {analysisCharts.tablesTitle}
                </h2>
                <section aria-labelledby="analysis-process-title" style={sectionStyle}>
                  <h2 id="analysis-process-title" style={titleStyle}>
                    {texts.processTitle}
                  </h2>
                  <ProcessAnalysisTable rows={data.byProcess} total={data.total} />
                  <p data-testid="analysis-sum-note" style={secondary}>
                    {texts.sumNote}
                  </p>
                </section>
                {data.bySalesStep.length > 0 ? (
                  <section aria-labelledby="analysis-step-title" style={sectionStyle}>
                    <h2 id="analysis-step-title" style={titleStyle}>
                      {texts.stepTitle}
                    </h2>
                    <StepAnalysisTable rows={data.bySalesStep} />
                    <p data-testid="analysis-step-note" style={secondary}>
                      {texts.stepNote}
                    </p>
                  </section>
                ) : null}
                <section aria-labelledby="analysis-company-title" style={sectionStyle}>
                  <h2 id="analysis-company-title" style={titleStyle}>
                    {texts.companyTitle}
                  </h2>
                  <CompanyAnalysisTable rows={data.companies} processNames={processNames} />
                </section>
              </div>
            </details>
          </div>
        ) : null}
      </FiveStates>
      {/* 분석표가 아직 없거나 못 읽었어도 관심 기업 분포는 따로 보인다. */}
      {state === 'ready' ? null : breakdownSection}
    </div>
  );
}
