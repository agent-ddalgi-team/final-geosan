// 돈이 드는 단추(💰) 옆의 이번 달 AI 사용액 한 줄(#549 ③). [다시 조사]·[붙여넣고 조사] 옆에 보인다.
// 서버 호출(getMonthSpend)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import MonthSpendLine from '../MonthSpendLine';
import HomepageControls from '../../detail/HomepageControls';
import { ApiError, getMonthSpend } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';
import { homepageControls, reviewArea, usdText } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getMonthSpend: vi.fn(),
}));

const mockedMonth = vi.mocked(getMonthSpend);

beforeEach(() => {
  mockedMonth.mockReset();
});

describe('이번 달 AI 사용액 줄 (#549)', () => {
  it('서버가 준 이번 달 사용액과 한도를 그대로 보인다', async () => {
    mockedMonth.mockResolvedValue({
      data: { month: { usedUsd: 3.2, limitUsd: 20, usedCalls: 180, limitCalls: 1000 } },
      meta: {},
    });
    render(<MonthSpendLine />);
    await waitFor(() =>
      expect(screen.getByTestId('month-spend')).toHaveTextContent('이번 달 AI 사용 $3.20 / $20.00'),
    );
  });

  it('못 불러오면 숫자를 지어내지 않고 실패를 알린다', async () => {
    mockedMonth.mockRejectedValue(
      new ApiError(500, { message: '오류', nextAction: '다시 시도', ref: 'r-1' }),
    );
    render(<MonthSpendLine />);
    await waitFor(() =>
      expect(screen.getByTestId('month-spend')).toHaveTextContent(
        '이번 달 AI 사용액을 불러오지 못했습니다',
      ),
    );
  });

  it('[다시 조사 💰] 옆에 이번 달 사용액이 보이고, 담당자를 고르기 전에는 보이지 않는다', async () => {
    mockedMonth.mockResolvedValue({
      data: { month: { usedUsd: 0.74, limitUsd: 20, usedCalls: 12, limitCalls: 1000 } },
      meta: {},
    });
    const frame = (canRecord: boolean) => ({
      config: null,
      staffKey: canRecord ? 'park-lee' : null,
      setStaffKey: () => {},
      canRecord,
      setBannerMeta: () => {},
      setPageTitle: () => {},
    });
    const first = render(
      <FrameContext.Provider value={frame(true)}>
        <HomepageControls oppId="opp-1" onReload={() => {}} />
      </FrameContext.Provider>,
    );
    expect(screen.getByTestId('homepage-rerun-button')).toHaveTextContent('다시 조사 💰');
    await waitFor(() =>
      expect(screen.getByTestId('month-spend')).toHaveTextContent('이번 달 AI 사용 $0.74 / $20.00'),
    );
    first.unmount();
    render(
      <FrameContext.Provider value={frame(false)}>
        <HomepageControls oppId="opp-1" onReload={() => {}} />
      </FrameContext.Provider>,
    );
    expect(screen.queryByTestId('month-spend')).not.toBeInTheDocument();
  });

  it('돈이 드는 단추 이름에는 모두 💰가 붙는다', () => {
    expect(homepageControls.rerunButton).toBe('다시 조사 💰');
    expect(reviewArea.pasteButton).toBe('붙여넣고 조사 💰');
  });

  it('금액은 소수 둘째 자리까지 보이고 1센트보다 작으면 "미만"으로 보인다', () => {
    expect(usdText(0.74)).toBe('$0.74');
    expect(usdText(1234.5)).toBe('$1,234.50');
    expect(usdText(0)).toBe('$0.00');
    expect(usdText(0.004)).toBe('$0.01 미만');
  });
});
