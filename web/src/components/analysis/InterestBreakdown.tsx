// 영업 분석 화면 위쪽 "관심 기업 분포"(#679, PM 결정 2026-11-13): 대시보드에 있던 공정별·산업군별 막대를 옮겨 왔다.
// 값은 대시보드 집계(`GET /dashboard`의 breakdown, #627) 그대로다. 세는 기준(관심 기업, AI 제안 포함)은 바꾸지 않았고,
// 아래 표(확정된 공정·산업만)와 기준이 다르다는 한 줄을 막대 아래에 붙인다. 기준을 맞추는 일은 #684.
import { Link } from 'react-router-dom';
import type { DashboardBreakdown } from '../../api/dashboardTypes';
import BreakdownBars from '../dashboard/BreakdownBars';
import { dashboardTexts, salesAnalysisTexts as texts } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';

const secondary = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;

export interface InterestBreakdownProps {
  /** 대시보드 집계의 막대 값. 가상 묶음처럼 서버가 주지 않으면(null·없음) 구역을 그리지 않는다. */
  breakdown: DashboardBreakdown | null | undefined;
  /** 막대 값을 못 읽었을 때. 빈 막대로 숨기지 않고 못 불러왔다고 알린다. */
  failed?: boolean;
}

export default function InterestBreakdown({ breakdown, failed = false }: InterestBreakdownProps) {
  if (!failed && !breakdown) return null;
  return (
    <section
      aria-labelledby="analysis-breakdown-title"
      data-testid="analysis-breakdown"
      style={{
        display: 'grid',
        gap: 12,
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 12,
        padding: spacing.cardPadding,
      }}
    >
      <h2
        id="analysis-breakdown-title"
        style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}
      >
        {texts.breakdownTitle}
      </h2>
      {failed || !breakdown ? (
        <p role="alert" data-testid="analysis-breakdown-error" style={secondary}>
          {texts.breakdownLoadError}
        </p>
      ) : breakdown.basis.total === 0 ? (
        <p data-testid="analysis-breakdown-empty" style={secondary}>
          {dashboardTexts.breakdownEmptyText}{' '}
          <Link to="/opportunities" data-testid="analysis-breakdown-empty-link">
            {dashboardTexts.breakdownEmptyAction}
          </Link>
        </p>
      ) : (
        <>
          <p data-testid="analysis-breakdown-basis" style={secondary}>
            {dashboardTexts.breakdownBasis(breakdown.basis.total)}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: spacing.sectionGap,
            }}
          >
            <BreakdownBars
              testId="analysis-by-process"
              headingLevel={3}
              title={dashboardTexts.breakdownProcessTitle}
              rows={breakdown.byProcess.map((item) => ({
                key: item.processCode,
                name: item.processName,
                count: item.count,
                ratio: item.ratio,
              }))}
            />
            <BreakdownBars
              testId="analysis-by-industry"
              headingLevel={3}
              title={dashboardTexts.breakdownIndustryTitle}
              includesProposed={breakdown.byIndustry.some((item) => item.includesProposed)}
              rows={breakdown.byIndustry.map((item) => ({
                key: item.industry,
                name: item.industry,
                count: item.count,
                ratio: item.ratio,
              }))}
            />
          </div>
          <p data-testid="analysis-breakdown-note" style={secondary}>
            {texts.breakdownNote}
          </p>
        </>
      )}
    </section>
  );
}
