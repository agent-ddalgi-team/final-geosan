// #847(PM 결정 2026-11-17): 상세 "한눈에 › 공정" 옆 [고치기]. 거산 쪽 확인 질문을 통화에서 묻는 대신 나중에 고친다.
// 서버 호출(postProcesses)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버는 tests/unit/u1/test_process_fix.py).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProcessFix from '../ProcessFix';
import { ApiError, postProcesses } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postProcesses: vi.fn(),
}));

const OPTIONS = [
  { code: 'ZINC_PLATING', name: '아연도금' },
  { code: 'NICKEL_PLATING', name: '니켈도금' },
  { code: 'ANODIZING', name: '아노다이징' },
];

function frame(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config: null,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...overrides,
  };
}

function renderFix(onSaved = vi.fn(), value = frame()) {
  render(
    <FrameContext.Provider value={value}>
      <ProcessFix oppId="opp-1" current={['ZINC_PLATING']} options={OPTIONS} onSaved={onSaved} />
    </FrameContext.Provider>,
  );
  return onSaved;
}

beforeEach(() => {
  vi.mocked(postProcesses).mockReset();
});

describe('상세 › 한눈에 › 공정 [고치기] (#847)', () => {
  it('Given 확정 공정 아연도금 When [고치기] Then 지금 공정이 골라진 체크칸이 펴지고, 같은 목록이면 [저장]이 잠긴다', async () => {
    const user = userEvent.setup();
    renderFix();
    await user.click(screen.getByTestId('process-edit-button'));
    const group = screen.getByTestId('process-edit');
    expect(within(group).getByRole('checkbox', { name: '아연도금' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: '니켈도금' })).not.toBeChecked();
    expect(screen.getByTestId('process-save-button')).toBeDisabled();
  });

  it('Given 다른 공정을 고름 When [저장] Then 거산 공정 목록 순서로 보내고 상세를 다시 읽게 알린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postProcesses).mockResolvedValueOnce({
      data: { processCodes: ['ZINC_PLATING', 'ANODIZING'] },
      meta: { reevaluated: true },
    });
    const onSaved = renderFix();
    await user.click(screen.getByTestId('process-edit-button'));
    await user.click(screen.getByRole('checkbox', { name: '아노다이징' }));
    await user.click(screen.getByTestId('process-save-button'));
    await waitFor(() =>
      expect(postProcesses).toHaveBeenCalledWith(
        'opp-1',
        ['ZINC_PLATING', 'ANODIZING'],
        'park-lee',
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByTestId('process-edit')).not.toBeInTheDocument();
  });

  it('Given 모두 빼면 When 저장하려 하면 Then [저장]이 잠겨 빈 목록을 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderFix();
    await user.click(screen.getByTestId('process-edit-button'));
    await user.click(screen.getByRole('checkbox', { name: '아연도금' }));
    expect(screen.getByTestId('process-save-button')).toBeDisabled();
    expect(postProcesses).not.toHaveBeenCalled();
  });

  it('Given 서버가 거부 When [저장] Then 서버 말과 함께 실패를 알리고 고른 것은 그대로 둔다', async () => {
    const user = userEvent.setup();
    vi.mocked(postProcesses).mockRejectedValueOnce(
      new ApiError(400, {
        message: '공정 목록에 없는 값입니다. 화면을 새로 고쳐 주세요.',
        nextAction: '',
        ref: 'r1',
      }),
    );
    const onSaved = renderFix();
    await user.click(screen.getByTestId('process-edit-button'));
    await user.click(screen.getByRole('checkbox', { name: '니켈도금' }));
    await user.click(screen.getByTestId('process-save-button'));
    expect(await screen.findByTestId('process-save-error')).toHaveTextContent(
      '공정 목록에 없는 값입니다',
    );
    expect(screen.getByRole('checkbox', { name: '니켈도금' })).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Given 담당자를 고르기 전(기록 불가) When 열면 Then [고치기]가 잠겨 있다', () => {
    renderFix(vi.fn(), frame({ staffKey: null, canRecord: false }));
    expect(screen.getByTestId('process-edit-button')).toBeDisabled();
  });
});
