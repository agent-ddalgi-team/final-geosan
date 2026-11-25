// #921(PM 결정 2026-11-25): 영업 홈 맨 위 한 줄의 작은 영업 단계 칩.
//   미접촉 12 → 접촉 5 → 견적·샘플 2 → 성사 1 · 보류 3
// 숫자는 서버 집계(counts)를 그대로 쓰고, 서버가 주지 않은 칸은 0으로 지어내지 않고 뺀다.
// 칩을 누르면 아래 "진행 중인 회사" 표가 그 단계로 걸러진다(다시 누르면 풀림). 예전 큰 띠(#766)를 대신한다.
import type { DashboardCounts, ProgressBandKey } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';

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
        const won = band === 'WON';
        const hold = band === 'ON_HOLD';
        return (
          <span key={band} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {index > 0 ? (
              <span aria-hidden="true" style={{ color: colors.textSecondary }}>
                {hold ? '·' : '→'}
              </span>
            ) : null}
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? null : band)}
              data-testid={`dashboard-stage-chip-${band}`}
              style={{
                cursor: 'pointer',
                border: `1px solid ${on ? colors.text : colors.borderSecondary}`,
                borderRadius: 999,
                padding: '2px 10px',
                fontSize: typography.fontSizeSecondary,
                background: won ? statusPalette.ok.bg : colors.bgContainer,
                color: hold ? colors.textSecondary : won ? statusPalette.ok.fg : colors.text,
                fontWeight: on ? 700 : 400,
              }}
            >
              {stageName(band)} <b>{counts[band]}</b>
            </button>
          </span>
        );
      })}
    </div>
  );
}
