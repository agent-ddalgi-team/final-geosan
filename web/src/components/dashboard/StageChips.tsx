// 영업 홈 "진행 중인 회사" 카드 안 작은 단계 칸(#921 작은 칩 → #972 큰 카드 5칸 → #983 작은 칸).
//   미접촉 1곳 → 접촉 4곳 → 견적·샘플 5곳 → 성사 3곳 ┊ 보류 1곳(점선 테두리, 화살표 없이 떨어져서)
// #983(PM이 고른 시안 2026-11-28): 맨 위에 따로 있던 큰 카드 5칸을 없애고, 표 카드 머리 아래 작은 칸으로 합쳤다.
//   칸마다 이름 · 굵은 숫자 "곳" · 그 아래 작은 꼬리표 "+2 이번 주" · "멈춤 1".
// 숫자는 서버 집계(counts)를 그대로 쓰고, 서버가 주지 않은 칸은 0으로 지어내지 않고 뺀다.
// 칸을 누르면 아래 표가 그 단계로 걸러진다(다시 누르면 풀림).
//   - 순서가 있는 네 칸 사이에만 화살표를 둔다. 보류는 순서 밖이라 세로 줄로 띄우고 점선 테두리.
//   - 보류도 서버가 숫자를 주면 0곳이어도 칸으로 보인다(#972).
//   - "멈춤 n" = 같은 응답의 단계별 회사 목록(progressCompanies)에서 센 멈춘 회사 수. 1곳 이상일 때만 붙이고,
//     목록이 없으면(옛 서버) 붙이지 않는다. 단추 이름(화면 낭독)에는 "멈춘 회사 n곳"으로 풀어 읽힌다.
//   - "+n 이번 주"(#976) = 이번 주(월요일~오늘)에 그 칸으로 들어온 관심 기업 수. 서버가 준 값(enteredThisWeek)이
//     1 이상일 때만 붙인다. 0이거나 값이 없으면(옛 서버·미접촉 칸) 붙이지 않는다.
import { Fragment } from 'react';
import type { Dashboard, DashboardCounts, ProgressBandKey } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { choiceChip, colors, homePalette, stageCell, typography } from '../../theme/tokens';

export const CHIP_ORDER = ['NOT_CONTACTED', 'IN_CONTACT', 'QUOTE_SAMPLE', 'WON'] as const;

export function stageName(band: ProgressBandKey): string {
  return band === 'ON_HOLD' ? t.progressOnHoldName : t.progressBandNames[band];
}

/** 그 단계에서 멈춘 회사 수. 회사 목록이 없으면(옛 서버) null. */
export function stalledCount(
  companies: Dashboard['progressCompanies'],
  band: ProgressBandKey,
): number | null {
  const rows = companies?.[band];
  return rows ? rows.filter((row) => row.stalled).length : null;
}

const tagStyle = {
  padding: '0 6px',
  borderRadius: stageCell.tagRadius,
  fontSize: stageCell.tagSize,
  fontWeight: 600,
  whiteSpace: 'nowrap',
} as const;

export default function StageChips({
  counts,
  selected,
  onSelect,
  companies,
  entered,
}: {
  counts: DashboardCounts;
  selected: ProgressBandKey | null;
  onSelect: (band: ProgressBandKey | null) => void;
  /** 단계별 회사 목록(같은 응답). "멈춤 n" 꼬리표에만 쓴다. */
  companies?: Dashboard['progressCompanies'];
  /** 칸별 이번 주 진입 수(같은 응답, #976). 없으면(옛 서버) 꼬리표를 붙이지 않는다. */
  entered?: Dashboard['enteredThisWeek'];
}) {
  // 서버가 준 칸만.
  const bands = [...CHIP_ORDER, 'ON_HOLD' as const].filter(
    (band) => typeof counts[band] === 'number',
  );
  if (bands.length === 0) return null;
  const ordered = bands.filter((band) => band !== 'ON_HOLD');
  return (
    <div
      role="group"
      aria-label={t.stageChipsLabel}
      title={t.stageChipsHint}
      data-testid="dashboard-stage-chips"
      // 넓으면 한 줄에 모두, 좁으면 다음 줄로 내려간다.
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: stageCell.gap }}
    >
      {bands.map((band) => {
        const on = selected === band;
        const hold = band === 'ON_HOLD';
        const value = counts[band] ?? 0;
        const stalled = stalledCount(companies, band) ?? 0;
        const enteredRaw = entered?.[band];
        const enteredCount = typeof enteredRaw === 'number' && enteredRaw > 0 ? enteredRaw : 0;
        const label =
          `${stageName(band)} ${value}${t.stageCellUnit}` +
          (enteredCount > 0 ? ` · ${t.stageCardEnteredHint(enteredCount)}` : '') +
          (stalled > 0 ? ` · ${t.stageCardStalled(stalled)}` : '');
        const hasNext = !hold && ordered.indexOf(band) < ordered.length - 1;
        return (
          <Fragment key={band}>
            {/* 보류는 순서 밖이라 앞에 세로 줄을 두어 떨어뜨린다(순서 칸이 하나도 없으면 줄도 없다). */}
            {hold && ordered.length > 0 ? (
              <span
                aria-hidden="true"
                data-testid="dashboard-stage-divider"
                style={{
                  width: 1,
                  height: stageCell.dividerHeight,
                  margin: '0 6px',
                  background: stageCell.divider,
                }}
              />
            ) : null}
            <button
              type="button"
              aria-pressed={on}
              aria-label={label}
              onClick={() => onSelect(on ? null : band)}
              data-testid={`dashboard-stage-chip-${band}`}
              data-hold={hold ? 'true' : undefined}
              style={{
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 3,
                minWidth: stageCell.minWidth,
                textAlign: 'left',
                font: 'inherit',
                padding: stageCell.padding,
                borderRadius: stageCell.radius,
                // 고른 칸은 강조 테두리 + 강조 연한 바탕. 보류는 점선 테두리.
                border: on
                  ? `1px solid ${choiceChip.selected.border}`
                  : hold
                    ? `1px dashed ${homePalette.holdBorder}`
                    : `1px solid ${colors.borderSecondary}`,
                background: on ? choiceChip.selected.bg : colors.bgContainer,
                color: colors.text,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span
                  style={{ fontSize: typography.fontSizeSecondary, color: colors.textSecondary }}
                >
                  {stageName(band)}
                </span>
                <b style={{ fontSize: stageCell.countSize, fontWeight: 700, lineHeight: 1.2 }}>
                  {value}
                </b>
                <span style={{ fontSize: stageCell.unitSize, color: colors.textDimmed }}>
                  {t.stageCellUnit}
                </span>
              </span>
              {/* 꼬리표가 없는 칸도 같은 높이를 지켜 칸들이 한 줄로 나란하다. */}
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 18 }}>
                {enteredCount > 0 ? (
                  <span
                    title={t.stageCardEnteredHint(enteredCount)}
                    data-testid={`dashboard-stage-entered-${band}`}
                    style={{
                      ...tagStyle,
                      background: stageCell.enteredTag.bg,
                      color: stageCell.enteredTag.fg,
                    }}
                  >
                    {t.stageCardEntered(enteredCount)}
                  </span>
                ) : null}
                {stalled > 0 ? (
                  <span
                    title={t.stageCardStalled(stalled)}
                    data-testid={`dashboard-stage-stalled-${band}`}
                    style={{
                      ...tagStyle,
                      background: stageCell.stalledTag.bg,
                      color: stageCell.stalledTag.fg,
                    }}
                  >
                    {t.stageCellStalled(stalled)}
                  </span>
                ) : null}
              </span>
            </button>
            {hasNext ? (
              <span
                aria-hidden="true"
                data-testid="dashboard-stage-arrow"
                style={{ color: stageCell.arrow, fontSize: stageCell.arrowSize }}
              >
                →
              </span>
            ) : null}
          </Fragment>
        );
      })}
      <span
        data-testid="dashboard-stage-hint"
        style={{
          fontSize: typography.fontSizeSecondary - 1,
          color: colors.textDimmed,
          marginLeft: 8,
        }}
      >
        {t.stageCellHint}
      </span>
    </div>
  );
}
