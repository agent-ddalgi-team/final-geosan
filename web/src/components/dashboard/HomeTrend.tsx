// 영업 홈 "월별 접촉 추세" 카드(#972 새 디자인, PM 결정 2026-11-27).
// 영업 분석 화면이 쓰는 월별 추세 응답(`GET /sales-analysis`의 monthly, 최근 12개월)과 그림 부품(MonthlyTrend)을
// 그대로 가져다 쓴다. 새 서버 경로·새 응답 칸은 없다.
//   제목 "월별 접촉 추세" · [영업 분석 보기]  /  큰 숫자 "18곳 접촉 기록이 있는 회사"  /  그림
// 이 칸은 곁들이는 칸이다(명세 3장): 응답을 못 읽거나 월별 값이 없으면 오류를 띄우지 않고 이 칸만 그리지 않는다.
// 같은 응답의 오류·빈 상태는 영업 분석 화면이 보여 준다. 영업 홈의 나머지 칸은 이 요청과 상관없이 그려진다.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSalesAnalysis } from '../../api/salesAnalysis';
import type { SalesAnalysis } from '../../api/salesAnalysis';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, homePalette, radius, spacing, typography } from '../../theme/tokens';
import MonthlyTrend from '../analysis/MonthlyTrend';
import { ChartEmbedContext } from '../common/ChartFrame';

export const SALES_ANALYSIS_PATH = '/sales-analysis';

export default function HomeTrend() {
  const [data, setData] = useState<SalesAnalysis | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSalesAnalysis(controller.signal)
      .then((envelope) => {
        if (!controller.signal.aborted) setData(envelope.data);
      })
      .catch(() => {
        // 못 읽으면 이 칸만 숨긴다(위 설명). 값을 지어내지 않고, 영업 홈 전체를 오류로 만들지 않는다.
        if (!controller.signal.aborted) setData(null);
      });
    return () => controller.abort();
  }, []);

  const rows = data?.monthly;
  if (!data || !rows || rows.length === 0) return null;
  // 큰 숫자는 응답에 있는 값만(회사를 한 번씩 센 합계의 접촉 회사 수). 옛 서버라 없으면 숫자 줄을 그리지 않는다.
  const contacted =
    typeof data.total?.contactedCount === 'number' ? data.total.contactedCount : null;

  return (
    <section
      aria-labelledby="dashboard-trend-title"
      data-testid="dashboard-trend"
      style={{
        display: 'grid',
        gap: 12,
        alignContent: 'start',
        boxSizing: 'border-box',
        minWidth: 0,
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: radius.card,
        padding: spacing.cardPadding,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <h2
          id="dashboard-trend-title"
          style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}
        >
          {t.trendTitle}
        </h2>
        <Link
          to={SALES_ANALYSIS_PATH}
          data-testid="dashboard-trend-link"
          style={{ marginLeft: 'auto', fontSize: typography.fontSizeSecondary }}
        >
          {t.trendLink}
        </Link>
      </div>
      {contacted !== null ? (
        <p data-testid="dashboard-trend-count" style={{ margin: 0, lineHeight: 1.2 }}>
          <b style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.6 }}>
            {t.trendCount(contacted)}
          </b>
          <span
            style={{
              marginLeft: 8,
              color: homePalette.muted,
              fontSize: typography.fontSizeSecondary,
            }}
          >
            {t.trendCountLabel}
          </span>
        </p>
      ) : null}
      {/* 그림 부품은 영업 분석 것 그대로. 이 카드 안에서는 자기 테두리·제목 없이 그림만 그린다. */}
      <ChartEmbedContext.Provider value>
        <MonthlyTrend rows={rows} />
      </ChartEmbedContext.Provider>
    </section>
  );
}
