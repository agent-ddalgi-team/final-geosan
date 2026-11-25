// #921(PM 결정 2026-11-25): 영업 홈 칸 제목 앞의 작은 표시 "출근하면 · 외근 전 · 누가 봐도".
// 언제 보는 칸인지 먼저 읽히게 한다. 색은 보조이고 글자가 늘 함께 있다.
import { statusPalette, typography } from '../../theme/tokens';

const TONES = {
  work: statusPalette.ask,
  out: statusPalette.ok,
  anyone: statusPalette.recheck,
} as const;

export default function WhenBadge({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: string;
}) {
  const palette = TONES[tone];
  return (
    <span
      data-testid={`dashboard-when-${tone}`}
      style={{
        display: 'inline-block',
        marginRight: 8,
        padding: '1px 10px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        fontSize: typography.fontSizeSecondary - 1,
        fontWeight: 700,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}
