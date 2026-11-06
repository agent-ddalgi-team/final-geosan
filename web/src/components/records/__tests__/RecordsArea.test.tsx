// 기록 영역(U5): 종류 한 칸 표시 / 저장 호출 모양 / 거절 사유 필수 / 실패 시 입력 유지 / 담당자 미선택 비활성 /
// 전화번호가 들어 있는 메모도 막지 않음(PM 결정 2026-11-03). 서버 호출(postNote·postOutcome)은 가짜로 바꾼 확인이다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      status: 'IN_PROGRESS' as const,
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

  it('기록 남기기(종류 한 칸)·영업 단계·다음 일정 세 구역이 보이고, 처음 종류는 메모다', () => {
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'IN_PROGRESS',
      },
    });
    expect(screen.getByRole('heading', { name: recordsArea.entryTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.stageTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.scheduleTitle })).toBeInTheDocument();
    // 접촉 시도·영업 메모 구역은 따로 없고, 접촉 횟수는 이 영역이 아니라 상세 머리가 보인다.
    expect(screen.queryByTestId('records-contact-count')).not.toBeInTheDocument();
    const kind = screen.getByTestId('records-kind') as HTMLSelectElement;
    expect(kind.value).toBe('MEMO');
    expect(
      within(kind)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['메모', '전화', '방문', '메일', '자료 조사']);
    expect(screen.getByTestId('records-note-input')).toBeInTheDocument();
    expect(screen.queryByTestId('records-contact-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 접촉');
  });

  it('종류를 전화·방문·메일로 바꾸면 결과·날짜 입력이 나오고, 메모·자료 조사로 돌아오면 글 입력이 나온다', async () => {
    const user = userEvent.setup();
    renderArea();
    for (const label of ['전화', '방문', '메일']) {
      await pick(user, 'records-kind', label);
      expect(screen.getByTestId('records-contact-result')).toBeInTheDocument();
      expect(screen.getByTestId('records-contact-date')).toBeInTheDocument();
      expect(screen.queryByTestId('records-note-input')).not.toBeInTheDocument();
    }
    await pick(user, 'records-kind', '자료 조사');
    expect(screen.getByTestId('records-note-input')).toBeInTheDocument();
    expect(screen.queryByTestId('records-contact-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-note-save-button')).toHaveTextContent(
      recordsArea.researchSave,
    );
  });

  it('자료 조사를 고르면 종류 RESEARCH로 메모를 저장하고 영업 결과는 저장하지 않는다', async () => {
    const user = userEvent.setup();
    mockedNote.mockResolvedValueOnce({
      data: { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-04T01:12:00Z', noteId: 'n-2' },
      meta: {},
    });
    renderArea();
    await pick(user, 'records-kind', '자료 조사');
    fireEvent.change(screen.getByTestId('records-note-input'), {
      target: { value: '홈페이지에서 도금 설비 확인' },
    });
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() =>
      expect(mockedNote).toHaveBeenCalledWith(
        OPP,
        { text: '홈페이지에서 도금 설비 확인', kind: 'RESEARCH', evalId: EVAL },
        'park-lee',
      ),
    );
    expect(mockedOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ['전화', 'CALL'],
    ['방문', 'VISIT'],
    ['메일', 'EMAIL'],
  ])('%s를 저장하면 방법 %s로 영업 결과가 가고, 접촉 저장을 알린다', async (label, code) => {
    const user = userEvent.setup();
    const onContactRecorded = vi.fn();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'IN_PROGRESS' }));
    renderArea(frameValue(), { onContactRecorded });
    await pick(user, 'records-kind', label);
    await pick(user, 'records-contact-result', '연결됨');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({ method: code, result: 'REACHED' });
    expect(mockedNote).not.toHaveBeenCalled();
    await waitFor(() => expect(onContactRecorded).toHaveBeenCalledWith(code));
  });

  it.each([
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['SAMPLE_OR_REGISTRATION_APPROVED', 'SAMPLE_OR_REGISTRATION_APPROVED'],
    ['ON_HOLD', 'ON_HOLD'],
  ] as const)(
    '이미 %s 단계면 접촉을 저장해도 단계는 그대로 %s다 (접촉 중 자동 전환은 미접촉일 때만)',
    async (from, expected) => {
      const user = userEvent.setup();
      mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: expected }));
      renderArea(frameValue(), {
        outcome: {
          version: 1,
          updatedBy: 'park-lee',
          updatedAt: '2026-11-03T00:00:00Z',
          status: from,
        },
      });
      await pick(user, 'records-kind', '전화');
      await pick(user, 'records-contact-result', '부재');
      await user.click(screen.getByTestId('records-contact-save-button'));
      await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
      expect(mockedOutcome.mock.calls[0][1]).toMatchObject({ status: expected });
    },
  );

  it('메모는 단계를 바꾸지 않는다: 메모 저장은 영업 결과를 부르지 않고 접촉 저장도 알리지 않는다', async () => {
    const user = userEvent.setup();
    const onContactRecorded = vi.fn();
    mockedNote.mockResolvedValueOnce({
      data: { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-04T01:12:00Z', noteId: 'n-3' },
      meta: {},
    });
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'ON_HOLD',
      },
      onContactRecorded,
    });
    fireEvent.change(screen.getByTestId('records-note-input'), { target: { value: '그냥 메모' } });
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() => expect(mockedNote).toHaveBeenCalledTimes(1));
    expect(mockedOutcome).not.toHaveBeenCalled();
    expect(onContactRecorded).not.toHaveBeenCalled();
    expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 보류');
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

  it('저장이 끝나면 타임라인을 새로 불러오라고 알리고, 실패하면 알리지 않는다', async () => {
    const user = userEvent.setup();
    const onRecorded = vi.fn();
    mockedNote.mockResolvedValueOnce({
      data: { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-04T01:12:00Z', noteId: 'n-1' },
      meta: {},
    });
    mockedNote.mockRejectedValueOnce(
      new ApiError(400, { message: '실패', nextAction: '', ref: 'r1' }),
    );
    renderArea(frameValue(), { onRecorded });
    fireEvent.change(screen.getByTestId('records-note-input'), { target: { value: '첫 메모' } });
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId('records-note-input'), { target: { value: '둘째 메모' } });
    await user.click(screen.getByTestId('records-note-save-button'));
    await screen.findByTestId('records-note-error');
    expect(onRecorded).toHaveBeenCalledTimes(1);
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
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'ON_HOLD' }));
    renderArea(frameValue(), { onOutcomeSaved });
    await pick(user, 'records-stage-select', '보류');
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        { evalId: EVAL, status: 'ON_HOLD' },
        'park-lee',
      ),
    );
    expect(await screen.findByTestId('records-stage-current')).toHaveTextContent('현재 단계: 보류');
    expect(onOutcomeSaved).toHaveBeenCalledWith(expect.objectContaining({ status: 'ON_HOLD' }));
  });

  it('영업 단계 선택지에는 "관심"이 없다: 관심은 단계가 아니라 켜고 끄는 단추다 (#357)', () => {
    renderArea();
    expect(
      within(screen.getByTestId('records-stage-select'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      recordsArea.selectPlaceholder,
      '미접촉',
      '접촉',
      '견적·샘플',
      '보류',
      '성사',
      '거절',
    ]);
  });

  it('거절을 고르면 거절 이유 선택 상자가 나오고 이유를 고르기 전에는 저장이 잠긴다', async () => {
    const user = userEvent.setup();
    renderArea();
    expect(screen.queryByTestId('records-stage-lost-code')).not.toBeInTheDocument();
    await pick(user, 'records-stage-select', '거절');
    const select = screen.getByTestId('records-stage-lost-code');
    const labels = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels).toEqual([
      '거절 이유 고르세요',
      '가격',
      '납기',
      '기존 거래처 유지',
      '수요 없음',
      '품질·인증 요건',
      '기타',
    ]);
    expect(screen.getByTestId('records-stage-lost-code-error')).toHaveTextContent(
      recordsArea.stageLostCodeRequired,
    );
    expect(screen.getByTestId('records-stage-save-button')).toBeDisabled();
  });

  it('거절 이유를 가격으로 고르면 글 없이도 저장되고 요청에 이유 코드가 들어간다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'LOST', lostReasonCode: 'PRICE' }));
    renderArea();
    await pick(user, 'records-stage-select', '거절');
    await pick(user, 'records-stage-lost-code', '가격');
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        { evalId: EVAL, status: 'LOST', lostReasonCode: 'PRICE' },
        'park-lee',
      ),
    );
    expect(await screen.findByTestId('records-stage-current')).toHaveTextContent(
      '현재 단계: 거절 · 가격',
    );
    // 저장이 끝나면 거절 입력은 비워진다.
    expect(screen.queryByTestId('records-stage-lost-code')).not.toBeInTheDocument();
  });

  it('거절 이유가 기타면 이유 글이 필수이고, 글을 적으면 코드와 글이 함께 간다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'LOST', lostReasonCode: 'OTHER' }));
    renderArea();
    await pick(user, 'records-stage-select', '거절');
    await pick(user, 'records-stage-lost-code', '기타');
    expect(screen.getByTestId('records-stage-reason-error')).toHaveTextContent(
      recordsArea.stageOtherReasonRequired,
    );
    expect(screen.getByTestId('records-stage-save-button')).toBeDisabled();
    fireEvent.change(screen.getByTestId('records-stage-reason-input'), {
      target: { value: '이미 다른 업체와 계약' },
    });
    expect(screen.queryByTestId('records-stage-reason-error')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        { evalId: EVAL, status: 'LOST', lostReasonCode: 'OTHER', reason: '이미 다른 업체와 계약' },
        'park-lee',
      ),
    );
  });

  it('가격처럼 기타가 아닌 이유에 글을 적으면 글도 함께 가고 글은 선택이다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'LOST', lostReasonCode: 'PRICE' }));
    renderArea();
    await pick(user, 'records-stage-select', '거절');
    await pick(user, 'records-stage-lost-code', '가격');
    fireEvent.change(screen.getByTestId('records-stage-reason-input'), {
      target: { value: '단가가 맞지 않음' },
    });
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        { evalId: EVAL, status: 'LOST', lostReasonCode: 'PRICE', reason: '단가가 맞지 않음' },
        'park-lee',
      ),
    );
  });

  it('거절이 아닌 단계로 바꾸면 거절 이유 상자가 숨고 이유 코드는 요청에 들어가지 않는다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'ON_HOLD' }));
    renderArea();
    await pick(user, 'records-stage-select', '거절');
    await pick(user, 'records-stage-lost-code', '가격');
    await pick(user, 'records-stage-select', '보류');
    expect(screen.queryByTestId('records-stage-lost-code')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(mockedOutcome.mock.calls[0][1]).toEqual({ evalId: EVAL, status: 'ON_HOLD' });
  });

  it('처음부터 거절 · 가격인 기록은 현재 단계 줄에 이유까지 보인다', () => {
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'LOST',
        lostReasonCode: 'PRICE',
      },
    });
    expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 거절 · 가격');
  });

  it('이미 거절인 채로 다음 일정을 저장하면 거절 이유 코드를 함께 보낸다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'LOST', lostReasonCode: 'PRICE' }));
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'LOST',
        lostReasonCode: 'PRICE',
      },
    });
    fireEvent.change(screen.getByTestId('records-schedule-date'), {
      target: { value: '2026-12-01' },
    });
    await user.click(screen.getByTestId('records-schedule-save-button'));
    await waitFor(() =>
      expect(mockedOutcome).toHaveBeenCalledWith(
        OPP,
        { evalId: EVAL, status: 'LOST', lostReasonCode: 'PRICE', nextScheduleAt: '2026-12-01' },
        'park-lee',
      ),
    );
  });

  it('접촉 시도를 저장하면 방법·결과·날짜가 가고, 미접촉 단계는 접촉으로 넘어간다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(outcomeReply({ status: 'IN_PROGRESS' }));
    renderArea(frameValue(), {
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-03T00:00:00Z',
        status: 'NOT_EXECUTED',
      },
    });
    await pick(user, 'records-kind', '전화');
    expect(screen.getByTestId('records-contact-save-button')).toBeDisabled();
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
