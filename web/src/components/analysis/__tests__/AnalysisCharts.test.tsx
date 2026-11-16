// 영업 분석 그래프(#760): 숫자 칸·막대·도넛·가로 막대가 서버 숫자 그대로 보이는지 글자로 확인한다(색은 보지 않는다).
import { render, screen, within } from '@testing-library/react';
import AnalysisCharts, { countTicks, processLabelLines } from '../AnalysisCharts';
import { SAMPLE, sampleStats } from '../../../test/analysisSample';

describe('AnalysisCharts', () => {
  it('숫자 칸 5개: 접촉한 회사(성사율), 진행 중(보류), 완료(성사·거절), 성사(평균 접촉), 거절(가장 많은 이유)', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    expect(screen.getByTestId('kpi-contacted-value')).toHaveTextContent('12');
    expect(screen.getByTestId('kpi-contacted-sub')).toHaveTextContent('성사율 17%');
    expect(screen.getByTestId('kpi-in-progress-value')).toHaveTextContent('6');
    expect(screen.getByTestId('kpi-in-progress-sub')).toHaveTextContent('보류 1곳');
    expect(screen.getByTestId('kpi-won-sub')).toHaveTextContent('성사까지 평균 3.5번 접촉');
    expect(screen.getByTestId('kpi-lost-value')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-lost-sub')).toHaveTextContent('가장 많은 이유: 가격 2곳');
    // 완료 = 성사 2 + 거절 3(대시보드에서 옮겨 온 숫자).
    expect(screen.getByTestId('kpi-done-value')).toHaveTextContent('5');
    expect(screen.getByTestId('kpi-done-sub')).toHaveTextContent('성사 2곳 · 거절 3곳');
  });

  it('숫자 칸은 왼쪽 큰 칸 + 오른쪽 2×2로 놓여, 본문이 좁아도 거절 칸만 아래로 떨어지지 않는다', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    expect(screen.getByTestId('analysis-kpis').style.gridTemplateColumns).toBe(
      'minmax(0, 1.2fr) repeat(2, minmax(0, 1fr))',
    );
    expect(screen.getByTestId('kpi-contacted').style.gridRow).toBe('span 2');
    expect(screen.getByTestId('kpi-lost').style.gridRow).toBe('');
  });

  it('공정 이름: 괄호 앞은 첫째 줄, 괄호 부분은 둘째 줄이고 들어가는 글자 수를 넘을 때만 자른다 (#787)', () => {
    expect(processLabelLines('아연도금(전기아연도금)', 12)).toEqual(['아연도금', '(전기아연도금)']);
    expect(processLabelLines('알카리 흑착(흑색산화피막)', 12)).toEqual([
      '알카리 흑착',
      '(흑색산화피막)',
    ]);
    expect(processLabelLines('부동태', 12)).toEqual(['부동태']);
    // 공정이 많아 묶음이 좁으면 그 줄만 자른다.
    expect(processLabelLines('아연도금(전기아연도금)', 5)).toEqual(['아연도금', '(전기아…']);
  });

  it('공정이 둘이면 이름을 자르지 않고 그대로 보인다 (#787)', () => {
    render(
      <AnalysisCharts
        data={{
          ...SAMPLE,
          byProcess: SAMPLE.byProcess.map((row, i) =>
            i === 0 ? { ...row, processName: '아연도금(전기아연도금)' } : row,
          ),
        }}
      />,
    );
    const labels = within(screen.getByTestId('chart-process'))
      .getAllByTestId('chart-process-label')
      .map((el) => el.firstChild?.textContent);
    expect(labels).toEqual(['아연도금', '(전기아연도금)', '아노다이징']);
  });

  it('아래 카드 셋은 줄바꿈 칸에 놓여, 두 칸 폭이면 혼자 남은 카드가 줄 전체를 쓴다 (#787)', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    const row = screen.getByTestId('analysis-bar-cards');
    expect(row.style.flexWrap).toBe('wrap');
    const cells = Array.from(row.children) as HTMLElement[];
    expect(cells).toHaveLength(3);
    cells.forEach((cell) => expect(cell.style.flex).toBe('1 1 280px'));
  });

  it('표본이 기준보다 적으면 비율을 지어내지 않고 "표본 n곳"만 보인다', () => {
    render(
      <AnalysisCharts
        data={{
          ...SAMPLE,
          total: sampleStats({ contactedCount: 3, ratios: null, lostReasons: [] }),
        }}
      />,
    );
    expect(screen.getByTestId('kpi-contacted-sub')).toHaveTextContent('표본 3곳 · 비율은 10곳부터');
    expect(screen.queryByTestId('kpi-lost-sub')).not.toBeInTheDocument();
  });

  it('공정별 막대는 공정마다 접촉·성사 두 개이고, 읽는 글에 값이 다 있다', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    expect(screen.getAllByTestId('chart-process-group')).toHaveLength(2);
    const chart = within(screen.getByTestId('chart-process')).getByRole('img');
    expect(chart).toHaveAccessibleName(
      '아연도금 접촉한 회사 8곳 성사 2곳, 아노다이징 접촉한 회사 4곳 성사 0곳',
    );
  });

  it('도넛은 가운데에 합계, 범례에 곳 수와 비율을 보인다', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    expect(screen.getByTestId('chart-donut-total')).toHaveTextContent('12');
    expect(screen.getByTestId('chart-donut-legend-inProgress')).toHaveTextContent('진행 중6곳50%');
    expect(screen.getByTestId('chart-donut-legend-lost')).toHaveTextContent('거절3곳25%');
    // 0곳인 조각은 그리지 않는다.
    render(
      <AnalysisCharts
        data={{ ...SAMPLE, total: sampleStats({ onHoldCount: 0, contactedCount: 11 }) }}
      />,
    );
    expect(screen.getAllByTestId('chart-donut-hold')).toHaveLength(1);
  });

  it('세부 단계·연락 방법·거절 이유 가로 막대는 이름과 값을 글로 보인다(시도가 없는 방법은 뺀다)', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    const steps = screen.getAllByTestId('chart-steps-row');
    expect(steps.map((row) => row.textContent)).toEqual([
      '연결 전 (9번)',
      '연결됨 (5번)이른 회사 7곳',
    ]);
    const methods = screen.getAllByTestId('chart-methods-row');
    expect(methods.map((row) => row.textContent)).toEqual([
      '전화 (연결 6 / 시도 10)',
      '메일 (연결 1 / 시도 4)',
    ]);
    const lost = screen.getAllByTestId('chart-lost-row');
    expect(lost.map((row) => row.textContent)).toEqual(['가격 (2곳)', '기존 거래처 유지 (1곳)']);
  });

  it('기록이 없으면 그래프마다 "아직 셀 기록이 없습니다"', () => {
    render(
      <AnalysisCharts
        data={{
          ...SAMPLE,
          byProcess: [],
          bySalesStep: [],
          total: sampleStats({
            contactedCount: 0,
            inProgressCount: 0,
            onHoldCount: 0,
            wonCount: 0,
            lostCount: 0,
            avgContactsToWon: null,
            ratios: null,
            lostReasons: [],
            contactReach: {
              CALL: { reached: 0, tried: 0 },
              EMAIL: { reached: 0, tried: 0 },
              VISIT: { reached: 0, tried: 0 },
            },
          }),
        }}
      />,
    );
    expect(screen.getAllByText('아직 셀 기록이 없습니다.')).toHaveLength(4);
    expect(screen.getByTestId('chart-donut-total')).toHaveTextContent('0');
  });

  it('곳 수 눈금은 정수 간격이다(소수 눈금 없음)', () => {
    expect(countTicks(0)).toEqual([0, 1]);
    expect(countTicks(3)).toEqual([0, 1, 2, 3]);
    expect(countTicks(6)).toEqual([0, 2, 4, 6]);
    expect(countTicks(18)).toEqual([0, 5, 10, 15, 20]);
    expect(countTicks(130)).toEqual([0, 50, 100, 150]);
  });
});
