// 상세 화면의 영역 틀: 제목은 h2(번호 영역 안은 h3), 흰 바탕 상자. 접근성 S2-1.
// #759(PM 2026-11-15): 얇은 회색 테두리·덜 둥근 모서리, 제목 옆에 연두 숫자 꼬리표(예: "확인할 것 3").
// 색은 숫자 꼬리표에만 쓴다. 숫자를 주지 않으면 꼬리표가 없다.
// #972 새 시안: 숫자 꼬리표는 강조 조금 진한 연한 바탕 + 강조 글자, 모서리 6(알약 모양 아님).
// 제목 옆에 보조 설명(흐린 글자 한 줄)이나 오른쪽 끝 단추를 둘 수 있다.
import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { accent, colors, detailTheme, radius, spacing, typography } from '../../theme/tokens';

export interface DetailSectionProps {
  id: string;
  title: string;
  /** 제목 옆 숫자 꼬리표. 0도 보인다. 주지 않으면 꼬리표가 없다. */
  count?: number | null;
  /** 제목 옆 보조 설명(#972, 선택). 예: "항목마다 한 줄". */
  hint?: ReactNode;
  /**
   * 테두리·바탕·안쪽 여백 없이 제목과 내용만 그린다(#972, 선택). 이미 카드 안에 있는 칸
   * (오른쪽 영업 코치 칸의 "확인사항")에서 카드가 겹쳐 보이지 않게 할 때 쓴다.
   */
  bare?: boolean;
  children: ReactNode;
}

export default function DetailSection({
  id,
  title,
  count,
  hint,
  bare = false,
  children,
}: DetailSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={id}
      style={
        bare
          ? { display: 'grid', gap: 10 }
          : {
              background: colors.bgContainer,
              border: `1px solid ${detailTheme.border}`,
              borderRadius: detailTheme.radius,
              padding: spacing.cardPadding,
              display: 'grid',
              gap: 12,
            }
      }
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
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
              minWidth: 32,
              height: 26,
              padding: '0 9px',
              boxSizing: 'border-box',
              borderRadius: radius.tag,
              background: detailTheme.accent,
              color: accent.text,
              fontSize: typography.fontSizeSecondary,
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        ) : null}
        {hint ? (
          <span
            data-testid={`${id}-hint`}
            style={{ color: colors.textDimmed, fontSize: typography.fontSizeSecondary }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
