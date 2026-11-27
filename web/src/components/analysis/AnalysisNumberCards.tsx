// 영업 분석 숫자 카드 4칸(#972, PM 결정 2026-11-27): 접촉 · 진행 중 · 성사 · 거절.
// #801에서 "겹친다"고 뺐던 칸을 새 시안대로 담당자 선호 제안 아래·그림 위에 다시 둔다.
// 숫자는 분석 응답의 합계(total, 회사를 한 번씩 센 값) 그대로라 고른 기간을 따른다. 새 숫자를 지어내지 않는다.
// 보조 글 한 줄도 응답에 있는 값으로만 만들고, 값이 없으면 그 줄을 뺀다:
//   접촉 = 이번 달 접촉(월별 추세의 마지막 달, 기간을 고르지 않았을 때만 — 월별 값은 기간과 상관없어서)
//   진행 중 = 진행 중인 회사가 가장 많이 머문 세부 단계
//   성사 = 성사·거절을 세는 범위("최근 365일", 기간을 고르지 않았을 때만 — 기간을 고르면 이 범위를 쓰지 않아서)
//   거절 = 따로 센 보류 곳 수
import type { SalesAnalysis } from '../../api/salesAnalysis';
import { analysisNumberCardTexts as t, labelFor, salesStepLabels } from '../../labels/ko';
import { colors, radius, typography } from '../../theme/tokens';
import { topOpenStep } from './chartSummaries';

export type NumberCardKey = 'contacted' | 'inProgress' | 'won' | 'lost';

export interface NumberCard {
  key: NumberCardKey;
  label: string;
  value: number;
  /** 보조 글 한 줄. 응답에 값이 없으면 null(줄을 그리지 않는다). */
  sub: string | null;
}

/** 분석 응답 → 카드 4칸의 값. 화면과 시험이 같은 계산을 쓴다. */
export function numberCards(data: SalesAnalysis): NumberCard[] {
  const { total, basis } = data;
  // 서버가 기간 모드에서 실제로 쓴 양끝을 돌려준다. 둘 다 없으면 기간을 고르지 않은 것이다.
  const periodMode = Boolean(basis.from || basis.to);
  const thisMonth =
    !periodMode && data.monthly && data.monthly.length > 0
      ? data.monthly[data.monthly.length - 1]
      : null;
  const openStep = topOpenStep(data.companies);
  return [
    {
      key: 'contacted',
      label: t.contacted,
      value: total.contactedCount,
      sub: thisMonth ? t.thisMonth(thisMonth.contacted) : null,
    },
    {
      key: 'inProgress',
      label: t.inProgress,
      value: total.inProgressCount,
      sub: openStep ? t.openStep(labelFor(salesStepLabels, openStep.step), openStep.count) : null,
    },
    {
      key: 'won',
      label: t.won,
      value: total.wonCount,
      sub: periodMode ? null : t.closedWindow(basis.closedWindowDays),
    },
    {
      key: 'lost',
      label: t.lost,
      value: total.lostCount,
      sub: total.onHoldCount > 0 ? t.holdApart(total.onHoldCount) : null,
    },
  ];
}

export default function AnalysisNumberCards({ data }: { data: SalesAnalysis }) {
  return (
    <ul
      aria-label={t.groupLabel}
      data-testid="analysis-number-cards"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        // 넓으면 4칸 한 줄, 좁으면 2칸씩 내려간다.
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 14,
      }}
    >
      {numberCards(data).map((card) => (
        <li
          key={card.key}
          data-testid={`number-card-${card.key}`}
          style={{
            display: 'grid',
            gap: 4,
            alignContent: 'start',
            minWidth: 0,
            background: colors.bgContainer,
            border: `1px solid ${colors.borderSecondary}`,
            borderRadius: radius.card,
            padding: '18px 20px',
          }}
        >
          <span style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}>
            {card.label}
          </span>
          <strong
            data-testid="number-card-value"
            style={{
              fontSize: typography.fontSizeH1,
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: -0.8,
              color: colors.text,
            }}
          >
            {card.value}
            <span
              style={{
                marginLeft: 3,
                fontSize: typography.fontSize,
                fontWeight: 400,
                letterSpacing: 0,
                color: colors.textDimmed,
              }}
            >
              {t.unit}
            </span>
          </strong>
          {card.sub ? (
            <span
              data-testid="number-card-sub"
              style={{ color: colors.textDimmed, fontSize: typography.fontSizeSecondary }}
            >
              {card.sub}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
