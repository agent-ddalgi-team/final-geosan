// 기업 상세 "한눈에 + 왜 이 회사인가" 한 블록 안의 큰 제목(#996, PM 결정 2026-11-29).
// 왼쪽 세로 강조 막대 + 제목(h2) + 흐린 보조 설명 한 줄. 막대는 꾸밈이라 화면 낭독기에 숨긴다.
import type { ReactNode } from 'react';
import { colors, detailLayout } from '../../theme/tokens';

export interface BlockHeadingProps {
  /** 제목(h2)의 id. 구역(section)의 aria-labelledby가 가리킨다. */
  id: string;
  title: string;
  hint?: ReactNode;
}

export default function BlockHeading({ id, title, hint }: BlockHeadingProps) {
  return (
    <div
      data-testid="block-heading"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}
    >
      <span
        aria-hidden="true"
        data-testid="block-heading-bar"
        style={{
          width: 4,
          height: 18,
          borderRadius: 2,
          background: detailLayout.blockBar,
          alignSelf: 'center',
          flex: 'none',
        }}
      />
      <h2 id={id} style={{ margin: 0, fontSize: detailLayout.blockTitleSize, fontWeight: 700 }}>
        {title}
      </h2>
      {hint ? (
        <span style={{ color: colors.textDimmed, fontSize: detailLayout.smallFont }}>{hint}</span>
      ) : null}
    </div>
  );
}
