// 영업 분석 그래프(#760): 숫자 칸·막대·도넛·가로 막대가 서버 숫자 그대로 보이는지 글자로 확인한다(색은 보지 않는다).
import { render, screen, within } from '@testing-library/react';
import AnalysisCharts, { countTicks } from '../AnalysisCharts';
import { SAMPLE, sampleStats } from '../../../test/analysisSample';

describe('AnalysisCharts', () => {
  it('숫자 칸 4개: 접촉한 회사(성사율), 진행 중(보류), 성사(평균 접촉), 거절(가장 많은 이유)', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    expect(screen.getByTestId('kpi-contacted-value')).toHaveTextContent('12');
    expect(screen.getByTestId('kpi-contacted-sub')).toHaveTextContent('성사율 17%');
    expect(screen.getByTestId('kpi-in-progress-value')).toHaveTextContent('6');
    expect(screen.getByTestId('kpi-in-progress-sub')).toHaveTextContent('보류 1곳');
    expect(screen.getByTestId('kpi-won-sub')).toHaveTextContent('성사까지 평균 3.5번 접촉');
    expect(screen.getByTestId('kpi-lost-value')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-lost-sub')).toHaveTextContent('가장 많은 이유: 가격 2곳');
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
