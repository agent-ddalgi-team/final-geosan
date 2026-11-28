// 기업 상세 둘째 줄(영업 단계 | 담당자 연락처)과 셋째 줄(한눈에 + 왜 이 회사인가 | 기록)이 함께 쓰는 격자(#996).
// 두 줄이 같은 값(비율 1.25 : 1, 같은 처음 폭 · 같은 틈)을 쓰므로 칸 경계(세로선)가 같은 자리에 선다.
// 본문이 좁으면(두 처음 폭 + 틈보다 좁으면) 오른쪽 칸이 아래로 내려가 한 줄로 쌓인다(미디어 쿼리 없이 본문 폭 기준).
import type { CSSProperties } from 'react';
import { detailLayout, spacing } from '../../theme/tokens';

/** 줄 하나: 왼쪽 큰 칸 + 오른쪽 작은 칸. */
export const detailRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'stretch',
  gap: spacing.cardGap,
};

/** 왼쪽 큰 칸(영업 단계 · 한눈에 + 왜 이 회사인가). 안의 카드가 칸 높이를 다 쓰게 한다. */
export const detailMainCell: CSSProperties = {
  flex: `${detailLayout.mainGrow} 1 ${detailLayout.mainBasis}px`,
  minWidth: 0,
  display: 'grid',
};

/** 오른쪽 작은 칸(담당자 연락처 · 기록). */
export const detailSideCell: CSSProperties = {
  flex: `${detailLayout.sideGrow} 1 ${detailLayout.sideBasis}px`,
  minWidth: 0,
  display: 'grid',
};
