// #798(PM 지시 2026-11-16): 목록 카드의 검토 의견은 단추 셋 대신 고르기 칸 하나(variant="select").
// 저장 동작은 단추와 같다: 영업 대상·검토 중은 바로 저장, 제외는 이유를 꼭 적어야 저장. 서버 호출은 가짜.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OpinionArea from '../OpinionArea';
import { postOpinion } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';
import { colors, opinionNudge } from '../../../theme/tokens';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postOpinion: vi.fn(),
}));

const mockedPost = vi.mocked(postOpinion);

function saved(opinion: 'WORTH_REVIEW' | 'NEED_CHECK' | 'NOT_TARGET', reason?: string) {
  return {
    data: { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-16T01:00:00Z', opinion, reason },
    meta: {},
  };
}

function renderArea(
  canRecord = true,
  record = null as Parameters<typeof OpinionArea>[0]['record'],
  /** 관심에 담은 회사의 줄이면 true(#981): 의견이 없을 때 고르기 칸을 띄워 알린다. */
  nudge = false,
) {
  render(
    <FrameContext.Provider
      value={{
        config: null,
        staffKey: canRecord ? 'park-lee' : 'viewer',
        setStaffKey: () => {},
        canRecord,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <OpinionArea oppId="opp-1" evalId="eval-1" record={record} variant="select" nudge={nudge} />
    </FrameContext.Provider>,
  );
}

beforeEach(() => mockedPost.mockReset());

it('Given 의견 없음 / When 영업 대상을 고르면 / Then 바로 저장하고 고르기 칸에 남는다', async () => {
  const user = userEvent.setup();
  mockedPost.mockResolvedValueOnce(saved('WORTH_REVIEW'));
  renderArea();
  expect(screen.queryByTestId('opinion-worth-review-button')).not.toBeInTheDocument();
  const select = screen.getByTestId('opinion-select');
  expect(select).toHaveValue('');
  await user.selectOptions(select, 'WORTH_REVIEW');
  await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
  expect(mockedPost.mock.calls[0][1]).toMatchObject({ opinion: 'WORTH_REVIEW', evalId: 'eval-1' });
  expect(await screen.findByTestId('opinion-saved-text')).toHaveTextContent('저장됨');
  expect(screen.getByTestId('opinion-select')).toHaveValue('WORTH_REVIEW');
});

it('Given 의견 없음 / When 제외를 고르면 / Then 이유 칸이 열리고 이유 없이는 저장되지 않으며, 적으면 함께 저장한다', async () => {
  const user = userEvent.setup();
  mockedPost.mockResolvedValueOnce(saved('NOT_TARGET', '가상 제외 이유'));
  renderArea();
  await user.selectOptions(screen.getByTestId('opinion-select'), 'NOT_TARGET');
  expect(mockedPost).not.toHaveBeenCalled();
  expect(screen.getByTestId('opinion-reason-save-button')).toBeDisabled();
  await user.type(screen.getByTestId('opinion-reason-input'), '가상 제외 이유');
  await user.click(screen.getByTestId('opinion-reason-save-button'));
  await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
  expect(mockedPost.mock.calls[0][1]).toMatchObject({
    opinion: 'NOT_TARGET',
    reason: '가상 제외 이유',
  });
});

it('제외 이유 칸에서 [취소]하면 저장하지 않고 고르기 칸은 원래 값으로 돌아간다', async () => {
  const user = userEvent.setup();
  renderArea(true, {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-16T01:00:00Z',
    opinion: 'NEED_CHECK',
  });
  await user.selectOptions(screen.getByTestId('opinion-select'), 'NOT_TARGET');
  await user.click(screen.getByTestId('opinion-reason-cancel-button'));
  expect(mockedPost).not.toHaveBeenCalled();
  expect(screen.getByTestId('opinion-select')).toHaveValue('NEED_CHECK');
});

it('담당자를 고르기 전이면 고르기 칸이 잠기고 안내가 보인다', () => {
  renderArea(false);
  expect(screen.getByTestId('opinion-select')).toBeDisabled();
  expect(screen.getByTestId('opinion-pick-staff-text')).toBeInTheDocument();
});

describe('의견 전 알림 (#981)', () => {
  it('Given 관심에 담은 회사인데 의견 없음 / When 고르기 칸 / Then 주황 테두리 + "의견을 골라 주세요"로 알리고, 의견을 고르면 알림이 사라진다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce(saved('WORTH_REVIEW'));
    renderArea(true, null, true);
    const select = screen.getByTestId('opinion-select');
    const nudge = screen.getByTestId('opinion-nudge');
    expect(nudge).toHaveTextContent(/^의견을 골라 주세요$/);
    expect(select).toHaveAttribute('data-nudge', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'opinion-nudge-opp-1');
    expect(nudge).toHaveAttribute('id', 'opinion-nudge-opp-1');
    expect(select).toHaveStyle({
      border: `2px solid ${opinionNudge.border}`,
      background: opinionNudge.bg,
    });

    await user.selectOptions(select, 'WORTH_REVIEW');
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('opinion-nudge')).not.toBeInTheDocument());
    expect(screen.getByTestId('opinion-select')).not.toHaveAttribute('data-nudge');
    expect(screen.getByTestId('opinion-select')).not.toHaveAttribute('aria-describedby');
    expect(screen.getByTestId('opinion-select')).toHaveStyle({
      border: `1px solid ${colors.border}`,
      background: colors.bgContainer,
    });
  });

  it('Given 알림이 보이는 줄 / When 제외를 골라 이유를 적는 중 / Then 알림을 숨기고, [취소]하면 다시 보인다', async () => {
    const user = userEvent.setup();
    renderArea(true, null, true);
    await user.selectOptions(screen.getByTestId('opinion-select'), 'NOT_TARGET');
    expect(screen.getByTestId('opinion-reason-input')).toBeInTheDocument();
    expect(screen.queryByTestId('opinion-nudge')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('opinion-reason-cancel-button'));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('opinion-nudge')).toBeInTheDocument();
  });

  it.each([
    ['알리라는 표시가 없음(관심에 안 담은 회사)', true, null, false],
    [
      '의견이 이미 있음',
      true,
      {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-16T01:00:00Z',
        opinion: 'NEED_CHECK' as const,
      },
      true,
    ],
    ['담당자를 고르기 전', false, null, true],
  ])('Given %s / When 고르기 칸 / Then 알림이 없다', (_name, canRecord, record, nudge) => {
    renderArea(canRecord, record, nudge);
    expect(screen.queryByTestId('opinion-nudge')).not.toBeInTheDocument();
    expect(screen.getByTestId('opinion-select')).not.toHaveAttribute('data-nudge');
  });
});
