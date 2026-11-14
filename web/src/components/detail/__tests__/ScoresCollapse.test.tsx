// 상세 "3. 점수 자세히 보기" 점수표(#611): 계산은 그대로 두고 8항목을 다섯 묶음으로 묶어 보이기만 한다.
// 가짜 응답(A정밀 예시 파일)으로만 확인한다. 서버·DB는 쓰지 않는다.
import { render, screen, within } from '@testing-library/react';
import type { ScoreItemView, Scores } from '../../../api/types';
import { scoreGroups } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import ScoresCollapse from '../ScoresCollapse';
import { groupScoreItems } from '../scoreGroups';

const apjeong = detailFixture.data.scores as Scores;

function renderOpen(scores: Scores) {
  render(<ScoresCollapse scores={scores} open />);
  return screen.getByTestId('score-items-table');
}

/** 묶음 제목 줄의 글자를 화면 순서대로. */
function groupHeads(): string[] {
  return screen.getAllByTestId('score-group-row').map((row) => row.textContent ?? '');
}

/** 묶음 하나(tbody) 안의 항목 줄. */
function rowsOf(groupKey: string): HTMLElement[] {
  const body = screen.getByTestId(`score-group-${groupKey}`);
  return within(body).queryAllByTestId('score-item-row');
}

describe('상세 점수표 다섯 묶음(#611)', () => {
  it('Given A정밀 점수 8항목 When 점수표를 펼치면 Then 다섯 묶음 제목이 ①→⑤ 순서로 보인다', () => {
    renderOpen(apjeong);
    const heads = groupHeads();
    expect(heads).toHaveLength(5);
    expect(heads[0]).toContain('① 공정이 맞나');
    expect(heads[1]).toContain('② 외주를 줄까');
    expect(heads[2]).toContain('③ 가까운가');
    expect(heads[3]).toContain('④ 얼마나 잘 맞나');
    expect(heads[4]).toContain('⑤ 지금 살 사람인가');
    expect(screen.queryByTestId('score-group-OTHER')).not.toBeInTheDocument();
  });

  it('Given A정밀 점수 8항목 When 점수표를 펼치면 Then 8항목이 빠짐없이 제 묶음 아래에 보인다', () => {
    renderOpen(apjeong);
    expect(screen.getAllByTestId('score-item-row')).toHaveLength(8);
    const labelsOf = (key: string) =>
      rowsOf(key).map((row) => within(row).getByRole('rowheader').textContent ?? '');
    expect(labelsOf('PROCESS')).toEqual([
      expect.stringContaining('표면처리가 필요한 제품·부품 생산 근거'),
      expect.stringContaining('처리 목적·성능 태그 일치'),
    ]);
    expect(labelsOf('OUTSOURCE')).toEqual([expect.stringContaining('구매·외주 의향')]);
    expect(labelsOf('DISTANCE')).toEqual([]);
    expect(labelsOf('FIT')).toEqual([
      expect.stringContaining('소재와 보유 공정 일치'),
      expect.stringContaining('유사 산업·부품 납품실적'),
    ]);
    expect(labelsOf('TIMING')).toEqual([
      expect.stringContaining('공장 증설·신규 생산라인'),
      expect.stringContaining('신규 수주·제품 출시·사업 확대'),
      expect.stringContaining('관심'),
    ]);
  });

  it('Given 거리는 점수 항목이 아님 When 점수표를 펼치면 Then "③ 가까운가" 아래에 점수에 넣지 않는다는 안내 한 줄만 보인다', () => {
    renderOpen(apjeong);
    const body = screen.getByTestId('score-group-DISTANCE');
    expect(within(body).getByTestId('score-group-note')).toHaveTextContent(
      scoreGroups.distanceNote,
    );
    // 점수가 없는 묶음이라 제목 줄에 소계 숫자를 붙이지 않는다.
    expect(within(body).getByTestId('score-group-row')).toHaveTextContent(/^③ 가까운가$/);
  });

  it('Given A정밀 점수(E 77) When 점수표를 펼치면 Then 묶음 소계가 "점수/배점"으로 보이고 소계의 합은 총점 77과 같다', () => {
    renderOpen(apjeong);
    const heads = groupHeads();
    expect(heads[0]).toBe('① 공정이 맞나 · 30/35');
    expect(heads[1]).toBe('② 외주를 줄까 · 7/7');
    expect(heads[3]).toBe('④ 얼마나 잘 맞나 · 30/35');
    expect(heads[4]).toBe('⑤ 지금 살 사람인가 · 10/23');
    const sum = heads
      .map((head) => / · (\d+(?:\.\d+)?)\/\d+$/.exec(head))
      .reduce((total, match) => total + (match ? Number(match[1]) : 0), 0);
    expect(sum).toBe(apjeong.E);
    expect(sum).toBe(77);
  });

  it('Given 항목 점수의 합이 서버 총점과 다름 When 점수표를 펼치면 Then 소계를 보이지 않고 항목 줄만 묶는다', () => {
    renderOpen({ ...apjeong, E: 76 });
    expect(groupHeads()).toEqual([
      '① 공정이 맞나',
      '② 외주를 줄까',
      '③ 가까운가',
      '④ 얼마나 잘 맞나',
      '⑤ 지금 살 사람인가',
    ]);
    expect(screen.getAllByTestId('score-item-row')).toHaveLength(8);
  });

  it('Given A정밀 점수 When 점수표를 펼치면 Then 총점·항목 점수·값 없는 칸의 글자는 전과 같다', () => {
    renderOpen(apjeong);
    expect(screen.getByTestId('score-e')).toHaveTextContent('77');
    expect(screen.getByTestId('score-p')).toHaveTextContent('95');
    expect(screen.getByTestId('score-s')).toHaveTextContent('81.1');
    expect(screen.getByTestId('score-r')).toHaveTextContent('82');
    const cellsOf = (label: string) => {
      const row = screen
        .getAllByTestId('score-item-row')
        .find((candidate) => candidate.textContent?.includes(label));
      return within(row as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    };
    // 배점 · 평가 기준 적합도 · 근거 확인 수준 · 최신성 반영계수 · 점수 · 상태
    expect(cellsOf('유사 산업·부품 납품실적')).toEqual(['15', '67%', '100%', '100%', '10', '확인']);
    expect(cellsOf('신규 수주·제품 출시·사업 확대')).toEqual([
      '8',
      '--',
      '--',
      '--',
      '0',
      '신호 없음',
    ]);
    // 값이 없는 칸은 전처럼 "--"와 "자료 미확보"로 보인다.
    expect(cellsOf('관심')).toEqual(['5', '--', '--', '--', '--', '자료 미확보']);
  });

  it('Given 대응표에 없는 항목 코드가 섞여 옴 When 점수표를 펼치면 Then 그 항목은 사라지지 않고 맨 아래 "그 밖" 묶음에 보인다', () => {
    const extra: ScoreItemView = {
      itemCode: 'NEW_SOMETHING',
      label: '새로 생긴 항목',
      state: 'CONFIRMED',
      weight: 3,
      matchRate: 1,
      certainty: 1,
      decay: 1,
      score: 3,
    };
    renderOpen({ ...apjeong, E: 80, items: [...apjeong.items, extra] });
    const heads = groupHeads();
    expect(heads).toHaveLength(6);
    expect(heads[5]).toBe('그 밖 · 3/3');
    expect(rowsOf('OTHER')).toHaveLength(1);
    expect(rowsOf('OTHER')[0]).toHaveTextContent('새로 생긴 항목');
    expect(screen.getAllByTestId('score-item-row')).toHaveLength(9);
  });

  it('Given 아는 항목 코드가 하나도 없음(다른 점수 틀) When 점수표를 펼치면 Then 묶지 않고 전처럼 항목 줄만 보인다', () => {
    const items = apjeong.items.map((item, index) => ({ ...item, itemCode: `RE_${index}` }));
    renderOpen({ ...apjeong, items });
    expect(screen.queryByTestId('score-group-row')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('score-item-row')).toHaveLength(8);
  });

  it('Given 점수 항목 목록 When 묶음으로 나누면 Then 받은 순서를 묶음 안에서 지키고 소계는 항목 점수·배점을 더한 값이다', () => {
    const { grouped, groups } = groupScoreItems(apjeong.items);
    expect(grouped).toBe(true);
    expect(groups.map((group) => group.key)).toEqual([
      'PROCESS',
      'OUTSOURCE',
      'DISTANCE',
      'FIT',
      'TIMING',
    ]);
    expect(groups.map((group) => group.items.map((item) => item.itemCode))).toEqual([
      ['NEW_PRODUCT', 'NEW_PERF'],
      ['SIG_BID'],
      [],
      ['NEW_MATERIAL', 'NEW_RECORD'],
      ['SIG_EXPAND', 'SIG_ORDER', 'SIG_HIRE'],
    ]);
    expect(groups.map((group) => [group.score, group.weight])).toEqual([
      [30, 35],
      [7, 7],
      [0, 0],
      [30, 35],
      [10, 23],
    ]);
  });
});
