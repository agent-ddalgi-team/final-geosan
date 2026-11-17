// 제외한 회사에 접촉을 남기려 할 때 한 번 묻는다(#697, PM 결정 2026-11-13): 창 없이 저장 단추 아래에서.
// 제외가 아닌 회사는 묻지 않는다(서버가 같은 저장 안에서 검토 의견을 "영업 대상"으로 정한다).
// 서버 호출(postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { ApiError, postOutcome } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postNote: vi.fn(),
  postOutcome: vi.fn(),
  getSalesQuestions: vi.fn(() => new Promise(() => {})),
}));

const mockedOutcome = vi.mocked(postOutcome);

const frame: FrameValue = {
  config: null,
  staffKey: 'park-lee',
  setStaffKey: () => {},
  canRecord: true,
  setBannerMeta: () => {},
  setPageTitle: () => {},
};

const saved = {
  data: {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-14T01:00:00Z',
    status: 'IN_PROGRESS' as const,
  },
  meta: {},
};

function renderArea(excluded: boolean) {
  const onSalesStepChanged = vi.fn();
  render(
    <FrameContext.Provider value={frame}>
      <RecordsArea
        oppId="opp-1"
        evalId="eval-1"
        excluded={excluded}
        onSalesStepChanged={onSalesStepChanged}
      />
    </FrameContext.Provider>,
  );
  return { onSalesStepChanged };
}

async function pressSave(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('records-kind'), '전화');
  await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
  await user.click(screen.getByTestId('records-contact-save-button'));
}

describe('기록 구역 · 제외한 회사에 접촉을 남길 때 (#697)', () => {
  beforeEach(() => {
    mockedOutcome.mockReset();
  });

  it('제외가 아닌 회사는 묻지 않고 바로 저장하며 되돌리기 값을 보내지 않는다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(saved);
    renderArea(false);
    await pressSave(user);
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('records-excluded-ask')).not.toBeInTheDocument();
    expect(mockedOutcome.mock.calls[0][1]).not.toHaveProperty('restoreExcluded');
  });

  it('제외한 회사는 저장하기 전에 그 자리에서 한 번 묻고, 답하기 전에는 저장하지 않는다', async () => {
    const user = userEvent.setup();
    renderArea(true);
    // 누르기 전에는 묻는 줄이 없다.
    await user.selectOptions(screen.getByTestId('records-kind'), '전화');
    expect(screen.queryByTestId('records-excluded-ask')).not.toBeInTheDocument();
    await pressSave(user);
    expect(screen.getByTestId('records-excluded-ask')).toHaveTextContent(
      '제외한 회사입니다. 영업 대상으로 되돌릴까요?',
    );
    expect(screen.getByTestId('records-excluded-restore-button')).toHaveTextContent(
      '영업 대상으로 되돌리고 저장',
    );
    expect(screen.getByTestId('records-excluded-keep-button')).toHaveTextContent(
      '제외인 채로 저장',
    );
    // 창(모달)을 띄우지 않는다.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockedOutcome).not.toHaveBeenCalled();
  });

  it('[영업 대상으로 되돌리고 저장]을 누르면 되돌리기 값을 실어 한 번 저장하고 묻는 줄이 사라진다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(saved);
    const { onSalesStepChanged } = renderArea(true);
    await pressSave(user);
    await user.click(screen.getByTestId('records-excluded-restore-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({
      method: 'CALL',
      result: 'REACHED',
      evalId: 'eval-1',
      restoreExcluded: true,
    });
    await waitFor(() =>
      expect(screen.queryByTestId('records-excluded-ask')).not.toBeInTheDocument(),
    );
    // 상세가 다시 받아 검토 의견 칸이 새 의견으로 바뀌게 알린다.
    expect(onSalesStepChanged).toHaveBeenCalledTimes(1);
  });

  it('[제외인 채로 저장]을 누르면 되돌리기 값 없이 접촉만 저장한다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(saved);
    renderArea(true);
    await pressSave(user);
    await user.click(screen.getByTestId('records-excluded-keep-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({ method: 'CALL', result: 'REACHED' });
    expect(mockedOutcome.mock.calls[0][1]).not.toHaveProperty('restoreExcluded');
  });

  it('저장이 실패하면 묻는 줄과 입력이 그대로 남아 다시 누를 수 있다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockRejectedValueOnce(
      new ApiError(500, { message: '서버 오류', nextAction: '', ref: 'r1' }),
    );
    renderArea(true);
    await pressSave(user);
    await user.click(screen.getByTestId('records-excluded-restore-button'));
    await screen.findByTestId('records-contact-error');
    expect(screen.getByTestId('records-excluded-ask')).toBeInTheDocument();
    expect(screen.getByTestId('records-contact-result')).toHaveValue('REACHED');
  });
});
