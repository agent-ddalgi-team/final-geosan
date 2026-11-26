// #958(PM 결정 2026-11-26): 상세 "한눈에 › 소재" 옆 [고치기]. 소재는 회사당 하나이고 확정 공정 모두에 적용된다.
// 서버 호출(postMaterial)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버는 tests/unit/u1/test_material_fix.py).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MaterialFix from '../MaterialFix';
import { ApiError, postMaterial } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postMaterial: vi.fn(),
}));

const OPTIONS = [
  { code: 'FE', name: '철' },
  { code: 'AL', name: '알루미늄' },
  { code: 'SUS', name: '스테인리스' },
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

function renderFix({
  current = 'FE' as string | null,
  hasProcess = true,
  onSaved = vi.fn(),
  value = frame(),
} = {}) {
  render(
    <FrameContext.Provider value={value}>
      <MaterialFix
        oppId="opp-1"
        current={current}
        hasProcess={hasProcess}
        options={OPTIONS}
        onSaved={onSaved}
      />
    </FrameContext.Provider>,
  );
  return onSaved;
}

beforeEach(() => {
  vi.mocked(postMaterial).mockReset();
});

describe('상세 › 한눈에 › 소재 [고치기] (#958)', () => {
  it('Given 소재 철 When [고치기] Then 지금 소재가 골라진 하나 고르기 칸이 펴지고, 같은 값이면 [저장]이 잠긴다', async () => {
    const user = userEvent.setup();
    renderFix();
    await user.click(screen.getByTestId('material-edit-button'));
    const group = screen.getByTestId('material-edit');
    expect(within(group).getByRole('radio', { name: '철' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: '알루미늄' })).not.toBeChecked();
    expect(group).toHaveTextContent('제외로 바뀝니다');
    expect(screen.getByTestId('material-save-button')).toBeDisabled();
  });

  it('Given 다른 소재를 고름 When [저장] Then 그 코드 하나를 보내고 상세를 다시 읽게 알린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postMaterial).mockResolvedValueOnce({
      data: { material: 'AL', processCodes: ['ANODIZING'] },
      meta: { reevaluated: true },
    });
    const onSaved = renderFix();
    await user.click(screen.getByTestId('material-edit-button'));
    await user.click(screen.getByRole('radio', { name: '알루미늄' }));
    await user.click(screen.getByTestId('material-save-button'));
    await waitFor(() => expect(postMaterial).toHaveBeenCalledWith('opp-1', 'AL', 'park-lee'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByTestId('material-edit')).not.toBeInTheDocument();
  });

  it('Given 공정이 정해지기 전 When [고치기] Then 고르는 칸 대신 "공정을 먼저 골라 주세요"가 보이고 아무것도 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderFix({ current: null, hasProcess: false });
    await user.click(screen.getByTestId('material-edit-button'));
    expect(screen.getByTestId('material-need-process')).toHaveTextContent(
      '공정을 먼저 골라 주세요',
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('material-cancel-button'));
    expect(screen.queryByTestId('material-need-process')).not.toBeInTheDocument();
    expect(postMaterial).not.toHaveBeenCalled();
  });

  it('Given 서버가 거부 When [저장] Then 서버 말과 함께 실패를 알리고 고른 것은 그대로 둔다', async () => {
    const user = userEvent.setup();
    vi.mocked(postMaterial).mockRejectedValueOnce(
      new ApiError(400, {
        message: '거산 처리 소재 목록에 없는 값입니다. 화면을 새로 고쳐 주세요.',
        nextAction: '',
        ref: 'r1',
      }),
    );
    const onSaved = renderFix();
    await user.click(screen.getByTestId('material-edit-button'));
    await user.click(screen.getByRole('radio', { name: '스테인리스' }));
    await user.click(screen.getByTestId('material-save-button'));
    expect(await screen.findByTestId('material-save-error')).toHaveTextContent(
      '거산 처리 소재 목록에 없는 값입니다',
    );
    expect(screen.getByRole('radio', { name: '스테인리스' })).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Given 담당자를 고르기 전(기록 불가) When 열면 Then [고치기]가 잠겨 있다', () => {
    renderFix({ value: frame({ staffKey: null, canRecord: false }) });
    expect(screen.getByTestId('material-edit-button')).toBeDisabled();
  });
});
