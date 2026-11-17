// 다섯 상태 공통 부품(BR10.7): 비어 있음 / 불러오는 중(5초 안내) / 정상 / 오류(+다시 시도) / 일부.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FiveStates, { SLOW_LOADING_MS } from '../FiveStates';
import { ApiError } from '../../../api/client';
import { states } from '../../../labels/ko';

describe('FiveStates', () => {
  it('비어 있음: 왜 비었는지 문구와 다음 행동 버튼이 보인다', () => {
    render(
      <FiveStates
        state="empty"
        emptyText={states.listEmpty}
        emptyAction={<button type="button">운영 안내서 보기</button>}
      />,
    );
    expect(screen.getByText(states.listEmpty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '운영 안내서 보기' })).toBeInTheDocument();
  });

  it('불러오는 중: 자리표시를 보이고 5초가 지나면 "조금 오래 걸리고 있습니다"를 덧붙인다', () => {
    vi.useFakeTimers();
    try {
      render(<FiveStates state="loading" />);
      expect(screen.getByTestId('five-states-loading')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText(states.loadingSlow)).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(SLOW_LOADING_MS);
      });
      expect(screen.getByText(states.loadingSlow)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('정상: 내용을 그대로 보이고, 일부 알림이 있으면 내용 위에 함께 보인다', () => {
    const { rerender } = render(
      <FiveStates state="ready">
        <p>카드 1건</p>
      </FiveStates>,
    );
    expect(screen.getByText('카드 1건')).toBeInTheDocument();
    expect(screen.queryByTestId('five-states-partial')).not.toBeInTheDocument();
    rerender(
      <FiveStates state="ready" partialNotice="일부 자료를 불러오지 못했습니다.">
        <p>카드 1건</p>
      </FiveStates>,
    );
    expect(screen.getByTestId('five-states-partial')).toHaveTextContent('일부 자료');
    expect(screen.getByText('카드 1건')).toBeInTheDocument();
  });

  it('오류: 쉬운 말 원인과 다음 행동을 보이고 오류 코드는 숨기며 ref는 작게 보인다', () => {
    const error = new ApiError(500, {
      message: '목록을 가져오는 중 문제가 생겼습니다.',
      nextAction: '잠시 뒤 다시 시도해 주세요.',
      ref: 'req-123',
      kind: 'INTERNAL_ERROR',
    });
    render(<FiveStates state="error" errorTitle={states.listError} error={error} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(states.listError);
    expect(alert).toHaveTextContent('목록을 가져오는 중 문제가 생겼습니다.');
    expect(alert).toHaveTextContent('잠시 뒤 다시 시도해 주세요.');
    expect(screen.getByTestId('five-states-ref')).toHaveTextContent('req-123');
    expect(alert).not.toHaveTextContent('INTERNAL_ERROR');
  });

  it('오류: [다시 시도]를 누르면 onRetry가 불린다', async () => {
    const onRetry = vi.fn();
    render(<FiveStates state="error" errorTitle={states.listError} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: states.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
