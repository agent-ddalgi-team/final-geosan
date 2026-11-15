// #774 영업 코치 칸: 지금 화면 보내기, 긴 답 접기, 답 아래 할 일 제안 [넣기].
// 요청 함수는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { postAssistantAsk, postSchedule, SCHEDULE_CHANGED_EVENT } from '../../../api/assistant';
import type { AssistantAnswer, AssistantSuggestion } from '../../../api/assistant';
import { ApiError } from '../../../api/client';
import type { ConfigUi } from '../../../api/types';
import { assistantTexts as texts } from '../../../labels/ko';
import { FrameContext } from '../../frame/FrameContext';
import AssistantAnswerBox, { withRo } from '../AssistantAnswerBox';
import AssistantAsk, { assistantPageOf } from '../AssistantAsk';

vi.mock('../../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/assistant')>()),
  postAssistantAsk: vi.fn(),
  postSchedule: vi.fn(),
}));

const mockedAsk = vi.mocked(postAssistantAsk);
const mockedPut = vi.mocked(postSchedule);

const ON = { assistant: { enabled: true, questionMaxLength: 300 } } as unknown as ConfigUi;

const fresh: AssistantSuggestion = {
  oppId: 'opp-2',
  name: '가나텍(가상)',
  actionId: 'VISIT',
  actionLabel: '방문',
  date: '2026-11-18',
  currentScheduleAt: null,
  currentScheduleNote: null,
  outcomeVersion: 0,
};
const moving: AssistantSuggestion = {
  ...fresh,
  oppId: 'opp-3',
  name: '다라금속(가상)',
  currentScheduleAt: '2026-11-20',
  currentScheduleNote: '다시 연락',
  outcomeVersion: 4,
};

function answerWith(overrides: Partial<AssistantAnswer> = {}): AssistantAnswer {
  return {
    answer: '가나텍(가상)을 11/18에 방문해 보세요.',
    sources: [],
    aiGenerated: true,
    usedQueries: ['COMPANY_LIST'],
    suggestions: [],
    ...overrides,
  };
}

function renderWith(
  node: React.ReactNode,
  { path = '/', canRecord = true }: { path?: string; canRecord?: boolean } = {},
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FrameContext.Provider
        value={{
          config: ON,
          staffKey: canRecord ? 'park-lee' : 'viewer',
          canRecord,
          setStaffKey: () => {},
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        {node}
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedAsk.mockReset();
  mockedPut.mockReset();
});

describe('영업 코치 칸이 지금 화면을 보낸다', () => {
  it('주소로 화면을 고른다(모르는 화면은 보내지 않는다)', () => {
    expect(assistantPageOf('/')).toBe('DASHBOARD');
    expect(assistantPageOf('/opportunities')).toBe('LIST');
    expect(assistantPageOf('/bookmarks')).toBe('BOOKMARKS');
    expect(assistantPageOf('/sales-analysis')).toBe('ANALYSIS');
    expect(assistantPageOf('/opportunities/opp-1')).toBeNull();
  });

  it('신규 거래처 찾기에서는 LIST를 보내고 후보 표에 맞는 예시·안내를 보인다', async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValueOnce({ data: answerWith(), meta: {} });
    renderWith(<AssistantAsk />, { path: '/opportunities' });
    const input = screen.getByTestId('assistant-question-input');
    expect(input).toHaveAttribute('placeholder', texts.askPlaceholderList);
    expect(screen.getByTestId('assistant-ask-hint')).toHaveTextContent(texts.askHintList);
    await user.type(input, '아산 적합도 상 가까운 곳?');
    await user.click(screen.getByTestId('assistant-ask-button'));
    expect(mockedAsk).toHaveBeenCalledWith('아산 적합도 상 가까운 곳?', 'park-lee', 'LIST');
  });
});

describe('긴 답은 접어서 보인다', () => {
  it('5줄이 넘으면 앞 5줄과 [더 보기], 누르면 다 펴지고 [접기]', async () => {
    const user = userEvent.setup();
    const lines = ['1줄', '2줄', '3줄', '4줄', '5줄', '6줄', '7줄'];
    renderWith(<AssistantAnswerBox answer={answerWith({ answer: lines.join('\n') })} />);
    const text = screen.getByTestId('assistant-answer-text');
    expect(text).toHaveTextContent('5줄');
    expect(text).not.toHaveTextContent('6줄');
    await user.click(screen.getByTestId('assistant-answer-more'));
    expect(text).toHaveTextContent('7줄');
    expect(screen.getByTestId('assistant-answer-more')).toHaveTextContent(texts.answerLess);
  });

  it('5줄 이하면 [더 보기]가 없다(답 끝의 빈 줄은 세지 않는다)', () => {
    renderWith(<AssistantAnswerBox answer={answerWith({ answer: '1줄\n2줄\n\n4줄\n5줄\n' })} />);
    expect(screen.queryByTestId('assistant-answer-more')).not.toBeInTheDocument();
  });
});

describe('답 아래 할 일 제안 [넣기]', () => {
  it('일정이 없는 회사는 [넣기]를 누르면 바로 저장하고 "넣었어요"와 알림을 보낸다', async () => {
    const user = userEvent.setup();
    const heard = vi.fn();
    window.addEventListener(SCHEDULE_CHANGED_EVENT, heard);
    mockedPut.mockResolvedValueOnce({ data: {}, meta: {} } as never);
    renderWith(<AssistantAnswerBox answer={answerWith({ suggestions: [fresh] })} />);
    const item = screen.getByTestId('assistant-suggestion');
    expect(item).toHaveTextContent('가나텍(가상)');
    expect(item).toHaveTextContent('11/18(수) 방문');
    await user.click(within(item).getByTestId('assistant-suggestion-put'));
    expect(mockedPut).toHaveBeenCalledWith(
      'opp-2',
      { nextScheduleAt: '2026-11-18', actionId: 'VISIT', expectedVersion: 0 },
      'park-lee',
    );
    expect(await within(item).findByTestId('assistant-suggestion-done')).toHaveTextContent(
      texts.putDone,
    );
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SCHEDULE_CHANGED_EVENT, heard);
  });

  it('이미 일정이 있으면 "○ → ○으로 바꿀까요?"를 먼저 묻고, [그대로 두기]면 저장하지 않는다', async () => {
    const user = userEvent.setup();
    mockedPut.mockResolvedValueOnce({ data: {}, meta: {} } as never);
    renderWith(<AssistantAnswerBox answer={answerWith({ suggestions: [moving] })} />);
    await user.click(screen.getByTestId('assistant-suggestion-put'));
    expect(screen.getByTestId('assistant-suggestion-confirm')).toHaveTextContent(
      '11/20(금) 다시 연락 → 11/18(수) 방문으로 바꿀까요?',
    );
    await user.click(screen.getByTestId('assistant-suggestion-keep'));
    expect(mockedPut).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('assistant-suggestion-put'));
    await user.click(screen.getByTestId('assistant-suggestion-change'));
    expect(mockedPut).toHaveBeenCalledWith(
      'opp-3',
      { nextScheduleAt: '2026-11-18', actionId: 'VISIT', expectedVersion: 4 },
      'park-lee',
    );
  });

  it('같은 일정이 이미 있으면 단추 대신 "이미 같은 일정이 있어요"', () => {
    const same = { ...moving, currentScheduleAt: '2026-11-18', currentScheduleNote: '방문' };
    renderWith(<AssistantAnswerBox answer={answerWith({ suggestions: [same] })} />);
    expect(screen.getByTestId('assistant-suggestion-same')).toHaveTextContent(texts.putSame);
    expect(screen.queryByTestId('assistant-suggestion-put')).not.toBeInTheDocument();
  });

  it('보기 전용이면 제안은 보이되 [넣기]가 없다', () => {
    renderWith(<AssistantAnswerBox answer={answerWith({ suggestions: [fresh] })} />, {
      canRecord: false,
    });
    expect(screen.getByTestId('assistant-suggestion')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-suggestion-put')).not.toBeInTheDocument();
  });

  it('그 사이 다른 기록이 저장됐으면(409) 서버의 쉬운 말을 보이고 단추는 다시 누를 수 있다', async () => {
    const user = userEvent.setup();
    mockedPut.mockRejectedValueOnce(
      new ApiError(409, {
        message: '그 사이 이 회사에 다른 기록이 저장됐습니다',
        nextAction: '다시 물어보거나 상세에서 지금 일정을 확인해 주세요',
        ref: 'x',
      }),
    );
    renderWith(<AssistantAnswerBox answer={answerWith({ suggestions: [fresh] })} />);
    await user.click(screen.getByTestId('assistant-suggestion-put'));
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 기록이 저장됐습니다');
    expect(screen.getByTestId('assistant-suggestion-put')).toBeEnabled();
  });

  it('제안이 없으면 제안 칸이 없다(옛 서버도 같다)', () => {
    const old = answerWith();
    delete (old as { suggestions?: unknown }).suggestions;
    renderWith(<AssistantAnswerBox answer={old} />);
    expect(screen.queryByTestId('assistant-suggestions')).not.toBeInTheDocument();
  });

  it('조사 "로/으로"를 끝 글자에 맞춘다', () => {
    expect(withRo('11/18(수) 방문')).toBe('11/18(수) 방문으로');
    expect(withRo('견적')).toBe('견적으로');
    expect(withRo('다시 연락')).toBe('다시 연락으로');
    expect(withRo('자료 보내기')).toBe('자료 보내기로');
    expect(withRo('메일')).toBe('메일로');
  });
});
