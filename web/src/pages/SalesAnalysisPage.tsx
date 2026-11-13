// 영업 분석(#608, PM 결정 2026-11-12: 대시보드와 따로 둔 화면). 영업 기록만으로 서버가 계산한 공정별·회사별 표를 보인다.
// 읽기 전용이라 보기 전용 담당자도 본다. 영업 기록에서 나온 내부 참고 화면이라 엑셀·AI로 내보내는 단추를 두지 않는다.
// 가상 묶음이면 응답 meta를 띠에 알려 "가상" 표시가 보인다.
// 맨 위 "관심 기업 분포"(#679, PM 결정 2026-11-13)는 대시보드에서 옮겨 온 공정별·산업군별 막대다.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboard } from '../api/dashboard';
import type { DashboardBreakdown } from '../api/dashboardTypes';
import { getSalesAnalysis } from '../api/salesAnalysis';
import type { SalesAnalysis } from '../api/salesAnalysis';
import type { Meta } from '../api/types';
import CompanyAnalysisTable from '../components/analysis/CompanyAnalysisTable';
import InterestBreakdown from '../components/analysis/InterestBreakdown';
import ProcessAnalysisTable from '../components/analysis/ProcessAnalysisTable';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { peersArea, salesAnalysisTexts as texts } from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';
import { formatMonthDayTime } from '../utils/time';

interface Result {
  /** 어떤 요청의 결과인지(다시 시도 횟수). */
  key: number;
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

export default function SalesAnalysisPage() {
  const { setBannerMeta } = useFrame();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSalesAnalysis(controller.signal)
      .then((envelope) => {
        if (controller.signal.aborted) return;
        setResult({ key: reload, data: envelope.data, meta: envelope.meta });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: reload, error });
      });
    return () => controller.abort();
  }, [reload]);

  const current = result?.key === reload ? result : null;
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
  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (current.error) state = 'error';
  else if (!data || data.companies.length === 0) state = 'empty';

  const processNames: Record<string, string> = {};
  for (const row of data?.byProcess ?? []) {
    if (row.processCode) processNames[row.processCode] = row.processName;
  }

  return (
    <div style={{ display: 'grid', gap: spacing.cardGap }}>
      <p data-testid="analysis-internal-note" style={secondary}>
        {peersArea.internalNote} · {texts.intro}
      </p>
      <InterestBreakdown
        breakdown={currentBreakdown?.value}
        failed={currentBreakdown?.failed === true}
      />
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
                {texts.basis(
                  formatMonthDayTime(data.asOf),
                  data.basis.companyCount,
                  data.basis.closedWindowDays,
                )}
                {data.basis.olderClosedExcluded > 0
                  ? ` · ${texts.olderExcluded(data.basis.olderClosedExcluded)}`
                  : ''}
              </p>
              <p data-testid="analysis-count-rule" style={secondary}>
                {texts.countRuleConfirmed(data.basis.minSampleForRatio)}
              </p>
            </div>
            <section aria-labelledby="analysis-process-title" style={sectionStyle}>
              <h2 id="analysis-process-title" style={titleStyle}>
                {texts.processTitle}
              </h2>
              <ProcessAnalysisTable rows={data.byProcess} />
            </section>
            <section aria-labelledby="analysis-company-title" style={sectionStyle}>
              <h2 id="analysis-company-title" style={titleStyle}>
                {texts.companyTitle}
              </h2>
              <CompanyAnalysisTable rows={data.companies} processNames={processNames} />
            </section>
          </div>
        ) : null}
      </FiveStates>
    </div>
  );
}
