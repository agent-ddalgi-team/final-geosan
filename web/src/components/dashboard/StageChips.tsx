// 영업 홈 단계 숫자 카드(#921 작은 칩 → #972 새 디자인: 큰 카드 5칸).
//   미접촉 4곳 › 접촉 6곳 › 견적·샘플 3곳 › 성사 3곳   보류 1곳(점선 테두리, 화살표 없음)
// 숫자는 서버 집계(counts)를 그대로 쓰고, 서버가 주지 않은 칸은 0으로 지어내지 않고 뺀다.
// 카드를 누르면 아래 "진행 중인 회사" 표가 그 단계로 걸러진다(다시 누르면 풀림).
// #972(PM 결정 2026-11-27):
//   - 순서가 있는 네 칸 사이 틈 가운데에 작은 동그라미 화살표를 둔다. 보류는 순서 밖이라 화살표 없이 점선 테두리.
//   - 보류도 서버가 숫자를 주면 0곳이어도 카드로 보인다(예전에는 0곳이면 숨겼다. 5칸 자리를 지키려고 바꿈).
//   - 멈춘 회사 수는 같은 응답의 단계별 회사 목록(progressCompanies)에서 센다. 목록이 없으면(옛 서버) 꼬리표를 붙이지 않는다.
//   - "이번 주 +1" 같은 지난주 대비 글은 응답에 없어 만들지 않는다.
import type { Dashboard, DashboardCounts, ProgressBandKey } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, homePalette, radius, stepArrow, tagPalette, typography } from '../../theme/tokens';

export const CHIP_ORDER = ['NOT_CONTACTED', 'IN_CONTACT', 'QUOTE_SAMPLE', 'WON'] as const;
/** 카드 사이 틈(px). 화살표를 이 틈의 가운데에 놓는다. */
export const STAGE_CARD_GAP = 14;

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

function Arrow() {
  return (
    <span
      aria-hidden="true"
      data-testid="dashboard-stage-arrow"
      style={{
        position: 'absolute',
        // 틈 가운데: 카드 오른쪽 끝에서 틈의 반 + 동그라미의 반만큼 밖으로.
        right: -(STAGE_CARD_GAP / 2 + stepArrow.size / 2),
        top: '50%',
        transform: 'translateY(-50%)',
        width: stepArrow.size,
        height: stepArrow.size,
        boxSizing: 'border-box',
        borderRadius: '50%',
        background: stepArrow.bg,
        border: `1px solid ${stepArrow.border}`,
        display: 'grid',
        placeItems: 'center',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={10}
        height={10}
        viewBox="0 0 24 24"
        fill="none"
        stroke={stepArrow.stroke}
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
    </span>
  );
}

export default function StageChips({
  counts,
  selected,
  onSelect,
  companies,
}: {
  counts: DashboardCounts;
  selected: ProgressBandKey | null;
  onSelect: (band: ProgressBandKey | null) => void;
  /** 단계별 회사 목록(같은 응답). 멈춘 회사 꼬리표에만 쓴다. */
  companies?: Dashboard['progressCompanies'];
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
      style={{
        display: 'grid',
        // 넓으면 한 줄에 모두, 좁으면 다음 줄로 내려간다.
        gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
        gap: STAGE_CARD_GAP,
      }}
    >
      {bands.map((band) => {
        const on = selected === band;
        const hold = band === 'ON_HOLD';
        const value = counts[band] ?? 0;
        const stalled = stalledCount(companies, band) ?? 0;
        const label =
          `${stageName(band)} ${value}곳` +
          (stalled > 0 ? ` · ${t.stageCardStalled(stalled)}` : '');
        const hasNext = !hold && ordered.indexOf(band) < ordered.length - 1;
        return (
          <div key={band} style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
            <button
              type="button"
              aria-pressed={on}
              aria-label={label}
              onClick={() => onSelect(on ? null : band)}
              data-testid={`dashboard-stage-chip-${band}`}
              data-hold={hold ? 'true' : undefined}
              style={{
                cursor: 'pointer',
                flex: 1,
                minWidth: 0,
                display: 'grid',
                alignContent: 'start',
                gap: 6,
                textAlign: 'left',
                font: 'inherit',
                padding: '16px 18px',
                borderRadius: radius.card,
                // 고른 카드는 강조 테두리를 안쪽에 한 줄 더(카드 크기는 그대로). 보류는 점선 테두리.
                border: on
                  ? `1px solid ${homePalette.blueStrong}`
                  : hold
                    ? `1px dashed ${homePalette.holdBorder}`
                    : `1px solid ${colors.borderSecondary}`,
                boxShadow: on ? `inset 0 0 0 1px ${homePalette.blueStrong}` : 'none',
                background: on
                  ? homePalette.blueBg
                  : hold
                    ? homePalette.holdBg
                    : colors.bgContainer,
                color: colors.text,
              }}
            >
              <span style={{ fontSize: typography.fontSizeSecondary, color: colors.textSecondary }}>
                {stageName(band)}
              </span>
              <span style={{ lineHeight: 1.1 }}>
                <b style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.8 }}>{value}</b>
                <span
                  style={{
                    fontSize: typography.fontSizeSecondary,
                    color: homePalette.muted,
                    marginLeft: 3,
                  }}
                >
                  곳
                </span>
              </span>
              <span
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '4px 6px',
                  fontSize: typography.fontSizeSecondary - 1,
                  color: homePalette.muted,
                }}
              >
                {stalled > 0 ? (
                  <span
                    data-testid={`dashboard-stage-stalled-${band}`}
                    style={{
                      padding: '1px 7px',
                      borderRadius: radius.tag,
                      background: tagPalette.warn.bg,
                      color: tagPalette.warn.fg,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.stageCardStalled(stalled)}
                  </span>
                ) : null}
                <span>{t.stageCardHints[band]}</span>
              </span>
            </button>
            {hasNext ? <Arrow /> : null}
          </div>
        );
      })}
    </div>
  );
}
