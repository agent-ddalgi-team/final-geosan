// 영업 비서 화면 부품(#680): 대시보드 질문 칸과 상세 [통화 준비].
// 요청 함수는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { postAssistantAsk, postCallPrep } from '../../../api/assistant';
import type { AssistantAnswer } from '../../../api/assistant';
import { ApiError } from '../../../api/client';
import type { ConfigUi } from '../../../api/types';
import { assistantTexts as texts } from '../../../labels/ko';
import { FrameContext } from '../../frame/FrameContext';
import AssistantAsk from '../AssistantAsk';
import CallPrep from '../CallPrep';

vi.mock('../../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/assistant')>()),
  postAssistantAsk: vi.fn(),
  postCallPrep: vi.fn(),
}));

const mockedAsk = vi.mocked(postAssistantAsk);
const mockedPrep = vi.mocked(postCallPrep);

const ON = { assistant: { enabled: true, questionMaxLength: 300 } } as unknown as ConfigUi;
const OFF = { assistant: { enabled: false, questionMaxLength: 300 } } as unknown as ConfigUi;

const answer: AssistantAnswer = {
  answer: 'A정밀: 2026-10-06 전화 뒤 가격 이유로 거절.',
  sources: [{ oppId: 'opp-1', name: 'A정밀' }],
  aiGenerated: true,
  usedQueries: ['COMPANY_LIST'],
  companiesIncluded: 3,
  companiesTotal: 3,
};

function renderWith(
  node: React.ReactNode,
  config: ConfigUi | null,
  staff: { staffKey: string | null; canRecord: boolean } = {
    staffKey: 'park-lee',
    canRecord: true,
  },
) {
  return render(
    <MemoryRouter>
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
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('AssistantAsk (대시보드 질문 칸)', () => {
  beforeEach(() => {
    mockedAsk.mockReset();
    mockedPrep.mockReset();
  });

  it('설정을 못 읽었거나 서버가 값을 안 주면 아무것도 보이지 않는다', () => {
    const { container } = renderWith(<AssistantAsk />, null);
    expect(container).toBeEmptyDOMElement();
    renderWith(<AssistantAsk />, {} as ConfigUi);
    expect(screen.queryByTestId('assistant-ask')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-disabled')).not.toBeInTheDocument();
  });

  it('스위치가 꺼져 있으면 질문 칸 대신 안내 한 줄만 보인다', () => {
    renderWith(<AssistantAsk />, OFF);
    expect(screen.getByTestId('assistant-disabled')).toHaveTextContent(texts.disabled);
    expect(screen.queryByTestId('assistant-question-input')).not.toBeInTheDocument();
  });

  it('묻으면 답 글과 "AI가 쓴 답 · 확인 필요" 표시, 근거 회사 링크가 그 아래에 펴진다', async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValueOnce({ data: answer, meta: {} });
    renderWith(<AssistantAsk />, ON);
    expect(screen.getByTestId('assistant-ask-button')).toBeDisabled(); // 빈 질문은 못 보낸다.
    await user.type(screen.getByTestId('assistant-question-input'), ' 가격 때문에 거절된 회사는? ');
    await user.click(screen.getByTestId('assistant-ask-button'));
    expect(mockedAsk).toHaveBeenCalledWith('가격 때문에 거절된 회사는?', 'park-lee');
    const box = await screen.findByTestId('assistant-answer');
    expect(within(box).getByTestId('assistant-answer-text')).toHaveTextContent(answer.answer);
    expect(within(box).getByTestId('assistant-ai-mark')).toHaveTextContent(texts.aiMark);
    const link = within(box).getByRole('link', { name: 'A정밀' });
    expect(link).toHaveAttribute('href', '/opportunities/opp-1');
    // 전부 보았으면 "○곳 가운데 ○곳만"은 없다.
    expect(within(box).queryByTestId('assistant-partial')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('회사 일부만 보았으면 "○곳 가운데 ○곳만 보았습니다"를, 근거 회사가 없으면 없다고 알린다', async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValueOnce({
      data: { ...answer, sources: [], companiesIncluded: 60, companiesTotal: 72 },
      meta: {},
    });
    renderWith(<AssistantAsk />, ON);
    await user.type(screen.getByTestId('assistant-question-input'), '성사된 회사의 공통점은?');
    await user.click(screen.getByTestId('assistant-ask-button'));
    expect(await screen.findByTestId('assistant-partial')).toHaveTextContent(
      '72곳 가운데 60곳만 보았습니다.',
    );
    expect(screen.getByTestId('assistant-sources-none')).toHaveTextContent(texts.sourcesNone);
  });

  it('서버가 거부하면 답 대신 서버의 쉬운 말 오류를 보인다', async () => {
    const user = userEvent.setup();
    mockedAsk.mockRejectedValueOnce(
      new ApiError(503, {
        message: '오늘 질문 한도를 넘었습니다.',
        nextAction: '내일 다시 물어봐 주세요.',
        ref: 'r1',
        kind: 'ASSISTANT_LIMIT',
      }),
    );
    renderWith(<AssistantAsk />, ON);
    await user.type(screen.getByTestId('assistant-question-input'), '질문');
    await user.click(screen.getByTestId('assistant-ask-button'));
    expect(await screen.findByTestId('assistant-ask-error')).toHaveTextContent(
      `${texts.askFailed} (오늘 질문 한도를 넘었습니다.)`,
    );
    expect(screen.queryByTestId('assistant-answer')).not.toBeInTheDocument();
  });

  it('보기 전용·담당자 미선택이면 칸과 단추가 잠기고 요청을 보내지 않는다', async () => {
    renderWith(<AssistantAsk />, ON, { staffKey: 'viewer', canRecord: false });
    expect(screen.getByTestId('assistant-question-input')).toBeDisabled();
    expect(screen.getByTestId('assistant-ask-button')).toBeDisabled();
    expect(screen.getByTestId('assistant-ask-hint')).toHaveTextContent(texts.pickStaffFirst);
    expect(mockedAsk).not.toHaveBeenCalled();
  });
});

describe('CallPrep (상세 통화 준비)', () => {
  beforeEach(() => {
    mockedAsk.mockReset();
    mockedPrep.mockReset();
  });

  it('스위치가 꺼져 있거나 설정을 못 읽었으면 단추가 없다', () => {
    const off = renderWith(<CallPrep oppId="opp-1" />, OFF);
    expect(off.container).toBeEmptyDOMElement();
    const none = renderWith(<CallPrep oppId="opp-1" />, null);
    expect(none.container).toBeEmptyDOMElement();
  });

  it('[통화 준비 💰]를 누르면 한두 문장과 물어볼 것이 단추 아래에 펴진다', async () => {
    const user = userEvent.setup();
    const prep: AssistantAnswer = {
      answer: '지금 도금을 외주로 주는지부터 확인해 보세요.\n- 외주처를 바꿀 생각이 있나요?',
      sources: [{ oppId: 'opp-1', name: 'A정밀' }],
      aiGenerated: true,
      usedQueries: ['COMPANY_SUMMARY', 'PEERS'],
    };
    mockedPrep.mockResolvedValueOnce({ data: prep, meta: {} });
    renderWith(<CallPrep oppId="opp-1" />, ON);
    const button = screen.getByTestId('call-prep-button');
    expect(button).toHaveTextContent(texts.callPrepButton);
    await user.click(button);
    expect(mockedPrep).toHaveBeenCalledWith('opp-1', 'park-lee');
    const box = await screen.findByTestId('assistant-answer');
    expect(within(box).getByTestId('assistant-answer-text')).toHaveTextContent(
      '외주처를 바꿀 생각이 있나요?',
    );
    expect(within(box).getByTestId('assistant-ai-mark')).toBeInTheDocument();
    expect(within(box).queryByTestId('assistant-partial')).not.toBeInTheDocument();
  });

  it('실패하면 오류 한 줄을 보이고, 보기 전용이면 단추가 잠긴다', async () => {
    const user = userEvent.setup();
    mockedPrep.mockRejectedValueOnce(new Error('network'));
    const view = renderWith(<CallPrep oppId="opp-1" />, ON);
    await user.click(screen.getByTestId('call-prep-button'));
    await waitFor(() =>
      expect(screen.getByTestId('call-prep-error')).toHaveTextContent(texts.callPrepFailed),
    );
    view.unmount();
    renderWith(<CallPrep oppId="opp-1" />, ON, { staffKey: null, canRecord: false });
    expect(screen.getByTestId('call-prep-button')).toBeDisabled();
  });
});
