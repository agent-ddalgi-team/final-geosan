// 분석 그림 틀(#898 → #972): 흰 카드(얇은 테두리, 모서리 12) + 오른쪽 위 숫자 칸(가장 중요한 숫자 하나) +
// 판 아래 요약 문장("이 그림에서 읽을 것"). 요약은 그림과 같은 값으로 화면에서 만든 문장이고 AI를 쓰지 않는다.
// 색은 theme/tokens의 chartTheme만 쓴다.
import type { ReactNode } from 'react';
import { chartTheme, radius, typography } from '../../theme/tokens';

export interface ChartCallout {
  /** 크게 보이는 값. 예: "6곳" */
  value: string;
  /** 값 아래 작은 글. 예: "연결에서 멈춤" */
  label: string;
}

/** 판 위 보조 글자(대비 4.5:1 이상). 그림 부품이 범례·설명 줄에 쓴다. */
export const chartSecondary = {
  color: chartTheme.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;

export function CalloutBubble({ callout, testId }: { callout: ChartCallout; testId: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        flex: 'none',
        display: 'grid',
        gap: 0,
        padding: '8px 16px',
        background: chartTheme.calloutBg,
        borderRadius: radius.control,
        maxWidth: 240,
      }}
    >
      <strong style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.2, color: chartTheme.text }}>
        {callout.value}
      </strong>
      <span
        style={{
          ...chartSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={callout.label}
      >
        {callout.label}
      </span>
    </div>
  );
}

export function ChartSummary({ text, testId }: { text: string; testId: string }) {
  return (
    <p
      data-testid={testId}
      style={{
        margin: '0 8px',
        maxWidth: 760,
        fontSize: 18,
        lineHeight: 1.5,
        color: chartTheme.summaryText,
        wordBreak: 'keep-all',
      }}
    >
      {text}
    </p>
  );
}

export default function ChartFrame({
  id,
  title,
  headingLevel = 2,
  legend,
  callout,
  summary,
  children,
}: {
  id: string;
  title: ReactNode;
  headingLevel?: 2 | 3;
  legend?: ReactNode;
  callout?: ChartCallout | null;
  summary?: string | null;
  children: ReactNode;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={id}
      style={{ display: 'grid', gap: 14, alignContent: 'start', minWidth: 0 }}
    >
      <div
        style={{
          background: chartTheme.cardBg,
          color: chartTheme.text,
          border: `1px solid ${chartTheme.cardBorder}`,
          borderRadius: radius.card,
          padding: 24,
          display: 'grid',
          gap: 16,
          alignContent: 'start',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: '1 1 200px', display: 'grid', gap: 8, minWidth: 0 }}>
            {/* 제목은 줄지 않고, 좁으면 범례가 다음 줄로 내려간다. */}
            <Heading
              id={`${id}-title`}
              style={{ margin: 0, fontSize: 22, fontWeight: 500, lineHeight: 1.3 }}
            >
              {title}
            </Heading>
            {legend}
          </div>
          {callout ? <CalloutBubble callout={callout} testId={`${id}-callout`} /> : null}
        </div>
        {children}
      </div>
      {summary ? <ChartSummary text={summary} testId={`${id}-summary`} /> : null}
    </section>
  );
}
