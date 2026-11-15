// 상세 화면의 영역 틀: 제목은 h2(번호 영역 안은 h3), 흰 바탕 상자. 접근성 S2-1.
// #759(PM 2026-11-15): 얇은 회색 테두리·덜 둥근 모서리, 제목 옆에 연두 숫자 꼬리표(예: "확인할 것 3").
// 색은 숫자 꼬리표에만 쓴다. 숫자를 주지 않으면 꼬리표가 없다.
import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { colors, detailTheme, spacing, typography } from '../../theme/tokens';

export interface DetailSectionProps {
  id: string;
  title: string;
  /** 제목 옆 숫자 꼬리표. 0도 보인다. 주지 않으면 꼬리표가 없다. */
  count?: number | null;
  children: ReactNode;
}

export default function DetailSection({ id, title, count, children }: DetailSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={id}
      style={{
        background: colors.bgContainer,
        border: `1px solid ${detailTheme.border}`,
        borderRadius: detailTheme.radius,
        padding: spacing.cardPadding,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Typography.Title
          level={2}
          id={headingId}
          style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
        >
          {title}
        </Typography.Title>
        {/* 숫자는 제목 글 밖에 둔다(제목을 읽을 때 "확인할 것3"처럼 붙지 않게). */}
        {typeof count === 'number' ? (
          <span
            data-testid={`${id}-count`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 36,
              height: 28,
              padding: '0 10px',
              boxSizing: 'border-box',
              borderRadius: 999,
              background: detailTheme.accent,
              color: colors.text,
              fontSize: typography.fontSizeSecondary,
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
