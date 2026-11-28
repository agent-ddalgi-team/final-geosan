// #996(PM 결정 2026-11-29): 기업 상세 둘째 줄(영업 단계 | 담당자 연락처)과 셋째 줄(한눈에 + 왜 이 회사인가 | 기록)의 격자 값.
// 비율이 1.25 : 1이고, 늘어나는 비율과 처음 폭의 비가 같아야 두 줄의 칸 경계가 어느 폭에서나 같은 자리에 선다.
import { detailLayout, spacing } from '../../../theme/tokens';
import { detailMainCell, detailRowStyle, detailSideCell } from '../detailGrid';

describe('기업 상세 격자 값 (#996)', () => {
  it('왼쪽 : 오른쪽 비율은 1.25 : 1이다', () => {
    expect(detailLayout.mainGrow / detailLayout.sideGrow).toBe(1.25);
    expect(detailMainCell.flex).toBe(`1.25 1 ${detailLayout.mainBasis}px`);
    expect(detailSideCell.flex).toBe(`1 1 ${detailLayout.sideBasis}px`);
  });

  it('처음 폭의 비도 1.25 : 1이라, 남는 폭을 나눈 뒤에도 두 칸의 폭 비가 1.25 : 1로 유지된다', () => {
    expect(detailLayout.mainBasis / detailLayout.sideBasis).toBe(1.25);
    // 본문 폭이 얼마든 왼쪽 칸 폭 = 오른쪽 칸 폭 × 1.25다(줄마다 같은 계산이라 칸 경계가 같은 자리다).
    for (const width of [720, 801, 1100, 1400]) {
      const free = width - spacing.cardGap - detailLayout.mainBasis - detailLayout.sideBasis;
      const total = detailLayout.mainGrow + detailLayout.sideGrow;
      const main = detailLayout.mainBasis + (free * detailLayout.mainGrow) / total;
      const side = detailLayout.sideBasis + (free * detailLayout.sideGrow) / total;
      expect(main / side).toBeCloseTo(1.25, 10);
      expect(main + side + spacing.cardGap).toBeCloseTo(width, 10);
    }
  });

  it('좁으면 줄이 바뀌어 한 칸씩 쌓이고, 줄 안의 칸은 높이를 맞춘다', () => {
    expect(detailRowStyle).toMatchObject({
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      gap: spacing.cardGap,
    });
    expect(detailMainCell.minWidth).toBe(0);
    expect(detailSideCell.minWidth).toBe(0);
  });
});
