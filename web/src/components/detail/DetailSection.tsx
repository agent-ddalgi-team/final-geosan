// 상세 화면의 영역 틀: 제목은 h2(번호 영역 안은 h3), 흰 바탕 상자. 접근성 S2-1.
import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { colors, spacing, typography } from '../../theme/tokens';

export interface DetailSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

export default function DetailSection({ id, title, children }: DetailSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={id}
      style={{
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 8,
        padding: spacing.cardPadding,
        display: 'grid',
        gap: 12,
      }}
    >
      <Typography.Title
        level={2}
        id={headingId}
        style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
      >
        {title}
      </Typography.Title>
      {children}
    </section>
  );
}
