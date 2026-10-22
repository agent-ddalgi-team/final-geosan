// 색 + 글자 태그. 색은 theme/tokens.ts의 6가지 조합(statusPalette)만 쓴다(접근성 A3·A19).
// 색은 보조 신호이고 글자가 항상 함께 있다. 아이콘 글자(✔ ⏳ ? → ✕)는 선택.
import type { ReactNode } from 'react';
import { statusPalette, typography } from '../../theme/tokens';
import type { StatusTone } from '../../theme/tokens';

export interface StatusTagProps {
  tone: StatusTone;
  children: ReactNode;
  icon?: string;
  bold?: boolean;
  'data-testid'?: string;
}

export default function StatusTag({
  tone,
  children,
  icon,
  bold,
  'data-testid': testId,
}: StatusTagProps) {
  const palette = statusPalette[tone];
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      style={{
        display: 'inline-block',
        padding: '2px 12px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        fontSize: typography.fontSizeSecondary,
        fontWeight: bold ? 700 : 400,
        lineHeight: 1.6,
      }}
    >
      {icon ? <span aria-hidden="true">{icon} </span> : null}
      {children}
    </span>
  );
}
