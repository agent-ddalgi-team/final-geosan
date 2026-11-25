// #921(PM 결정 2026-11-25): 영업 홈 맨 위 한 줄의 작은 영업 단계 칩.
//   미접촉 12 → 접촉 5 → 견적·샘플 2 → 성사 1 · 보류 3
// 숫자는 서버 집계(counts)를 그대로 쓰고, 서버가 주지 않은 칸은 0으로 지어내지 않고 뺀다.
// 칩을 누르면 아래 "진행 중인 회사" 표가 그 단계로 걸러진다(다시 누르면 풀림). 예전 큰 띠(#766)를 대신한다.
// #923(PM 요청 2026-11-25): 알약 대신 예전 "영업 진행" 칸 모양(이름 위·숫자 아래·칸 사이 →)을 작게.
//   회사가 있는 칸은 연두, 없는 칸은 흰 바탕에 얇은 테두리. 보류는 띠 끝에 작은 글 단추 "보류 1곳".
import type { DashboardCounts, ProgressBandKey } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, detailTheme, typography } from '../../theme/tokens';

export const CHIP_ORDER = ['NOT_CONTACTED', 'IN_CONTACT', 'QUOTE_SAMPLE', 'WON'] as const;

export function stageName(band: ProgressBandKey): string {
  return band === 'ON_HOLD' ? t.progressOnHoldName : t.progressBandNames[band];
}

export default function StageChips({
  counts,
  selected,
  onSelect,
}: {
  counts: DashboardCounts;
  selected: ProgressBandKey | null;
  onSelect: (band: ProgressBandKey | null) => void;
}) {
  // 서버가 준 칸만. 보류는 예전 띠처럼 0곳이면 보이지 않는다.
  const bands = [...CHIP_ORDER, 'ON_HOLD' as const].filter(
    (band) => typeof counts[band] === 'number' && (band !== 'ON_HOLD' || (counts[band] ?? 0) > 0),
  );
  if (bands.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t.stageChipsLabel}
      title={t.stageChipsHint}
      data-testid="dashboard-stage-chips"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}
    >
      {bands.map((band, index) => {
        const on = selected === band;
        const value = counts[band] ?? 0;
        const label = `${stageName(band)} ${value}곳`;
        if (band === 'ON_HOLD') {
          return (
            <span key={band} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span aria-hidden="true" style={{ color: colors.textSecondary }}>
                ·
              </span>
              <button
                type="button"
                aria-pressed={on}
                aria-label={label}
                onClick={() => onSelect(on ? null : band)}
                data-testid={`dashboard-stage-chip-${band}`}
                style={{
                  cursor: 'pointer',
                  border: `1px solid ${colors.border}`,
                  boxShadow: on ? `inset 0 0 0 1px ${colors.text}` : 'none',
                  borderRadius: 10,
                  background: colors.bgContainer,
                  padding: '2px 6px',
                  fontSize: typography.fontSizeSecondary - 1,
                  color: colors.textSecondary,
                }}
              >
                {label}
              </button>
            </span>
          );
        }
        return (
          <span key={band} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                data-testid="dashboard-stage-arrow"
                style={{ color: colors.textSecondary, fontSize: 12 }}
              >
                →
              </span>
            ) : null}
            <button
              type="button"
              aria-pressed={on}
              aria-label={label}
              onClick={() => onSelect(on ? null : band)}
              data-testid={`dashboard-stage-chip-${band}`}
              style={{
                cursor: 'pointer',
                display: 'grid',
                justifyItems: 'center',
                gap: 0,
                minWidth: 64,
                padding: '3px 10px',
                // #925: 흐린 바탕에서도 칸이 분명하게 — 모든 칸에 회색 테두리, 회사가 있는 칸은 진한 연두.
                // 고른 칸은 테두리 안쪽에 한 줄을 더해 두껍게(칸 크기는 그대로).
                border: `1px solid ${on ? colors.text : colors.border}`,
                boxShadow: on ? `inset 0 0 0 1px ${colors.text}` : 'none',
                borderRadius: 10,
                background: value > 0 ? detailTheme.accentLine : colors.bgContainer,
                color: colors.text,
                lineHeight: 1.25,
              }}
            >
              <span style={{ fontSize: 11, color: colors.textSecondary }}>{stageName(band)}</span>
              <span>
                <b style={{ fontSize: 16 }}>{value}</b>
                <span style={{ fontSize: 11, marginLeft: 1 }}>곳</span>
              </span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
