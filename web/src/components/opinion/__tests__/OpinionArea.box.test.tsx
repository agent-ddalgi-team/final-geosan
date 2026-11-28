// #996(PM 결정 2026-11-29): 기업 상세의 "담당자 의견" 칸(variant="box").
// 단추 셋이 늘 보이고, 안 골랐으면 주황 칸 + 안내, 고른 뒤에는 고른 단추만 진한 보라 + "✓"와 고른 사람 · 날짜가 붙는다.
// 저장 규칙과 막는 조건은 다른 모양과 같다. 서버 호출(postOpinion)은 가짜로 바꾼 확인이다(실제 서버 연결 확인 아님).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OpinionArea from '../OpinionArea';
import { postOpinion } from '../../../api/client';
import type { ConfigUi, OpinionRecord } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { detailCompose, opinionArea } from '../../../labels/ko';
import { colors, detailLayout, opinionNudge } from '../../../theme/tokens';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postOpinion: vi.fn(),
}));

const mockedPost = vi.mocked(postOpinion);
const config = {
  staff: [{ key: 'staff-a', displayName: '영업 담당' }],
} as unknown as ConfigUi;

function record(opinion: OpinionRecord['opinion'], extra: Partial<OpinionRecord> = {}) {
  return {
    version: 2,
    updatedBy: 'staff-a',
    updatedAt: '2026-11-29T10:00:00+09:00',
    opinion,
    ...extra,
  } as OpinionRecord;
}

function renderBox(
  initial: OpinionRecord | null = null,
  frame: { staffKey?: string | null; canRecord?: boolean } = {},
) {
  const { staffKey = 'staff-a', canRecord = true } = frame;
  render(
    <FrameContext.Provider
      value={{
        config,
        staffKey,
        setStaffKey: () => {},
        canRecord,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <OpinionArea oppId="opp-1" evalId="eval-1" record={initial} variant="box" />
    </FrameContext.Provider>,
  );
}

beforeEach(() => mockedPost.mockReset());

describe('담당자 의견 칸 (#996)', () => {
  it('Given 아직 안 고른 회사 When 칸을 보면 Then 주황 칸에 "아직 안 골랐습니다 · 골라 주세요"와 단추 셋이 있다', () => {
    renderBox();
    const box = screen.getByRole('group', { name: detailCompose.opinion.title });
    expect(box).toHaveTextContent(detailCompose.opinion.title);
    expect(box).toHaveAttribute('data-nudge', 'true');
    expect(box).toHaveStyle({ background: opinionNudge.bg });
    // 색만으로 알리지 않는다: 글이 함께 있다.
    expect(within(box).getByTestId('opinion-nudge')).toHaveTextContent(detailCompose.opinion.nudge);
    expect(
      within(box)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['영업 대상', '검토 중', '제외']);
    for (const button of within(box).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toBeEnabled();
    }
    expect(screen.queryByTestId('opinion-picked-by')).not.toBeInTheDocument();
  });

  it('Given 검토 중으로 고른 회사 When 칸을 보면 Then 흰 칸에 고른 단추만 진한 보라 + "✓"이고 "영업 담당 · 11/29"가 붙는다', () => {
    renderBox(record('NEED_CHECK'));
    const box = screen.getByTestId('opinion-box');
    expect(box).not.toHaveAttribute('data-nudge');
    expect(box).toHaveStyle({ background: colors.bgContainer });
    expect(screen.queryByTestId('opinion-nudge')).not.toBeInTheDocument();
    const picked = screen.getByTestId('opinion-need-check-button');
    expect(picked).toHaveAttribute('aria-pressed', 'true');
    expect(picked).toHaveTextContent('✓ 검토 중');
    // "✓"는 꾸밈이라 이름에 넣지 않는다. 고른 상태는 aria-pressed가 알린다.
    expect(picked).toHaveAccessibleName('검토 중');
    expect(picked).toHaveStyle({ background: detailLayout.opinionPicked.bg });
    for (const id of ['opinion-worth-review-button', 'opinion-not-target-button']) {
      expect(screen.getByTestId(id)).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId(id)).not.toHaveTextContent('✓');
    }
    // 고른 사람은 담당자 목록의 이름으로, 날짜는 월/일로.
    expect(screen.getByTestId('opinion-picked-by')).toHaveTextContent(/^영업 담당 · 11\/29$/);
    // 전의 "의견: … (수정)" 한 줄은 이 모양에 없다(단추가 늘 보인다).
    expect(screen.queryByTestId('opinion-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('opinion-edit-button')).not.toBeInTheDocument();
  });

  it('Given 안 고른 회사 When [영업 대상]을 누르면 Then 바로 저장하고 그 단추가 고른 모양으로 바뀐다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce({
      data: record('WORTH_REVIEW', { version: 1 }),
      meta: { updatedAt: '2026-11-29T10:00:00+09:00' },
    });
    renderBox();
    await user.click(screen.getByTestId('opinion-worth-review-button'));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][0]).toBe('opp-1');
    expect(mockedPost.mock.calls[0][1]).toEqual({
      opinion: 'WORTH_REVIEW',
      evalId: 'eval-1',
      expectedVersion: null,
    });
    expect(mockedPost.mock.calls[0][2]).toBe('staff-a');
    const picked = await screen.findByTestId('opinion-worth-review-button');
    await waitFor(() => expect(picked).toHaveAttribute('aria-pressed', 'true'));
    expect(picked).toHaveTextContent('✓ 영업 대상');
    expect(screen.getByTestId('opinion-saved-text')).toHaveTextContent(opinionArea.savedPrefix);
    expect(screen.getByTestId('opinion-box')).not.toHaveAttribute('data-nudge');
    expect(screen.getByTestId('opinion-picked-by')).toHaveTextContent('영업 담당 · 11/29');
  });

  it('Given 검토 중인 회사 When 이미 고른 [검토 중]을 또 누르면 Then 같은 값을 다시 저장하지 않는다', async () => {
    const user = userEvent.setup();
    renderBox(record('NEED_CHECK'));
    await user.click(screen.getByTestId('opinion-need-check-button'));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('Given 안 고른 회사 When [제외]를 누르면 Then 이유 칸이 열리고 이유를 적어야만 저장된다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce({
      data: record('NOT_TARGET', { version: 1, reason: '도금을 직접 함' }),
      meta: { updatedAt: '2026-11-29T10:00:00+09:00' },
    });
    renderBox();
    await user.click(screen.getByTestId('opinion-not-target-button'));
    expect(mockedPost).not.toHaveBeenCalled();
    // 이유를 적는 동안은 알림 대신 이유 칸이 보인다.
    expect(screen.queryByTestId('opinion-nudge')).not.toBeInTheDocument();
    expect(screen.getByTestId('opinion-reason-save-button')).toBeDisabled();
    expect(screen.getByTestId('opinion-reason-error')).toHaveTextContent(
      opinionArea.reasonRequired,
    );
    await user.type(screen.getByTestId('opinion-reason-input'), '도금을 직접 함');
    await user.click(screen.getByTestId('opinion-reason-save-button'));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][1]).toMatchObject({
      opinion: 'NOT_TARGET',
      reason: '도금을 직접 함',
    });
    await waitFor(() =>
      expect(screen.getByTestId('opinion-not-target-button')).toHaveTextContent('✓ 제외'),
    );
    expect(screen.getByTestId('opinion-box-reason')).toHaveTextContent('제외 사유: 도금을 직접 함');
  });

  it('Given 저장이 실패 When [검토 중]을 누르면 Then 실패를 알리고 고른 모양으로 바꾸지 않는다', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValueOnce(new Error('network'));
    renderBox();
    await user.click(screen.getByTestId('opinion-need-check-button'));
    expect(await screen.findByTestId('opinion-save-error')).toHaveTextContent(
      opinionArea.saveFailed,
    );
    expect(screen.getByTestId('opinion-need-check-button')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('opinion-box')).toHaveAttribute('data-nudge', 'true');
  });

  it.each([
    ['보기 전용', 'viewer'],
    ['담당자를 고르기 전', null],
  ])(
    'Given %s When 칸을 보면 Then 단추가 잠기고 안내가 보이며 주황 알림은 없다',
    (_name, staffKey) => {
      renderBox(null, { staffKey, canRecord: false });
      const box = screen.getByTestId('opinion-box');
      expect(box).not.toHaveAttribute('data-nudge');
      expect(screen.queryByTestId('opinion-nudge')).not.toBeInTheDocument();
      for (const button of within(box).getAllByRole('button')) expect(button).toBeDisabled();
      expect(screen.getByTestId('opinion-pick-staff-text')).toHaveTextContent(
        opinionArea.pickStaffFirst,
      );
    },
  );

  it('Given 담당자 목록에 없는 사람이 고른 의견 When 칸을 보면 Then 받은 키 그대로와 날짜를 보인다', () => {
    renderBox(record('WORTH_REVIEW', { updatedBy: 'staff-z' }));
    expect(screen.getByTestId('opinion-picked-by')).toHaveTextContent(/^staff-z · 11\/29$/);
  });
});
