// 공정별·산업군별 막대(#898: 청회색 판 위 연노랑 막대 — 영업 분석 "관심 기업 분포"에서만 쓴다). "3곳 (38%)"처럼 개수와 비율을 글자로 함께 보인다(색·길이만으로 전하지 않음).
// 한 회사가 여러 공정·산업군이면 각각 세므로 비율의 합이 100%를 넘을 수 있다.
import { dashboardTexts } from '../../labels/ko';
import { chartTheme, radius, typography } from '../../theme/tokens';

export interface BreakdownRow {
  key: string;
  name: string;
  count: number;
  ratio: number;
}

export interface BreakdownBarsProps {
  title: string;
  rows: BreakdownRow[];
  /** AI 제안 값이 섞여 있으면 제목 옆에 작게 알린다. */
  includesProposed?: boolean;
  testId: string;
  /** 제목 단계. 다른 구역 제목(h2) 아래에 넣을 때는 3을 준다(#679 영업 분석 "관심 기업 분포"). */
  headingLevel?: 2 | 3;
}

export function percentText(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export default function BreakdownBars({
  title,
  rows,
  includesProposed = false,
  testId,
  headingLevel = 2,
}: BreakdownBarsProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section aria-labelledby={`${testId}-title`} data-testid={testId}>
      <Heading
        id={`${testId}-title`}
        style={{ fontSize: typography.fontSizeCardTitle, marginTop: 0 }}
      >
        {title}
        {includesProposed ? (
          <small
            data-testid={`${testId}-proposed`}
            style={{
              marginLeft: 8,
              color: chartTheme.textSecondary,
              fontSize: typography.fontSizeSecondary,
              fontWeight: 400,
            }}
          >
            {dashboardTexts.breakdownProposed}
          </small>
        ) : null}
      </Heading>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <li key={row.key} data-testid={`${testId}-row`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{row.name}</span>
              <span data-testid={`${testId}-value`}>
                {row.count}
                {dashboardTexts.countUnits.NOT_CONTACTED} ({percentText(row.ratio)})
              </span>
            </div>
            <div
              aria-hidden="true"
              style={{ background: chartTheme.track, borderRadius: radius.pill, height: 12 }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.round(row.ratio * 100))}%`,
                  height: 12,
                  borderRadius: radius.pill,
                  background: chartTheme.bar,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
