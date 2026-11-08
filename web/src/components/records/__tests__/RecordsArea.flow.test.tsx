// 기록 구역 세 칸 흐름(#433, PM 결정 2026-11-08): ① 안내·번호 / ② 접촉 날짜는 오늘(한국 시간)까지 + 서버 400 안내 /
// ③ 접촉을 적은 뒤 단계가 미접촉이면 "접촉으로 바꿀까요?"를 한 번 묻는다(자동 변경 아님).
// 서버 호출(postNote·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { ApiError, postNote, postOutcome } from '../../../api/client';
import type { OutcomeRecord, OutcomeResponse } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { recordsArea } from '../../../labels/ko';
import { todayKst } from '../../../utils/time';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postNote: vi.fn(),
  postOutcome: vi.fn(),
}));

const mockedOutcome = vi.mocked(postOutcome);
const mockedNote = vi.mocked(postNote);
const OPP = 'opp-1';
const EVAL = 'eval-1';

const frame: FrameValue = {
  config: null,
  staffKey: 'park-lee',
  setStaffKey: () => {},
  canRecord: true,
  setBannerMeta: () => {},
  setPageTitle: () => {},
};

function outcome(status: OutcomeRecord['status']): OutcomeRecord {
  return { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-03T00:00:00Z', status };
}

function reply(status: OutcomeResponse['status']) {
  return {
    data: { version: 2, updatedBy: 'park-lee', updatedAt: '2026-11-08T01:00:00Z', status },
    meta: {},
  };
}

function renderArea(props: Partial<React.ComponentProps<typeof RecordsArea>> = {}) {
  const onRecorded = vi.fn();
  render(
    <FrameContext.Provider value={frame}>
      <RecordsArea oppId={OPP} evalId={EVAL} onRecorded={onRecorded} {...props} />
    </FrameContext.Provider>,
  );
  return { onRecorded };
}

async function saveContact(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('records-kind'), '방문');
  await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
  await user.click(screen.getByTestId('records-contact-save-button'));
}

function badDate(message: string) {
  return new ApiError(400, {
    message: '영업 기록의 항목을 확인해 주세요.',
    nextAction: '표시된 칸을 고친 뒤 다시 실행해 주세요.',
    ref: 'r1',
    fields: [{ path: 'attemptedAt', message }],
  });
}

describe('기록 구역 · ① 안내와 번호 (#433)', () => {
  beforeEach(() => {
    mockedOutcome.mockReset();
    mockedNote.mockReset();
  });

  it('머리에 "한 일 → 지금 단계 → 다음 할 일" 안내 한 줄이 보이고, 세 칸 제목 앞에 ①②③이 붙는다', () => {
    renderArea();
    expect(screen.getByTestId('records-flow-guide')).toHaveTextContent(recordsArea.flowGuide);
    expect(screen.getByTestId('records-step-1')).toHaveTextContent('①');
    expect(screen.getByTestId('records-step-2')).toHaveTextContent('②');
    expect(screen.getByTestId('records-step-3')).toHaveTextContent('③');
    // 번호는 그림 글자라 제목의 낭독 이름은 그대로다.
    expect(screen.getByRole('heading', { name: recordsArea.entryTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.stageTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.scheduleTitle })).toBeInTheDocument();
  });
});

describe('기록 구역 · ② 접촉 날짜는 오늘까지 (#433)', () => {
  beforeEach(() => {
    mockedOutcome.mockReset();
  });

  it('날짜 칸은 처음에 오늘(한국 날짜)이고, 고를 수 있는 가장 늦은 날도 오늘이다', async () => {
    const user = userEvent.setup();
    renderArea();
    await user.selectOptions(screen.getByTestId('records-kind'), '전화');
    const date = screen.getByTestId('records-contact-date') as HTMLInputElement;
    expect(date.value).toBe(todayKst());
    expect(date.max).toBe(todayKst());
  });

  it('서버가 접촉 날짜를 400으로 돌려보내면 그 문장을 날짜 칸 아래에 보이고, 저장됨 안내는 없다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockRejectedValueOnce(badDate('앞으로 할 일은 다음 일정에 적어 주세요'));
    renderArea({ outcome: outcome('IN_PROGRESS') });
    await saveContact(user);
    const alert = await screen.findByTestId('records-contact-date-error');
    expect(alert).toHaveTextContent('앞으로 할 일은 다음 일정에 적어 주세요');
    expect(screen.getByTestId('records-contact-date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('records-contact-saved')).not.toBeInTheDocument();
    expect(screen.queryByTestId('records-contact-error')).not.toBeInTheDocument();
  });

  it('날짜를 다시 고르면 날짜 오류가 사라지고, 다른 이유의 저장 실패는 기존 실패 안내를 쓴다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockRejectedValueOnce(badDate('앞으로 할 일은 다음 일정에 적어 주세요'));
    renderArea({ outcome: outcome('IN_PROGRESS') });
    await saveContact(user);
    await screen.findByTestId('records-contact-date-error');
    await user.clear(screen.getByTestId('records-contact-date'));
    await user.type(screen.getByTestId('records-contact-date'), '2026-11-01');
    expect(screen.queryByTestId('records-contact-date-error')).not.toBeInTheDocument();

    mockedOutcome.mockRejectedValueOnce(
      new ApiError(500, { message: '서버 오류', nextAction: '', ref: 'r2' }),
    );
    await user.click(screen.getByTestId('records-contact-save-button'));
    expect(await screen.findByTestId('records-contact-error')).toHaveTextContent(
      recordsArea.saveFailed,
    );
    expect(screen.queryByTestId('records-contact-date-error')).not.toBeInTheDocument();
  });
});

describe('기록 구역 · ③ 접촉 뒤 단계 제안 (#433)', () => {
  beforeEach(() => {
    mockedOutcome.mockReset();
  });

  it('단계 기록이 없는 회사에 접촉을 적으면 단계를 자동으로 바꾸지 않고 "접촉으로 바꿀까요?"를 묻는다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(reply('NOT_EXECUTED'));
    renderArea();
    await saveContact(user);
    expect(await screen.findByTestId('records-stage-suggestion')).toHaveTextContent(
      recordsArea.stageSuggest,
    );
    // 접촉 저장은 지금 단계(기록 없음 → 미접촉)를 그대로 싣는다.
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({
      status: 'NOT_EXECUTED',
      method: 'VISIT',
    });
    expect(screen.getByTestId('records-stage-current')).toHaveTextContent(
      `${recordsArea.stageCurrent}: 미접촉`,
    );
  });

  it('[접촉으로 바꾸기]를 누르면 영업 단계 저장(접촉)을 부르고, 제안은 사라지며 타임라인을 다시 읽게 한다', async () => {
    const user = userEvent.setup();
    mockedOutcome
      .mockResolvedValueOnce(reply('NOT_EXECUTED'))
      .mockResolvedValueOnce(reply('IN_PROGRESS'));
    const { onRecorded } = renderArea({ outcome: outcome('NOT_EXECUTED') });
    await saveContact(user);
    await user.click(await screen.findByTestId('records-stage-suggestion-apply'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(2));
    expect(mockedOutcome.mock.calls[1][1]).toMatchObject({ evalId: EVAL, status: 'IN_PROGRESS' });
    expect(mockedOutcome.mock.calls[1][1]).not.toHaveProperty('method');
    await waitFor(() =>
      expect(screen.queryByTestId('records-stage-suggestion')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 접촉');
    expect(onRecorded).toHaveBeenCalledTimes(2);
  });

  it('[닫기]를 누르면 사라지고, 다음 접촉을 적어도 같은 회사에서는 다시 묻지 않는다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValue(reply('NOT_EXECUTED'));
    renderArea({ outcome: outcome('NOT_EXECUTED') });
    await saveContact(user);
    await user.click(await screen.findByTestId('records-stage-suggestion-dismiss'));
    expect(screen.queryByTestId('records-stage-suggestion')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('records-contact-result'), '부재');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('records-stage-suggestion')).not.toBeInTheDocument();
  });

  it.each(['IN_PROGRESS', 'ON_HOLD', 'WON'] as const)(
    '이미 %s 단계면 접촉을 적어도 묻지 않고 단계도 그대로 보낸다',
    async (status) => {
      const user = userEvent.setup();
      mockedOutcome.mockResolvedValueOnce(reply(status));
      renderArea({ outcome: outcome(status) });
      await saveContact(user);
      await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
      expect(mockedOutcome.mock.calls[0][1]).toMatchObject({ status });
      expect(screen.queryByTestId('records-stage-suggestion')).not.toBeInTheDocument();
    },
  );

  it('접촉 저장이 실패하면 제안을 보이지 않는다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockRejectedValueOnce(
      new ApiError(500, { message: '서버 오류', nextAction: '', ref: 'r3' }),
    );
    renderArea({ outcome: outcome('NOT_EXECUTED') });
    await saveContact(user);
    await screen.findByTestId('records-contact-error');
    expect(screen.queryByTestId('records-stage-suggestion')).not.toBeInTheDocument();
  });

  it('메모만 남기면 단계를 묻지 않는다', async () => {
    const user = userEvent.setup();
    mockedNote.mockResolvedValueOnce({
      data: { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-08T01:00:00Z', noteId: 'n-1' },
      meta: {},
    });
    renderArea({ outcome: outcome('NOT_EXECUTED') });
    await user.type(screen.getByTestId('records-note-input'), '그냥 메모');
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() => expect(mockedNote).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('records-stage-suggestion')).not.toBeInTheDocument();
  });
});
