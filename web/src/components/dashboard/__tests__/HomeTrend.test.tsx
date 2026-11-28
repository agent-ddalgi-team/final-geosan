// 영업 홈 "월별 접촉 추세" 카드(#972): 영업 분석의 월별 추세 응답·그림 부품을 그대로 쓰고, 못 읽으면 이 칸만 숨는다.
// getSalesAnalysis는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 숫자는 가상이다.
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeTrend from '../HomeTrend';
import { getSalesAnalysis } from '../../../api/salesAnalysis';
import type { SalesAnalysis } from '../../../api/salesAnalysis';
import { ApiError } from '../../../api/client';
import { TREND_HEIGHT_SHORT } from '../../analysis/MonthlyTrend';
import { dashboardTexts } from '../../../labels/ko';

vi.mock('../../../api/salesAnalysis', () => ({ getSalesAnalysis: vi.fn() }));
const mockedGet = vi.mocked(getSalesAnalysis);

const months = Array.from({ length: 12 }, (_, index) => {
  const month = ((index + 11) % 12) + 1;
  const year = month === 12 ? 2025 : 2026;
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    contacted: month === 11 ? 8 : month === 10 ? 11 : 0,
    won: month === 11 ? 1 : 0,
    lost: 0,
  };
});

function reply(data: Partial<SalesAnalysis>) {
  return { data: data as SalesAnalysis, meta: { hasVirtualData: true } } as Awaited<
    ReturnType<typeof getSalesAnalysis>
  >;
}

function renderCard() {
  return render(
    <MemoryRouter>
      <HomeTrend />
    </MemoryRouter>,
  );
}

/** 요청이 끝나 화면이 더 바뀌지 않을 때까지 기다린다. */
async function settled() {
  await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
  await Promise.resolve();
}

beforeEach(() => {
  mockedGet.mockReset();
});

it('큰 숫자 "접촉 기록이 있는 회사 n곳"과 [영업 분석 보기] 링크, 영업 분석과 같은 월별 그림을 한 카드에 보인다', async () => {
  mockedGet.mockResolvedValueOnce(
    reply({ monthly: months, total: { contactedCount: 18 } as SalesAnalysis['total'] }),
  );
  renderCard();
  const card = await screen.findByTestId('dashboard-trend');
  expect(
    within(card).getByRole('heading', { level: 2, name: dashboardTexts.trendTitle }),
  ).toBeVisible();
  expect(within(card).getByTestId('dashboard-trend-count')).toHaveTextContent(
    '18곳접촉 기록이 있는 회사',
  );
  expect(within(card).getByTestId('dashboard-trend-link')).toHaveAttribute(
    'href',
    '/sales-analysis',
  );
  expect(within(card).getByTestId('dashboard-trend-link')).toHaveTextContent('영업 분석 보기');
  // 그림은 영업 분석의 월별 추세 부품 그대로(같은 testid). 이 카드 안에서는 자기 테두리 없이 들어간다.
  const chart = within(card).getByTestId('monthly-trend');
  expect(chart.querySelector('[data-embedded="true"]')).not.toBeNull();
  // 기간 없이(최근 12개월 값은 기간과 상관없다) 한 번만 부른다.
  expect(mockedGet).toHaveBeenCalledTimes(1);
  expect(mockedGet.mock.calls[0][1]).toBeUndefined();
});

it('응답을 못 읽으면 오류를 띄우지 않고 이 칸만 그리지 않는다', async () => {
  mockedGet.mockRejectedValueOnce(
    new ApiError(500, { message: '문제', nextAction: '다시', ref: 'r-1', kind: 'INTERNAL_ERROR' }),
  );
  const { container } = renderCard();
  await settled();
  expect(screen.queryByTestId('dashboard-trend')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(container).toBeEmptyDOMElement();
});

it('옛 서버라 월별 값이 없거나 빈 목록이면 이 칸을 그리지 않는다', async () => {
  mockedGet.mockResolvedValueOnce(
    reply({ total: { contactedCount: 3 } as SalesAnalysis['total'] }),
  );
  const first = renderCard();
  await settled();
  expect(screen.queryByTestId('dashboard-trend')).not.toBeInTheDocument();
  first.unmount();

  mockedGet.mockReset();
  mockedGet.mockResolvedValueOnce(
    reply({ monthly: [], total: { contactedCount: 3 } as SalesAnalysis['total'] }),
  );
  renderCard();
  await settled();
  expect(screen.queryByTestId('dashboard-trend')).not.toBeInTheDocument();
});

it('합계가 응답에 없으면 큰 숫자를 0으로 지어내지 않고 그림만 보인다', async () => {
  mockedGet.mockResolvedValueOnce(reply({ monthly: months }));
  renderCard();
  const card = await screen.findByTestId('dashboard-trend');
  expect(within(card).queryByTestId('dashboard-trend-count')).not.toBeInTheDocument();
  expect(within(card).getByTestId('monthly-trend')).toBeInTheDocument();
});

it('불러오는 동안에는 빈 카드나 자리표시를 보이지 않는다', () => {
  mockedGet.mockReturnValueOnce(new Promise(() => {}));
  const { container } = renderCard();
  expect(container).toBeEmptyDOMElement();
});

it('#983: 영업 홈의 그림은 영업 분석(170)의 절반쯤 높이로 그린다(같은 응답 · 같은 선)', async () => {
  mockedGet.mockResolvedValueOnce(
    reply({ monthly: months, total: { contactedCount: 12 } } as never),
  );
  renderCard();
  const card = await screen.findByTestId('dashboard-trend');
  expect(within(card).getByTestId('monthly-trend-line').style.height).toBe(
    `${TREND_HEIGHT_SHORT}px`,
  );
  expect(within(card).getAllByTestId('monthly-trend-month')).toHaveLength(12);
});
