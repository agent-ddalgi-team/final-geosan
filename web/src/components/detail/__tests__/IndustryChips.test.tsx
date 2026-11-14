// 상세 산업군 칩(#646): AI 제안 표시 / [확정] / [고치기](설정 목록에서 고르기, 3개까지) / 잠금 / 저장 실패.
// 서버 호출(postIndustries)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IndustryChips from '../IndustryChips';
import { ApiError, postIndustries } from '../../../api/client';
import type { ConfigUi } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { industryChips } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postIndustries: vi.fn(),
}));

const mockedPost = vi.mocked(postIndustries);
const OPP = 'opp-1';
const OPTIONS = ['방위산업', '반도체', '자동차 부품', '항공우주', '기타'];

function frameValue(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config: {
      ingestOptions: { processes: [], regions: [], industries: OPTIONS },
    } as unknown as ConfigUi,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...overrides,
  };
}

function renderChips(
  props: {
    industries?: string[];
    source?: 'AI' | 'STAFF' | 'CASE_FILE' | null;
    value?: FrameValue;
  } = {},
) {
  const onSaved = vi.fn();
  render(
    <FrameContext.Provider value={props.value ?? frameValue()}>
      <IndustryChips
        oppId={OPP}
        header={{
          industries: props.industries ?? ['자동차 부품'],
          industriesSource: props.source === undefined ? 'AI' : props.source,
        }}
        onSaved={onSaved}
      />
    </FrameContext.Provider>,
  );
  return onSaved;
}

function saved(industries: string[]) {
  return {
    data: { industries, industriesSource: 'STAFF' as const, industriesConfirmedAt: '2026-11-14' },
    meta: {},
  } as Awaited<ReturnType<typeof postIndustries>>;
}

const chipTexts = () => screen.getAllByTestId('industry-chip').map((chip) => chip.textContent);

beforeEach(() => {
  mockedPost.mockReset();
});

describe('상세 산업군 칩 (#646)', () => {
  it('AI가 제안한 산업군은 "(AI 제안)"으로 보이고 [확정]·[고치기]가 있다. 초록 체크는 없다', () => {
    renderChips({ industries: ['자동차 부품', '반도체'] });
    expect(screen.getByRole('heading', { name: industryChips.title })).toBeInTheDocument();
    expect(chipTexts()).toEqual(['자동차 부품 (AI 제안)', '반도체 (AI 제안)']);
    for (const chip of screen.getAllByTestId('industry-chip')) {
      expect(chip).toHaveAttribute('data-mark', 'ai');
      expect(chip).not.toHaveTextContent('✓');
    }
    expect(screen.getByTestId('industry-confirm-button')).toHaveTextContent('확정');
    expect(screen.getByTestId('industry-edit-button')).toHaveTextContent('고치기');
    expect(screen.queryByTestId('industry-chips-source')).not.toBeInTheDocument();
    expect(screen.getByTestId('industry-chips-hint')).toHaveTextContent(industryChips.hint);
  });

  it('[확정]을 누르면 보이던 값 그대로 저장하고 상세를 새로 불러오게 알린다', async () => {
    mockedPost.mockResolvedValueOnce(saved(['자동차 부품', '반도체']));
    const user = userEvent.setup();
    const onSaved = renderChips({ industries: ['자동차 부품', '반도체'] });
    await user.click(screen.getByTestId('industry-confirm-button'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(OPP, ['자동차 부품', '반도체'], 'park-lee');
  });

  it.each([
    ['STAFF', industryChips.source.STAFF],
    ['CASE_FILE', industryChips.source.CASE_FILE],
  ] as const)(
    '사람이 확인한 값(%s)은 초록 ✓로 보이고 [확정] 없이 [고치기]만 있다',
    (source, word) => {
      renderChips({ source });
      expect(chipTexts()).toEqual(['자동차 부품 ✓']);
      const chip = screen.getByTestId('industry-chip');
      expect(chip).toHaveAttribute('data-mark', 'confirmed');
      expect(chip).toHaveAccessibleName('자동차 부품 (사람이 확인한 값)');
      expect(screen.getByTestId('industry-chips-source')).toHaveTextContent(word);
      expect(screen.queryByTestId('industry-confirm-button')).not.toBeInTheDocument();
      expect(screen.getByTestId('industry-edit-button')).toBeEnabled();
    },
  );

  it('[고치기]를 누르면 설정의 산업군 목록이 그 자리에 펼쳐지고, 고른 값을 설정 순서로 저장한다', async () => {
    mockedPost.mockResolvedValueOnce(saved(['반도체', '항공우주']));
    const user = userEvent.setup();
    const onSaved = renderChips();
    await user.click(screen.getByTestId('industry-edit-button'));
    const edit = screen.getByTestId('industry-edit');
    const boxes = within(edit).getAllByRole('checkbox');
    expect(boxes).toHaveLength(OPTIONS.length);
    // 지금 값이 미리 골라져 있다.
    expect(within(edit).getByRole('checkbox', { name: '자동차 부품' })).toBeChecked();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(within(edit).getByRole('checkbox', { name: '자동차 부품' }));
    await user.click(within(edit).getByRole('checkbox', { name: '항공우주' }));
    await user.click(within(edit).getByRole('checkbox', { name: '반도체' }));
    await user.click(screen.getByTestId('industry-save-button'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(OPP, ['반도체', '항공우주'], 'park-lee');
    expect(screen.queryByTestId('industry-edit')).not.toBeInTheDocument();
  });

  it('3개를 고르면 나머지 보기가 잠기고, 하나도 안 고르면 [저장]이 잠긴다', async () => {
    const user = userEvent.setup();
    renderChips();
    await user.click(screen.getByTestId('industry-edit-button'));
    const edit = screen.getByTestId('industry-edit');
    expect(screen.getByTestId('industry-edit-hint')).toHaveTextContent(
      '산업군은 3개까지 고를 수 있습니다.',
    );
    await user.click(within(edit).getByRole('checkbox', { name: '방위산업' }));
    await user.click(within(edit).getByRole('checkbox', { name: '반도체' }));
    expect(within(edit).getByRole('checkbox', { name: '항공우주' })).toBeDisabled();
    expect(within(edit).getByRole('checkbox', { name: '기타' })).toBeDisabled();
    expect(within(edit).getByRole('checkbox', { name: '반도체' })).toBeEnabled();

    for (const name of ['방위산업', '반도체', '자동차 부품']) {
      await user.click(within(edit).getByRole('checkbox', { name }));
    }
    expect(screen.getByTestId('industry-save-button')).toBeDisabled();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('이미 확인된 값과 똑같이 고르면 [저장]이 잠기고, [취소]하면 저장 없이 닫힌다', async () => {
    const user = userEvent.setup();
    const onSaved = renderChips({ source: 'STAFF' });
    await user.click(screen.getByTestId('industry-edit-button'));
    expect(screen.getByTestId('industry-save-button')).toBeDisabled();
    await user.click(screen.getByTestId('industry-cancel-button'));
    expect(screen.queryByTestId('industry-edit')).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('산업군이 없으면 "산업 미확정"과 [고치기]만 보인다', () => {
    renderChips({ industries: [], source: null });
    expect(screen.getByTestId('industry-chips-none')).toHaveTextContent('산업 미확정');
    expect(screen.queryByTestId('industry-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('industry-confirm-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('industry-edit-button')).toBeEnabled();
  });

  it('담당자를 고르기 전·보기 전용이면 단추가 잠기고 안내가 보인다', async () => {
    const user = userEvent.setup();
    renderChips({ value: frameValue({ staffKey: null, canRecord: false }) });
    expect(screen.getByTestId('industry-confirm-button')).toBeDisabled();
    expect(screen.getByTestId('industry-edit-button')).toBeDisabled();
    expect(screen.getByTestId('industry-chips-hint')).toHaveTextContent(
      industryChips.pickStaffFirst,
    );
    await user.click(screen.getByTestId('industry-confirm-button'));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('설정의 산업군 목록을 못 받았으면 [고치기]가 잠기고 이유가 보인다', () => {
    renderChips({ value: frameValue({ config: null }) });
    expect(screen.getByTestId('industry-edit-button')).toBeDisabled();
    expect(screen.getByTestId('industry-chips-hint')).toHaveTextContent(industryChips.noOptions);
    // 제안된 값을 그대로 확정하는 것은 목록 없이도 된다.
    expect(screen.getByTestId('industry-confirm-button')).toBeEnabled();
  });

  it('서버가 거부하면 서버 문장을 보이고 새로 불러오지 않는다(성공처럼 넘기지 않는다)', async () => {
    mockedPost.mockRejectedValueOnce(
      new ApiError(400, {
        message: '산업군 목록에 없는 값입니다. 화면을 새로 고쳐 주세요.',
        nextAction: '',
        ref: 'r1',
      }),
    );
    const user = userEvent.setup();
    const onSaved = renderChips();
    await user.click(screen.getByTestId('industry-confirm-button'));
    expect(await screen.findByTestId('industry-chips-error')).toHaveTextContent(
      '산업군을 저장하지 못했습니다. (산업군 목록에 없는 값입니다. 화면을 새로 고쳐 주세요.)',
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(chipTexts()).toEqual(['자동차 부품 (AI 제안)']);
    expect(screen.getByTestId('industry-confirm-button')).toBeEnabled();
  });

  it('서버에 닿지 못하면 연결 실패 문장을 보인다', async () => {
    mockedPost.mockRejectedValueOnce(new TypeError('network'));
    const user = userEvent.setup();
    renderChips();
    await user.click(screen.getByTestId('industry-confirm-button'));
    expect(await screen.findByTestId('industry-chips-error')).toHaveTextContent(
      '산업군을 저장하지 못했습니다. (서버에 연결하지 못했습니다.)',
    );
  });
});
