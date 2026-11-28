// #983 바로 일정 잡기 칸(영업 홈 표 · 기업 상세가 같이 쓰는 부품).
// 서버 요청(회사 상세 읽기 · 영업 결과 저장 · 질문 파일)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// 회사 이름 · 번호는 모두 가상이다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScheduleQuickEdit from '../ScheduleQuickEdit';
import { resetScheduleQuestions, scheduleKindsOf } from '../scheduleKinds';
import {
  ApiError,
  getOpportunityDetail,
  getSalesQuestions,
  postOutcome,
} from '../../../api/client';
import { SCHEDULE_CHANGED_EVENT } from '../../../api/assistant';
import type {
  ConfigUi,
  OpportunityDetail,
  OutcomeRecord,
  SalesQuestions,
} from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  postOutcome: vi.fn(),
  getSalesQuestions: vi.fn(),
}));

const mockedDetail = vi.mocked(getOpportunityDetail);
const mockedPost = vi.mocked(postOutcome);
const mockedQuestions = vi.mocked(getSalesQuestions);

const TODAY = '2026-11-28';

/** 질문 파일(가상): "다음 할 일은?"의 보기 가운데 "끝"만 마무리 질문을 연다. */
const QUESTIONS = {
  version: 1,
  steps: [],
  questions: [
    {
      questionId: 'NEXT_ACTION',
      text: '다음 할 일은?',
      step: 'ALL',
      answers: [
        { answerId: 'CALL_AGAIN', label: '다시 전화' },
        { answerId: 'SEND_QUOTE', label: '견적 보내기' },
        // 기본 세 가지와 같은 이름은 한 번만 보인다.
        { answerId: 'MAIL', label: '메일' },
        { answerId: 'END', label: '끝' },
      ],
    },
    {
      questionId: 'CLOSING',
      text: '어떻게 끝났나요?',
      step: 'ALL',
      showWhen: { answers: { NEXT_ACTION: ['END'] } },
      answers: [
        { answerId: 'WON', label: '성사', closes: 'WON' },
        { answerId: 'LOST', label: '거절', closes: 'LOST' },
      ],
    },
  ],
} as unknown as SalesQuestions;

function detail(outcome: Partial<OutcomeRecord> | null, evalId: string | null = 'eval-7') {
  return {
    data: {
      evalId,
      records: {
        outcome: outcome
          ? {
              version: 3,
              updatedBy: 'park-lee',
              updatedAt: '2026-11-20T09:00:00+09:00',
              ...outcome,
            }
          : null,
      },
    } as unknown as OpportunityDetail,
    meta: {},
  } as Awaited<ReturnType<typeof getOpportunityDetail>>;
}

function saved(nextScheduleAt: string) {
  return {
    data: {
      status: 'IN_PROGRESS',
      version: 4,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-28T10:00:00+09:00',
      nextScheduleAt,
    },
    meta: {},
  } as unknown as Awaited<ReturnType<typeof postOutcome>>;
}

function apiError(status: number, message: string, nextAction = '다시 시도해 주세요.') {
  return new ApiError(status, { message, nextAction, ref: 'r-1', kind: 'TEST' });
}

interface Options {
  staffKey?: string | null;
  canRecord?: boolean;
  currentScheduleAt?: string | null;
  currentScheduleNote?: string | null;
  config?: ConfigUi | null;
}

function renderEdit(options: Options = {}) {
  const staffKey = options.staffKey === undefined ? 'park-lee' : options.staffKey;
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const onReload = vi.fn();
  render(
    <FrameContext.Provider
      value={{
        config: options.config ?? null,
        staffKey,
        setStaffKey: () => {},
        canRecord: options.canRecord ?? staffKey !== null,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <ScheduleQuickEdit
        oppId="opp-가상/1"
        currentScheduleAt={options.currentScheduleAt ?? null}
        currentScheduleNote={options.currentScheduleNote ?? null}
        today={TODAY}
        onSaved={onSaved}
        onCancel={onCancel}
        onReload={onReload}
      />
    </FrameContext.Provider>,
  );
  return { onSaved, onCancel, onReload };
}

const dateInput = () => screen.getByTestId('schedule-quick-date');
const kindSelect = () => screen.getByTestId('schedule-quick-kind') as HTMLSelectElement;
const noteInput = () => screen.getByTestId('schedule-quick-note');
const saveButton = () => screen.getByTestId('schedule-quick-save');

function pickDate(value: string) {
  fireEvent.change(dateInput(), { target: { value } });
}

/** 질문 파일을 다 읽어 종류 목록이 채워질 때까지 기다린다. */
async function kindsLoaded() {
  await waitFor(() =>
    expect(within(kindSelect()).getAllByRole('option').length).toBeGreaterThan(4),
  );
}

let events: string[] = [];
const onEvent = (event: Event) => events.push((event as CustomEvent<string>).detail);

beforeEach(() => {
  resetScheduleQuestions();
  mockedDetail.mockReset();
  mockedPost.mockReset();
  mockedQuestions.mockReset();
  mockedQuestions.mockResolvedValue({ data: QUESTIONS, meta: {} });
  events = [];
  window.addEventListener(SCHEDULE_CHANGED_EVENT, onEvent);
});

afterEach(() => {
  window.removeEventListener(SCHEDULE_CHANGED_EVENT, onEvent);
});

describe('모양', () => {
  it('날짜 · 종류 · 내용 칸과 [저장] [취소], 아래 안내 줄이 보이고, 날짜는 오늘 이후만 고를 수 있다', async () => {
    renderEdit({ currentScheduleAt: '2026-11-18', currentScheduleNote: '방문' });
    expect(screen.getByRole('group', { name: '다음 일정 잡기' })).toBeInTheDocument();
    expect(screen.getByLabelText('날짜')).toBe(dateInput());
    expect(dateInput()).toHaveAttribute('type', 'date');
    expect(dateInput()).toHaveAttribute('min', TODAY);
    expect(screen.getByLabelText('종류')).toBe(kindSelect());
    expect(screen.getByLabelText('내용')).toBe(noteInput());
    expect(saveButton()).toHaveTextContent(/^저장$/);
    expect(screen.getByTestId('schedule-quick-cancel')).toHaveTextContent(/^취소$/);
    // 지난 일정(11/18, 오늘 11/28)은 "(지남)"이 붙고, 날짜 칸은 비워 둔다(지난 날짜는 저장할 수 없다).
    expect(screen.getByTestId('schedule-quick-current')).toHaveTextContent(
      /^지금 일정: 11\/18 방문 \(지남\) → 저장하면 이 일정으로 바뀌고 달력에도 바로 보입니다 종류를 고르면 내용이 채워지고 고쳐 쓸 수 있습니다$/,
    );
    expect(dateInput()).toHaveValue('');
    expect(noteInput()).toHaveValue('방문');
    // 날짜를 고르기 전에는 [저장]이 눌리지 않는다.
    expect(saveButton()).toBeDisabled();
    await kindsLoaded();
  });

  it('앞으로 잡힌 일정은 그 날짜로 시작하고 "(지남)"이 붙지 않으며, 일정이 없으면 "지금 일정 없음"이라고 보인다', async () => {
    renderEdit({ currentScheduleAt: '2026-12-02', currentScheduleNote: null });
    expect(dateInput()).toHaveValue('2026-12-02');
    expect(screen.getByTestId('schedule-quick-current')).toHaveTextContent(
      '지금 일정: 12/2 → 저장하면 이 일정으로 바뀌고',
    );
    expect(saveButton()).toBeEnabled();
    await kindsLoaded();
  });

  it('일정이 없으면 안내 줄이 "지금 일정 없음"으로 시작한다', async () => {
    renderEdit();
    expect(screen.getByTestId('schedule-quick-current')).toHaveTextContent(
      /^지금 일정 없음 → 저장하면 달력에도 바로 보입니다 /,
    );
    await kindsLoaded();
  });

  it('종류 목록은 기업 상세의 일정 칸과 같다: 대면 · 전화 · 메일 + 질문 파일 "다음 할 일"의 끝이 아닌 보기(같은 이름은 한 번)', async () => {
    renderEdit();
    await kindsLoaded();
    expect(
      within(kindSelect())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['종류 고르기', '대면', '전화', '메일', '다시 전화', '견적 보내기']);
    expect(scheduleKindsOf(QUESTIONS)).toEqual([
      '대면',
      '전화',
      '메일',
      '다시 전화',
      '견적 보내기',
    ]);
    // 질문 파일이 없으면 기본 세 가지만.
    expect(scheduleKindsOf(null)).toEqual(['대면', '전화', '메일']);
    // 질문 파일은 한 번만 읽는다.
    expect(mockedQuestions).toHaveBeenCalledTimes(1);
  });

  it('질문 파일을 못 읽어도 대면 · 전화 · 메일은 고를 수 있고 내용은 직접 적을 수 있다', async () => {
    mockedQuestions.mockReset();
    mockedQuestions.mockRejectedValue(apiError(500, '질문을 읽지 못했습니다.'));
    renderEdit();
    await waitFor(() => expect(mockedQuestions).toHaveBeenCalledTimes(1));
    expect(
      within(kindSelect())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['종류 고르기', '대면', '전화', '메일']);
    await userEvent.type(noteInput(), '샘플 들고 방문');
    expect(noteInput()).toHaveValue('샘플 들고 방문');
  });

  it('종류를 고르면 내용이 그 이름으로 채워지고, 고쳐 쓰면 종류는 "종류 고르기"로 돌아간다', async () => {
    renderEdit();
    await kindsLoaded();
    await userEvent.selectOptions(kindSelect(), '견적 보내기');
    expect(noteInput()).toHaveValue('견적 보내기');
    expect(kindSelect()).toHaveValue('견적 보내기');
    await userEvent.type(noteInput(), ' · 두께 요구 확인');
    expect(noteInput()).toHaveValue('견적 보내기 · 두께 요구 확인');
    expect(kindSelect()).toHaveValue('');
    // 다른 종류를 고르면 내용이 그 이름으로 바뀐다.
    await userEvent.selectOptions(kindSelect(), '대면');
    expect(noteInput()).toHaveValue('대면');
  });

  it('[취소]를 누르면 알리기만 하고 서버에는 아무것도 보내지 않는다', async () => {
    const { onCancel } = renderEdit();
    await kindsLoaded();
    await userEvent.click(screen.getByTestId('schedule-quick-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockedDetail).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe('저장: 기업 상세의 [일정 잡기]와 같은 본문', () => {
  it('Given 접촉 단계인 회사 When 날짜 · 종류 · 내용을 넣고 [저장] Then 상세를 한 번 읽고 지금 단계 그대로 + 다음 일정을 한 번 보낸다', async () => {
    mockedDetail.mockResolvedValueOnce(
      detail({ status: 'IN_PROGRESS', nextScheduleAt: '2026-11-18' }),
    );
    mockedPost.mockResolvedValueOnce(saved('2026-12-02'));
    const { onSaved } = renderEdit({
      currentScheduleAt: '2026-11-18',
      currentScheduleNote: '방문',
    });
    await kindsLoaded();
    pickDate('2026-12-02');
    await userEvent.selectOptions(kindSelect(), '다시 전화');
    await userEvent.type(noteInput(), ' · 샘플 결과 묻기  ');
    await userEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // 회사 번호의 특수 글자는 요청 함수가 주소로 바꾼다. 이 부품은 번호를 그대로 넘긴다.
    expect(mockedDetail).toHaveBeenCalledTimes(1);
    expect(mockedDetail).toHaveBeenCalledWith('opp-가상/1');
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      'opp-가상/1',
      {
        evalId: 'eval-7',
        status: 'IN_PROGRESS',
        nextScheduleAt: '2026-12-02',
        // 앞뒤 공백은 지운다.
        nextScheduleNote: '다시 전화 · 샘플 결과 묻기',
      },
      'park-lee',
    );
    // 서버가 돌려준 새 기록을 그대로 알린다.
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4, nextScheduleAt: '2026-12-02' }),
    );
    expect(screen.queryByTestId('schedule-quick-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('schedule-quick-saved')).toHaveTextContent(/^저장됨$/);
  });

  it('저장되면 창(window)에 일정이 바뀌었다고 한 번 알린다(영업 홈 · 왼쪽 달력 · 메뉴 숫자가 다시 읽는다)', async () => {
    mockedDetail.mockResolvedValueOnce(detail({ status: 'IN_PROGRESS' }));
    mockedPost.mockResolvedValueOnce(saved('2026-12-02'));
    const { onSaved } = renderEdit();
    await kindsLoaded();
    pickDate('2026-12-02');
    await userEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(events).toEqual(['opp-가상/1']);
  });

  it('영업 기록이 아직 없는 회사는 단계를 NOT_EXECUTED로 보내고, 내용이 비어 있으면 내용 칸을 보내지 않는다', async () => {
    mockedDetail.mockResolvedValueOnce(detail(null, null));
    mockedPost.mockResolvedValueOnce(saved('2026-11-28'));
    const { onSaved } = renderEdit();
    await kindsLoaded();
    // 오늘 날짜도 고를 수 있다.
    pickDate(TODAY);
    await userEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // 평가 번호가 없으면 보내지 않는다.
    expect(mockedPost).toHaveBeenCalledWith(
      'opp-가상/1',
      { status: 'NOT_EXECUTED', nextScheduleAt: TODAY },
      'park-lee',
    );
  });

  it('거절 상태인 회사는 서버가 이유를 요구하므로 지금 거절 이유 코드를 이어 보낸다', async () => {
    mockedDetail.mockResolvedValueOnce(detail({ status: 'LOST', lostReasonCode: 'PRICE' }));
    mockedPost.mockResolvedValueOnce(saved('2026-12-10'));
    const { onSaved } = renderEdit();
    await kindsLoaded();
    pickDate('2026-12-10');
    await userEvent.selectOptions(kindSelect(), '전화');
    await userEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(
      'opp-가상/1',
      {
        evalId: 'eval-7',
        status: 'LOST',
        nextScheduleAt: '2026-12-10',
        nextScheduleNote: '전화',
        lostReasonCode: 'PRICE',
      },
      'park-lee',
    );
  });

  it('거절이 아닌 단계에는 거절 이유 코드를 보내지 않는다(서버가 400으로 막는 값)', async () => {
    mockedDetail.mockResolvedValueOnce(detail({ status: 'ON_HOLD', lostReasonCode: null }));
    mockedPost.mockResolvedValueOnce(saved('2026-12-10'));
    const { onSaved } = renderEdit();
    await kindsLoaded();
    pickDate('2026-12-10');
    await userEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][1]).toEqual({
      evalId: 'eval-7',
      status: 'ON_HOLD',
      nextScheduleAt: '2026-12-10',
    });
  });

  it('지난 날짜는 저장할 수 없다: 안내가 보이고 [저장]이 눌리지 않으며 서버를 부르지 않는다', async () => {
    renderEdit();
    await kindsLoaded();
    pickDate('2026-11-27');
    expect(screen.getByTestId('schedule-quick-date-error')).toHaveTextContent(
      '오늘이나 그 뒤 날짜를 골라 주세요',
    );
    expect(dateInput()).toHaveAttribute('aria-invalid', 'true');
    expect(saveButton()).toBeDisabled();
    await userEvent.click(saveButton());
    expect(mockedDetail).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('저장하는 동안에는 [저장]이 다시 눌리지 않아 같은 일정을 두 번 보내지 않는다', async () => {
    let finish: (value: Awaited<ReturnType<typeof postOutcome>>) => void = () => {};
    mockedDetail.mockResolvedValue(detail({ status: 'IN_PROGRESS' }));
    mockedPost.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { onSaved } = renderEdit();
    await kindsLoaded();
    pickDate('2026-12-02');
    await userEvent.click(saveButton());
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(saveButton());
    finish(saved('2026-12-02'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockedDetail).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});

describe('실패를 성공처럼 넘기지 않는다', () => {
  it('회사 상세를 못 읽으면 저장 요청을 보내지 않고 이유를 알리며, 입력은 그대로 둔다', async () => {
    mockedDetail.mockRejectedValueOnce(apiError(500, '상세를 가져오지 못했습니다.'));
    const { onSaved } = renderEdit();
    await kindsLoaded();
    pickDate('2026-12-02');
    await userEvent.selectOptions(kindSelect(), '대면');
    await userEvent.click(saveButton());
    const alert = await screen.findByTestId('schedule-quick-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(
      /^지금 단계를 읽지 못해 저장하지 않았습니다\. 다시 시도 \(상세를 가져오지 못했습니다\.\)$/,
    );
    expect(mockedPost).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(screen.queryByTestId('schedule-quick-saved')).not.toBeInTheDocument();
    expect(dateInput()).toHaveValue('2026-12-02');
    expect(noteInput()).toHaveValue('대면');
    // 다시 누를 수 있다.
    expect(saveButton()).toBeEnabled();
  });

  it('저장이 실패하면(서버 오류) 서버가 준 이유와 함께 알리고, 저장됐다고 알리지 않으며 다시 보내지 않는다', async () => {
    mockedDetail.mockResolvedValueOnce(detail({ status: 'IN_PROGRESS' }));
    mockedPost.mockRejectedValueOnce(apiError(400, '날짜가 올바르지 않습니다.'));
    const { onSaved } = renderEdit();
    await kindsLoaded();
    pickDate('2026-12-02');
    await userEvent.click(saveButton());
    expect(await screen.findByTestId('schedule-quick-error')).toHaveTextContent(
      /^저장하지 못했습니다\. 다시 시도 \(날짜가 올바르지 않습니다\.\)$/,
    );
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(screen.queryByTestId('schedule-quick-saved')).not.toBeInTheDocument();
    // 그 사이 바뀐 것이 아니므로 [다시 읽기]는 없다.
    expect(screen.queryByTestId('schedule-quick-reload')).not.toBeInTheDocument();
    expect(dateInput()).toHaveValue('2026-12-02');
  });

  it('연결이 끊겨 저장하지 못하면 연결 안내를 붙여 알린다', async () => {
    mockedDetail.mockResolvedValueOnce(detail({ status: 'IN_PROGRESS' }));
    mockedPost.mockRejectedValueOnce(new TypeError('network'));
    renderEdit();
    await kindsLoaded();
    pickDate('2026-12-02');
    await userEvent.click(saveButton());
    const alert = await screen.findByTestId('schedule-quick-error');
    expect(alert).toHaveTextContent(/^저장하지 못했습니다\. 다시 시도 \(.+\)$/);
    expect(events).toEqual([]);
  });

  it('그 사이 다른 기록이 저장돼 서버가 막으면(409) 서버 안내를 그대로 보이고 [다시 읽기]로 다시 읽게 한다', async () => {
    mockedDetail.mockResolvedValueOnce(detail({ status: 'IN_PROGRESS' }));
    mockedPost.mockRejectedValueOnce(
      apiError(409, '그 사이 다른 기록이 저장됐습니다.', '새로 불러온 뒤 다시 저장해 주세요.'),
    );
    const { onSaved, onReload } = renderEdit();
    await kindsLoaded();
    pickDate('2026-12-02');
    await userEvent.click(saveButton());
    const alert = await screen.findByTestId('schedule-quick-error');
    expect(alert).toHaveTextContent(
      /^그 사이 다른 기록이 저장됐습니다\. 새로 불러온 뒤 다시 저장해 주세요\. 다시 읽기$/,
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    await userEvent.click(within(alert).getByTestId('schedule-quick-reload'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('보기 전용 · 담당자 미선택', () => {
  it.each([
    ['보기 전용', { staffKey: 'viewer', canRecord: false }],
    ['담당자 미선택', { staffKey: null, canRecord: false }],
  ])(
    '%s이면 칸과 [저장]이 잠기고 "먼저 담당자를 고르세요"가 보이며 서버를 부르지 않는다',
    async (_name, frame) => {
      renderEdit({ ...frame, currentScheduleAt: '2026-12-02' });
      expect(screen.getByTestId('schedule-quick-pick-staff')).toHaveTextContent(
        /^먼저 담당자를 고르세요$/,
      );
      expect(dateInput()).toBeDisabled();
      expect(kindSelect()).toBeDisabled();
      expect(noteInput()).toBeDisabled();
      expect(saveButton()).toBeDisabled();
      await userEvent.click(saveButton());
      expect(mockedDetail).not.toHaveBeenCalled();
      expect(mockedPost).not.toHaveBeenCalled();
    },
  );

  it('기록할 수 있는 담당자에게는 안내가 없고, 내용 글자 수는 설정 값(없으면 200자)까지다', async () => {
    renderEdit({ config: { records: { noteMaxLength: 120 } } as unknown as ConfigUi });
    expect(screen.queryByTestId('schedule-quick-pick-staff')).not.toBeInTheDocument();
    expect(noteInput()).toHaveAttribute('maxlength', '120');
    await kindsLoaded();
  });
});
