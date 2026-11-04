// 기록 영역(U5): 네 칸 표시 / 저장 호출 모양 / 거절 사유 필수 / 실패 시 입력 유지 / 담당자 미선택 비활성 /
// 전화번호가 들어 있는 메모도 막지 않음(PM 결정 2026-11-03). 서버 호출(postNote·postOutcome)은 가짜로 바꾼 확인이다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { ApiError, postNote, postOutcome } from '../../../api/client';
import type { OutcomeResponse } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { recordsArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postNote: vi.fn(),
  postOutcome: vi.fn(),
}));

const mockedNote = vi.mocked(postNote);
const mockedOutcome = vi.mocked(postOutcome);
const OPP = 'opp-1';
const EVAL = 'eval-1';

function frameValue(overrides: Partial<FrameValue> = {}): FrameValue {
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

function outcomeReply(overrides: Partial<OutcomeResponse> = {}) {
  return {
    data: {
      version: 1,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-04T01:12:00Z',
      status: 'INTERESTED' as const,
      ...overrides,
    },
    meta: {},
  };
}

function renderArea(
  value: FrameValue = frameValue(),
  props: Partial<React.ComponentProps<typeof RecordsArea>> = {},
) {
  return render(
    <FrameContext.Provider value={value}>
      <RecordsArea oppId={OPP} evalId={EVAL} {...props} />
    </FrameContext.Provider>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, testId: string, label: string) {
  await user.selectOptions(screen.getByTestId(testId), label);
}

describe('RecordsArea', () => {
  beforeEach(() => {
    mockedNote.mockReset();
    mockedOutcome.mockReset();
  });

  it('접촉 시도·영업 메모·영업 단계·다음 일정 네 칸이 보인다', () => {
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'IN_PROGRESS',
      },
      contactCount: { total: 3, call: 2, email: 1, visit: 0 },
    });
    expect(screen.getByRole('heading', { name: recordsArea.contactTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.noteTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.stageTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.scheduleTitle })).toBeInTheDocument();
    expect(screen.getByTestId('records-contact-count')).toHaveTextContent(
      '접촉 3회 (전화 2 · 메일 1 · 방문 0)',
    );
    expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 접촉');
  });

  it('영업 메모를 남기면 글을 서버로 보내고 입력칸이 비워진다 (연락처가 있어도 막지 않음)', async () => {
    const user = userEvent.setup();
    mockedNote.mockResolvedValueOnce({
      data: { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-04T01:12:00Z', noteId: 'n-1' },
      meta: {},
    });
    renderArea();
    fireEvent.change(screen.getByTestId('records-note-input'), {
      target: { value: '담당자 010-1234-5678 부재, 내일 재통화' },
    });
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() =>
      expect(mockedNote).toHaveBeenCalledWith(
        OPP,
        { text: '담당자 010-1234-5678 부재, 내일 재통화', kind: 'MEMO', evalId: EVAL },
        'park-lee',
      ),
    );
    expect(await screen.findByTestId('records-note-saved')).toHaveTextContent(
      recordsArea.savedPrefix,
    );
    expect(screen.getByTestId('records-note-input')).toHaveValue('');
  });

  it('메모 저장이 실패하면 서버의 쉬운 말과 함께 입력을 그대로 둔다', async () => {
    const user = userEvent.setup();
    mockedNote.mockRejectedValueOnce(
      new ApiError(400, { message: '메모는 200자까지 쓸 수 있습니다.', nextAction: '', ref: 'r1' }),
    );
    renderArea();
    fireEvent.change(screen.getByTestId('records-note-input'), { target: { value: '긴 메모' } });
    await user.click(screen.getByTestId('records-note-save-button'));
    expect(await screen.findByTestId('records-note-error')).toHaveTextContent(
      '메모는 200자까지 쓸 수 있습니다.',
    );
    expect(screen.getByTestId('records-note-input')).toHaveValue('긴 메모');
  });

  it('설정의 글자 상한을 보여 준다', () => {
    renderArea(
      frameValue({
        config: {
          records: { approvalEnabled: false, noteMaxLength: 150 },
          staff: [],
          brand: { logoUrl: null, brandName: '', colorPrimary: '', demoLabel: null },
          classificationLabels: {},
          activeDatasetKind: 'BROCHURE',
          accessProtectionEnabled: false,
          ruleVersion: 'v',
        },
      }),
    );
    expect(screen.getByTestId('records-note-counter')).toHaveTextContent('0 / 150자');
  });

  it('영업 단계를 고르면 단계가 저장되고 현재 단계가 바뀐다', async () => {
    const user = userEvent.setup();
    const onOutcomeSaved = vi.fn();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'INTERESTED' }));
    renderArea(frameValue(), { onOutcomeSaved });
    await pick(user, 'records-stage-select', '관심');
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        { evalId: EVAL, status: 'INTERESTED' },
        'park-lee',
      ),
    );
    expect(await screen.findByTestId('records-stage-current')).toHaveTextContent('현재 단계: 관심');
    expect(onOutcomeSaved).toHaveBeenCalledWith(expect.objectContaining({ status: 'INTERESTED' }));
  });

  it('거절은 사유를 적어야 저장 단추가 열리고 사유가 함께 간다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'LOST' }));
    renderArea();
    await pick(user, 'records-stage-select', '거절');
    expect(screen.getByTestId('records-stage-reason-error')).toHaveTextContent(
      recordsArea.stageReasonRequired,
    );
    expect(screen.getByTestId('records-stage-save-button')).toBeDisabled();
    fireEvent.change(screen.getByTestId('records-stage-reason-input'), {
      target: { value: '이미 다른 업체와 계약' },
    });
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        { evalId: EVAL, status: 'LOST', reason: '이미 다른 업체와 계약' },
        'park-lee',
      ),
    );
  });

  it('접촉 시도를 저장하면 방법·결과·날짜가 가고 접촉 횟수가 늘며, 관심 단계는 접촉으로 넘어간다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'IN_PROGRESS' }));
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'INTERESTED',
      },
      contactCount: { total: 0, call: 0, email: 0, visit: 0 },
    });
    expect(screen.getByTestId('records-contact-save-button')).toBeDisabled();
    await pick(user, 'records-contact-method', '전화');
    await pick(user, 'records-contact-result', '부재');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    const [, body] = mockedOutcome.mock.calls[0];
    expect(body).toMatchObject({
      evalId: EVAL,
      status: 'IN_PROGRESS',
      method: 'CALL',
      result: 'ABSENT',
    });
    expect(body.attemptedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByTestId('records-contact-count')).toHaveTextContent(
      '접촉 1회 (전화 1 · 메일 0 · 방문 0)',
    );
  });

  it('다음 일정을 저장하면 날짜·할 일과 현재 단계가 함께 간다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'IN_PROGRESS' }));
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'IN_PROGRESS',
      },
    });
    expect(screen.getByTestId('records-schedule-save-button')).toBeDisabled();
    fireEvent.change(screen.getByTestId('records-schedule-date'), {
      target: { value: '2026-11-10' },
    });
    fireEvent.change(screen.getByTestId('records-schedule-note'), {
      target: { value: '견적 회신 확인' },
    });
    await user.click(screen.getByTestId('records-schedule-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        {
          evalId: EVAL,
          status: 'IN_PROGRESS',
          nextScheduleAt: '2026-11-10',
          nextScheduleNote: '견적 회신 확인',
        },
        'park-lee',
      ),
    );
  });

  it('담당자를 고르지 않았거나 보기 전용이면 입력이 모두 막히고 안내가 보인다', () => {
    renderArea(frameValue({ staffKey: null, canRecord: false }));
    expect(screen.getByTestId('records-pick-staff-text')).toHaveTextContent(
      recordsArea.pickStaffFirst,
    );
    expect(screen.getByTestId('records-note-input')).toBeDisabled();
    expect(screen.getByTestId('records-schedule-date')).toBeDisabled();
    expect(mockedNote).not.toHaveBeenCalled();
  });
});
