// 메모 읽기 화면 부품(#720): 방금 저장한 메모 아래의 [AI가 메모 읽기 💰]와 제안 줄의 [반영].
// 요청 함수는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다. 메모 속 이름은 지어낸 것이다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { postMemoRead } from '../../../api/assistant';
import type { MemoReadAnswer } from '../../../api/assistant';
import {
  ApiError,
  getActivity,
  getSalesQuestions,
  postIndustries,
  postNote,
  postOutcome,
} from '../../../api/client';
import type { ConfigUi, OutcomeRecord, SalesQuestions } from '../../../api/types';
import { memoReadTexts as texts, recordsArea } from '../../../labels/ko';
import { FrameContext } from '../../frame/FrameContext';
import RecordsArea from '../../records/RecordsArea';
import MemoRead from '../MemoRead';
import type { MemoTarget } from '../MemoRead';

vi.mock('../../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/assistant')>()),
  postMemoRead: vi.fn(),
}));
vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getActivity: vi.fn(),
  getSalesQuestions: vi.fn(),
  postIndustries: vi.fn(),
  postNote: vi.fn(),
  postOutcome: vi.fn(),
}));

const mockedRead = vi.mocked(postMemoRead);
const mockedOutcome = vi.mocked(postOutcome);
const mockedIndustries = vi.mocked(postIndustries);
const mockedActivity = vi.mocked(getActivity);

const ON = {
  assistant: { enabled: true, questionMaxLength: 300 },
  records: { noteMaxLength: 200 },
} as unknown as ConfigUi;
const OFF = {
  assistant: { enabled: false, questionMaxLength: 300 },
  records: { noteMaxLength: 200 },
} as unknown as ConfigUi;

const NOTE: MemoTarget = { recordKind: 'NOTE', recordId: 'note-1' };
const IN_PROGRESS: OutcomeRecord = {
  version: 2,
  updatedBy: 'park-lee',
  updatedAt: '2026-11-14T02:00:00Z',
  status: 'IN_PROGRESS',
};
const meta = { updatedAt: '2026-11-14T03:00:00Z', hasVirtualData: true };

const answer: MemoReadAnswer = {
  summary: '공정을 니켈도금으로 바꾸려 함. 수요일 샘플 예정',
  proposals: [
    {
      kind: 'PROCESS',
      values: ['NICKEL_PLATING'],
      before: ['아연도금'],
      after: ['니켈도금'],
      date: null,
      quote: '니켈도금으로 바꾸고 싶다고 함',
    },
    {
      kind: 'INDUSTRY',
      values: ['반도체'],
      before: [],
      after: ['반도체'],
      date: null,
      quote: '반도체 장비 부품',
    },
    {
      kind: 'NEXT_SCHEDULE',
      values: ['SEND_MATERIAL'],
      before: ['11/20 견적'],
      after: ['자료 보내기'],
      date: '2026-11-18',
      quote: '수요일 샘플',
    },
  ],
  aiGenerated: true,
  removedNames: 1,
  removedContacts: 1,
};

function wrap(
  node: React.ReactNode,
  config: ConfigUi | null = ON,
  staff: { staffKey: string | null; canRecord: boolean } = {
    staffKey: 'park-lee',
    canRecord: true,
  },
) {
  return render(
    <FrameContext.Provider
      value={{
        config,
        ...staff,
        setStaffKey: () => {},
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      {node}
    </FrameContext.Provider>,
  );
}

function renderMemoRead(
  props: Partial<React.ComponentProps<typeof MemoRead>> = {},
  config: ConfigUi | null = ON,
) {
  const onApplied = vi.fn();
  wrap(
    <MemoRead
      oppId="opp-1"
      target={NOTE}
      outcome={IN_PROGRESS}
      processQuestionId="CONFIRM_PROCESS"
      onApplied={onApplied}
      {...props}
    />,
    config,
  );
  return onApplied;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRead.mockResolvedValue({ data: answer, meta });
  mockedOutcome.mockResolvedValue({
    data: { version: 3, updatedBy: 'park-lee', updatedAt: meta.updatedAt, status: 'IN_PROGRESS' },
    meta,
  });
  mockedIndustries.mockResolvedValue({
    data: { industries: ['반도체'], industriesSource: 'STAFF', industriesConfirmedAt: null },
    meta,
  } as Awaited<ReturnType<typeof postIndustries>>);
});

describe('[AI가 메모 읽기 💰] 단추 (#720)', () => {
  it('영업 기록 스위치가 꺼져 있거나 방금 저장한 메모가 없으면 아무것도 보이지 않는다', () => {
    renderMemoRead({}, OFF);
    expect(screen.queryByTestId('memo-read')).not.toBeInTheDocument();
    renderMemoRead({ target: null });
    expect(screen.queryByTestId('memo-read')).not.toBeInTheDocument();
    renderMemoRead({}, null);
    expect(screen.queryByTestId('memo-read')).not.toBeInTheDocument();
  });

  it('저절로 부르지 않고, 누르면 그 아래에 "확인 전" 표시·한 줄 요약·제안 줄이 펴진다', async () => {
    const user = userEvent.setup();
    renderMemoRead();
    expect(screen.getByTestId('memo-read-button')).toHaveTextContent('AI가 메모 읽기 💰');
    expect(mockedRead).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('memo-read-button'));
    await waitFor(() => expect(screen.getByTestId('memo-read-answer')).toBeInTheDocument());
    expect(mockedRead).toHaveBeenCalledWith('opp-1', 'NOTE', 'note-1', 'park-lee');
    expect(screen.getByTestId('memo-read-title')).toHaveTextContent(
      'AI가 메모에서 읽은 것 · 확인 전',
    );
    expect(screen.getByTestId('memo-read-summary')).toHaveTextContent(answer.summary);
    expect(screen.getByTestId('memo-read-proposal-PROCESS')).toHaveTextContent(
      "공정: 아연도금 → 니켈도금(메모: '니켈도금으로 바꾸고 싶다고 함')반영",
    );
    expect(screen.getByTestId('memo-read-proposal-INDUSTRY')).toHaveTextContent(
      "산업: 반도체(메모: '반도체 장비 부품')",
    );
    expect(screen.getByTestId('memo-read-proposal-NEXT_SCHEDULE')).toHaveTextContent(
      "다음 일정: 11/20 견적 → 11/18 자료 보내기(메모: '수요일 샘플')",
    );
    expect(screen.getByTestId('memo-read-removed')).toHaveTextContent(
      '이름 1개 · 연락처 1개를 지우고 보냈습니다.',
    );
    // 누르기 전에는 아무것도 저장하지 않는다.
    expect(mockedOutcome).not.toHaveBeenCalled();
    expect(mockedIndustries).not.toHaveBeenCalled();
  });

  it('제안이 없으면 "바꿀 것은 읽지 못했습니다."를 보인다', async () => {
    const user = userEvent.setup();
    mockedRead.mockResolvedValue({
      data: {
        ...answer,
        summary: '안부만 나눔',
        proposals: [],
        removedNames: 0,
        removedContacts: 0,
      },
      meta,
    });
    renderMemoRead();
    await user.click(screen.getByTestId('memo-read-button'));
    await waitFor(() =>
      expect(screen.getByTestId('memo-read-empty')).toHaveTextContent(texts.noProposals),
    );
    expect(screen.queryByTestId('memo-read-removed')).not.toBeInTheDocument();
  });

  it('실패하면 서버 문장을 그대로 보인다', async () => {
    const user = userEvent.setup();
    mockedRead.mockRejectedValue(
      new ApiError(422, { message: '영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다.' }),
    );
    renderMemoRead();
    await user.click(screen.getByTestId('memo-read-button'));
    await waitFor(() =>
      expect(screen.getByTestId('memo-read-error')).toHaveTextContent(
        '메모를 읽지 못했습니다. (영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다.)',
      ),
    );
    expect(screen.queryByTestId('memo-read-answer')).not.toBeInTheDocument();
  });

  it('접촉 기록의 한 줄 메모는 저장 시각으로 활동 이력에서 기록 번호를 찾아 부른다', async () => {
    const user = userEvent.setup();
    mockedActivity.mockResolvedValue({
      data: [
        {
          at: '2026-11-14T03:00:00+00:00',
          actor: 'park-lee',
          kind: 'CONTACT_ATTEMPT',
          summary: '전화 · 연결됨',
          recordId: 'outcome-9',
          recordKind: 'OUTCOME',
        },
        {
          at: '2026-11-13T03:00:00+00:00',
          actor: 'park-lee',
          kind: 'CONTACT_ATTEMPT',
          summary: '전화 · 부재',
          recordId: 'outcome-8',
          recordKind: 'OUTCOME',
        },
      ],
      meta,
    } as Awaited<ReturnType<typeof getActivity>>);
    renderMemoRead({ target: { recordKind: 'OUTCOME', savedAt: '2026-11-14T03:00:00Z' } });
    await user.click(screen.getByTestId('memo-read-button'));
    await waitFor(() =>
      expect(mockedRead).toHaveBeenCalledWith('opp-1', 'OUTCOME', 'outcome-9', 'park-lee'),
    );
  });

  it('활동 이력에서 그 기록을 못 찾으면 부르지 않고 알린다', async () => {
    const user = userEvent.setup();
    mockedActivity.mockResolvedValue({ data: [], meta } as Awaited<ReturnType<typeof getActivity>>);
    renderMemoRead({ target: { recordKind: 'OUTCOME', savedAt: '2026-11-14T03:00:00Z' } });
    await user.click(screen.getByTestId('memo-read-button'));
    await waitFor(() =>
      expect(screen.getByTestId('memo-read-error')).toHaveTextContent(texts.notFound),
    );
    expect(mockedRead).not.toHaveBeenCalled();
  });
});

describe('제안 [반영]은 기존 저장 창구를 부른다 (#720)', () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('memo-read-button'));
    await waitFor(() => expect(screen.getByTestId('memo-read-answer')).toBeInTheDocument());
  }

  it('공정: 접촉 없이 공정 확인 답만 영업 기록 저장으로 보내고 "반영됨 ✓"로 바뀐다', async () => {
    const user = userEvent.setup();
    const onApplied = renderMemoRead();
    await open(user);
    await user.click(screen.getByTestId('memo-read-apply-PROCESS'));
    await waitFor(() =>
      expect(screen.getByTestId('memo-read-applied-PROCESS')).toHaveTextContent('반영됨 ✓'),
    );
    expect(mockedOutcome).toHaveBeenCalledWith(
      'opp-1',
      {
        status: 'IN_PROGRESS',
        answers: [{ questionId: 'CONFIRM_PROCESS', answerId: 'NICKEL_PLATING' }],
      },
      'park-lee',
    );
    expect(onApplied).toHaveBeenCalledWith('PROCESS', expect.objectContaining({ version: 3 }));
    // 다른 제안은 그대로 [반영]을 기다린다.
    expect(screen.getByTestId('memo-read-apply-INDUSTRY')).toBeInTheDocument();
  });

  it('산업: 산업군 저장 창구로 보낸다', async () => {
    const user = userEvent.setup();
    const onApplied = renderMemoRead();
    await open(user);
    await user.click(screen.getByTestId('memo-read-apply-INDUSTRY'));
    await waitFor(() =>
      expect(screen.getByTestId('memo-read-applied-INDUSTRY')).toBeInTheDocument(),
    );
    expect(mockedIndustries).toHaveBeenCalledWith('opp-1', ['반도체'], 'park-lee');
    expect(mockedOutcome).not.toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledWith('INDUSTRY', null);
  });

  it('다음 일정: 날짜와 할 일 이름을 영업 기록 저장으로 보내고, 거절 단계면 거절 이유도 싣는다', async () => {
    const user = userEvent.setup();
    renderMemoRead({ outcome: { ...IN_PROGRESS, status: 'LOST', lostReasonCode: 'PRICE' } });
    await open(user);
    await user.click(screen.getByTestId('memo-read-apply-NEXT_SCHEDULE'));
    await waitFor(() =>
      expect(screen.getByTestId('memo-read-applied-NEXT_SCHEDULE')).toBeInTheDocument(),
    );
    expect(mockedOutcome).toHaveBeenCalledWith(
      'opp-1',
      {
        status: 'LOST',
        lostReasonCode: 'PRICE',
        nextScheduleAt: '2026-11-18',
        nextScheduleNote: '자료 보내기',
      },
      'park-lee',
    );
  });

  it('반영이 실패하면 서버 문장을 보이고 그 줄은 [반영]으로 남는다', async () => {
    const user = userEvent.setup();
    const onApplied = renderMemoRead();
    mockedOutcome.mockRejectedValue(new ApiError(500, { message: '다시 평가하지 못했습니다.' }));
    await open(user);
    await user.click(screen.getByTestId('memo-read-apply-PROCESS'));
    await waitFor(() =>
      expect(screen.getByTestId('memo-read-apply-error')).toHaveTextContent(
        '반영하지 못했습니다. (다시 평가하지 못했습니다.)',
      ),
    );
    expect(screen.getByTestId('memo-read-apply-PROCESS')).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('꼬리 질문 파일에 공정 확인 질문이 없으면 공정 제안에는 [반영]이 없다', async () => {
    const user = userEvent.setup();
    renderMemoRead({ processQuestionId: null });
    await open(user);
    expect(screen.queryByTestId('memo-read-apply-PROCESS')).not.toBeInTheDocument();
    expect(screen.getByTestId('memo-read-proposal-PROCESS')).toHaveTextContent(texts.cannotApply);
  });
});

describe('기록 남기기 › 메모 칸 (#720)', () => {
  const QUESTIONS: SalesQuestions = {
    version: 1,
    steps: [],
    questions: [
      {
        questionId: 'CONFIRM_PROCESS',
        text: '어떤 공정을 맡길 수 있나요?',
        step: 'REACHED',
        choices: 'PROCESS',
        answers: [{ answerId: 'NICKEL_PLATING', label: '니켈도금' }],
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta });
    vi.mocked(postNote).mockResolvedValue({
      data: { noteId: 'note-7', version: 1, updatedBy: 'park-lee', updatedAt: meta.updatedAt },
      meta,
    });
  });

  async function saveMemo(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByTestId('records-kind'), 'MEMO');
    await user.type(screen.getByTestId('records-note-input'), '김 과장과 통화');
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() => expect(postNote).toHaveBeenCalledTimes(1));
  }

  it('스위치가 켜져 있으면 "이름은 AI로 보내지 않습니다"까지, 꺼져 있으면 앞 문장만 보인다', async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(<RecordsArea oppId="opp-1" />, ON);
    await user.selectOptions(screen.getByTestId('records-kind'), 'MEMO');
    const area = screen.getByTestId('records-area');
    expect(area).toHaveTextContent(texts.nameHintAi);
    // 스위치가 켜져 있으면 "외부로 나가지 않습니다"라고 하지 않는다(메모 읽기로 나갈 수 있다).
    expect(area).not.toHaveTextContent('외부로 나가지 않습니다');
    unmount();
    wrap(<RecordsArea oppId="opp-1" />, OFF);
    await user.selectOptions(screen.getByTestId('records-kind'), 'MEMO');
    const off = screen.getByTestId('records-area');
    expect(off).toHaveTextContent(`${recordsArea.noteHint} ${texts.nameHint}`);
    expect(off).not.toHaveTextContent('이름은 AI로 보내지 않습니다');
  });

  it('메모를 저장하면 그 아래에 [AI가 메모 읽기 💰]가 보이고, 누르기 전에는 부르지 않는다', async () => {
    const user = userEvent.setup();
    wrap(<RecordsArea oppId="opp-1" outcome={IN_PROGRESS} />, ON);
    expect(screen.queryByTestId('memo-read')).not.toBeInTheDocument();
    await saveMemo(user);
    await waitFor(() => expect(screen.getByTestId('memo-read-button')).toBeInTheDocument());
    expect(mockedRead).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('memo-read-button'));
    await waitFor(() =>
      expect(mockedRead).toHaveBeenCalledWith('opp-1', 'NOTE', 'note-7', 'park-lee'),
    );
  });

  it('스위치가 꺼져 있으면 메모를 저장해도 단추가 보이지 않는다', async () => {
    const user = userEvent.setup();
    wrap(<RecordsArea oppId="opp-1" outcome={IN_PROGRESS} />, OFF);
    await saveMemo(user);
    await waitFor(() => expect(screen.getByTestId('records-note-saved')).toBeInTheDocument());
    expect(screen.queryByTestId('memo-read')).not.toBeInTheDocument();
  });
});
