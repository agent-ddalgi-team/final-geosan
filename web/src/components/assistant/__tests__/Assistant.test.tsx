// 영업 비서 화면 부품(#680): 대시보드 질문 칸과 상세 통화 전 칸(#750부터 저장된 코치 정리만 보인다).
// 요청 함수는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { postAssistantAsk } from '../../../api/assistant';
import type { AssistantAnswer } from '../../../api/assistant';
import { ApiError } from '../../../api/client';
import type { CallPrepNote, ConfigUi } from '../../../api/types';
import { assistantTexts as texts, coachTexts } from '../../../labels/ko';
import { FrameContext } from '../../frame/FrameContext';
import AssistantAsk from '../AssistantAsk';
import CallPrep from '../CallPrep';

vi.mock('../../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/assistant')>()),
  postAssistantAsk: vi.fn(),
}));

const mockedAsk = vi.mocked(postAssistantAsk);

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
    // #774: 지금 화면도 함께 보낸다(이 시험은 대시보드 주소 "/").
    expect(mockedAsk).toHaveBeenCalledWith('가격 때문에 거절된 회사는?', 'park-lee', 'DASHBOARD');
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

describe('CallPrep (상세 "영업 코치 · 통화 전" 칸, #750)', () => {
  const PREP: CallPrepNote = {
    noteId: 'note-5',
    lines: ['외주처는 어디인가요?', '방문 날짜를 정할 수 있을까요?'],
    at: '2026-11-15T10:00:00+09:00',
    by: 'park-lee',
  };

  it('지난 통화 뒤 코치가 정리한 물어볼 것을 AI를 부르지 않고 보인다. [통화 준비] 단추는 없다', () => {
    renderWith(<CallPrep prep={PREP} />, ON);
    expect(screen.getByTestId('call-prep-date')).toHaveTextContent(coachTexts.prepTitle('11/15'));
    expect(
      within(screen.getByTestId('call-prep-lines'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(PREP.lines);
    expect(screen.queryByRole('button')).toBeNull();
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it('정리가 없으면 [보내기]로 정리된다는 안내 한 줄, 스위치가 꺼져 있으면 아무것도 없다', () => {
    const view = renderWith(<CallPrep prep={null} />, ON);
    expect(screen.getByTestId('call-prep-none')).toHaveTextContent(coachTexts.prepNone);
    view.unmount();
    const off = renderWith(<CallPrep prep={null} />, OFF);
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();
    // 스위치를 꺼도 이미 남긴 정리는 보인다(저장된 글일 뿐, AI를 부르지 않는다).
    renderWith(<CallPrep prep={PREP} />, null);
    expect(screen.getByTestId('call-prep-lines')).toBeInTheDocument();
  });
});
