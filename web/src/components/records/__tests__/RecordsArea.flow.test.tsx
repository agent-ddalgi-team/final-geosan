// 기록 구역 세 칸 흐름(#433, PM 결정 2026-11-08): ① 안내·번호 / ② 접촉 날짜는 오늘(한국 시간)까지 + 서버 400 안내 /
// ③ 접촉을 적으면 단계는 서버가 앞으로만 바꾼다(#607, PM 결정 2026-11-12로 #433의 "한 번 묻기"를 바꿈).
// 서버 호출(postNote·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  getSalesQuestions: vi.fn(() => new Promise(() => {})),
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

  it('연결됐으면 AI 판단이 맞았나를 골라 함께 저장하고, 부재면 묻지 않는다(#531)', async () => {
    const user = userEvent.setup();
    renderArea({ outcome: outcome('IN_PROGRESS') });
    await user.selectOptions(screen.getByTestId('records-kind'), '방문');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '부재');
    expect(screen.queryByTestId('records-judgment-check')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await user.selectOptions(screen.getByTestId('records-judgment-check'), '맞음');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalled());
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({
      result: 'REACHED',
      judgmentCheck: 'MATCHED',
    });
  });

  it('AI 판단을 고르지 않아도 접촉은 저장된다(#531)', async () => {
    const user = userEvent.setup();
    renderArea({ outcome: outcome('IN_PROGRESS') });
    await saveContact(user);
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalled());
    expect(mockedOutcome.mock.calls[0][1]).not.toHaveProperty('judgmentCheck');
  });

  it('머리에 "한 일 적기 → 다음 할 일" 안내 한 줄이 보이고, 두 칸 제목 앞에 ①②가 붙는다(영업 단계는 접힌 칸이라 번호가 없다, #674)', () => {
    renderArea();
    // 영업 단계 칸은 기본으로 접혀 있다(#674). [단계 고치기]를 눌러 펼친다.
    fireEvent.click(screen.getByTestId('records-stage-toggle'));
    expect(screen.getByTestId('records-flow-guide')).toHaveTextContent(recordsArea.flowGuide);
    expect(screen.getByTestId('records-step-1')).toHaveTextContent('①');
    expect(screen.getByTestId('records-step-2')).toHaveTextContent('②');
    expect(screen.queryByTestId('records-step-3')).not.toBeInTheDocument();
    // ②는 "다음 일정" 제목 앞에 붙는다.
    expect(screen.getByTestId('records-step-2').parentElement).toHaveTextContent(
      recordsArea.scheduleTitle,
    );
    // 번호는 그림 글자라 제목의 낭독 이름은 그대로다.
    expect(screen.getByRole('heading', { name: recordsArea.entryTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.stageTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recordsArea.scheduleTitle })).toBeInTheDocument();
  });
});

describe('기록 구역 · 영업 단계 칸은 접어 둔다 (#674, PM 지시 2026-11-13)', () => {
  beforeEach(() => {
    mockedOutcome.mockReset();
    mockedNote.mockReset();
  });

  it('처음에는 "단계가 잘못됐나요? [단계 고치기]" 한 줄만 보이고 단계 선택 칸·현재 단계 글은 숨겨져 있다', () => {
    renderArea({ outcome: outcome('IN_PROGRESS') });
    const line = screen.getByTestId('records-stage-fix');
    expect(line).toHaveTextContent('단계가 잘못됐나요?');
    const toggle = screen.getByTestId('records-stage-toggle');
    expect(toggle).toHaveTextContent('단계 고치기');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const id of [
      'records-stage-select',
      'records-stage-save-button',
      'records-stage-current',
      'records-stage-auto-hint',
      'records-step-override',
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: recordsArea.stageTitle })).not.toBeInTheDocument();
    // 기록 남기기와 다음 일정은 그대로 펼쳐져 있다.
    expect(screen.getByTestId('records-kind')).toBeInTheDocument();
    expect(screen.getByTestId('records-schedule-date')).toBeInTheDocument();
  });

  it('[단계 고치기]를 누르면 그 자리에서 펼쳐져 단계를 저장할 수 있고, 다시 누르면 접힌다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(reply('ON_HOLD'));
    renderArea({ outcome: outcome('IN_PROGRESS') });
    const toggle = screen.getByTestId('records-stage-toggle');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('접기');
    expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 접촉');
    expect(screen.getByTestId('records-stage-auto-hint')).toHaveTextContent(
      recordsArea.stageAutoHint,
    );
    await user.selectOptions(screen.getByTestId('records-stage-select'), '보류');
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({ status: 'ON_HOLD' });
    // 저장 뒤에도 펼친 채로 남아 바뀐 단계와 "저장됨"이 보인다.
    expect(await screen.findByTestId('records-stage-current')).toHaveTextContent('현재 단계: 보류');
    expect(screen.getByTestId('records-stage-saved')).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('records-stage-select')).not.toBeInTheDocument();
  });

  it('세부 단계 고치기도 같은 접힌 자리 안에 있다', async () => {
    const user = userEvent.setup();
    renderArea({
      outcome: outcome('IN_PROGRESS'),
      salesStep: {
        code: 'REACHED',
        since: '2026-11-10',
        overridden: false,
        known: [],
        openQuestions: [],
      },
    });
    expect(screen.queryByTestId('records-step-override')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-stage-toggle'));
    const body = screen.getByTestId('records-stage-body');
    expect(body).toContainElement(screen.getByTestId('records-stage-select'));
    expect(body).toContainElement(screen.getByTestId('records-step-override'));
    expect(body).toContainElement(screen.getByTestId('records-step-override-save'));
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

describe('기록 구역 · ③ 접촉 뒤 단계는 서버가 앞으로만 바꾼다 (#607이 #433의 묻기를 바꿈)', () => {
  beforeEach(() => {
    mockedOutcome.mockReset();
  });

  it('미접촉 회사에 접촉을 적으면 지금 단계를 그대로 보내고, 서버가 바꾼 "접촉"을 보이며 묻지 않는다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockResolvedValueOnce(reply('IN_PROGRESS'));
    const onSalesStepChanged = vi.fn();
    renderArea({ onSalesStepChanged });
    // 영업 단계 칸은 기본으로 접혀 있다(#674). [단계 고치기]를 눌러 펼친다.
    fireEvent.click(screen.getByTestId('records-stage-toggle'));
    await saveContact(user);
    await waitFor(() =>
      expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 접촉'),
    );
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({
      status: 'NOT_EXECUTED',
      method: 'VISIT',
    });
    expect(screen.queryByTestId('records-stage-suggestion')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-stage-auto-hint')).toHaveTextContent(
      recordsArea.stageAutoHint,
    );
    expect(onSalesStepChanged).toHaveBeenCalledTimes(1);
  });

  it.each(['IN_PROGRESS', 'ON_HOLD', 'WON'] as const)(
    '이미 %s 단계면 접촉을 적어도 단계를 그대로 보낸다',
    async (status) => {
      const user = userEvent.setup();
      mockedOutcome.mockResolvedValueOnce(reply(status));
      renderArea({ outcome: outcome(status) });
      await saveContact(user);
      await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
      expect(mockedOutcome.mock.calls[0][1]).toMatchObject({ status });
    },
  );

  it('접촉 저장이 실패하면 세부 단계를 다시 불러오지 않는다', async () => {
    const user = userEvent.setup();
    mockedOutcome.mockRejectedValueOnce(
      new ApiError(500, { message: '서버 오류', nextAction: '', ref: 'r3' }),
    );
    const onSalesStepChanged = vi.fn();
    renderArea({ outcome: outcome('NOT_EXECUTED'), onSalesStepChanged });
    await saveContact(user);
    await screen.findByTestId('records-contact-error');
    expect(onSalesStepChanged).not.toHaveBeenCalled();
  });

  it('메모만 남기면 단계를 건드리지 않는다', async () => {
    const user = userEvent.setup();
    mockedNote.mockResolvedValueOnce({
      data: { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-08T01:00:00Z', noteId: 'n-1' },
      meta: {},
    });
    renderArea({ outcome: outcome('NOT_EXECUTED') });
    await user.type(screen.getByTestId('records-note-input'), '그냥 메모');
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() => expect(mockedNote).toHaveBeenCalledTimes(1));
    expect(mockedOutcome).not.toHaveBeenCalled();
  });
});
