// 영업 비서 화면 부품(#680): 대시보드 질문 칸과 상세 통화 전 칸(#750부터 저장된 코치 정리만 보인다).
// #981: 질문 칸 모양 — 안내 말풍선 → 화면별 예시 질문 단추 세 개(글만 채움, 요청 0건) → 질문 칸 + [묻기 유료] → 안내 글.
// 요청 함수는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { postAssistantAsk } from '../../../api/assistant';
import type { AssistantAnswer } from '../../../api/assistant';
import { ApiError } from '../../../api/client';
import type { ConfigUi } from '../../../api/types';
import { assistantTexts as texts } from '../../../labels/ko';
import { FrameContext } from '../../frame/FrameContext';
import AssistantAsk from '../AssistantAsk';

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
  /** 지금 화면 주소. 질문 칸은 주소로 화면(대시보드·거래처 후보·관심 기업·영업 분석)을 안다. */
  path = '/',
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

describe('AssistantAsk 예시 질문 단추와 [묻기 유료] (#981)', () => {
  const LIST = '/opportunities';
  const exampleTexts = () =>
    screen.getAllByTestId('assistant-example').map((button) => button.textContent);

  beforeEach(() => {
    mockedAsk.mockReset();
  });

  it('Given 거래처 후보 화면 When 질문 칸 Then 안내 말풍선 → 예시 질문 단추 세 개 → 질문 칸과 [묻기 유료] → 안내 글 순서로 보인다', () => {
    renderWith(<AssistantAsk />, ON, undefined, LIST);
    const intro = screen.getByTestId('assistant-intro');
    expect(intro).toHaveTextContent(
      /^화면에 보이는 후보와 영업 기록을 바탕으로 답합니다\. 궁금한 것을 물어보세요\.$/,
    );
    // 예시 질문 글은 글 대응표의 그 화면 것 그대로, 세 개다.
    const examples = screen.getByRole('group', { name: '예시 질문' });
    expect(examples).toHaveAttribute('data-testid', 'assistant-examples');
    expect(exampleTexts()).toEqual(texts.examples.LIST);
    expect(exampleTexts()).toEqual([
      '가까운 후보부터 알려줘',
      '적합도 상인 후보는?',
      '먼저 연락할 후보 3곳은?',
    ]);
    // 돈이 드는 것은 [묻기]뿐이라 "유료" 꼬리표는 [묻기]에만 붙는다(예시 단추에는 없다).
    const ask = screen.getByTestId('assistant-ask-button');
    expect(ask).toHaveAccessibleName('묻기 유료');
    expect(within(ask).getByTestId('paid-tag')).toHaveTextContent(/^유료$/);
    expect(screen.getAllByTestId('paid-tag')).toHaveLength(1);
    expect(ask).not.toHaveTextContent('💰');
    // 안내 글 끝에 비용이 언제 드는지 한 줄이 붙는다.
    const hint = screen.getByTestId('assistant-ask-hint');
    expect(hint.textContent).toBe(`${texts.askHintList} [묻기]를 누를 때만 AI 비용이 듭니다.`);
    // 화면 순서: 말풍선 → 예시 단추 → 질문 칸 → 안내 글.
    const order = [intro, examples, screen.getByTestId('assistant-question-input'), hint];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('Given 예시 질문 단추 When 누르면 Then 질문 칸에 그 글만 채워지고 요청은 0건이며, 그 뒤 [묻기]를 눌러야 그 글로 한 번 보낸다', async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValueOnce({ data: answer, meta: {} });
    renderWith(<AssistantAsk />, ON, undefined, LIST);
    const input = screen.getByTestId('assistant-question-input');
    expect(input).toHaveValue('');
    expect(screen.getByTestId('assistant-ask-button')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '적합도 상인 후보는?' }));
    // 글만 채운다: 보내지 않고(비용 없음) 답도 "쓰는 중"도 없다. [묻기]가 눌릴 수 있게 된다.
    expect(input).toHaveValue('적합도 상인 후보는?');
    expect(mockedAsk).not.toHaveBeenCalled();
    expect(screen.queryByTestId('assistant-asking')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-answer')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-ask-button')).toBeEnabled();

    // 다른 예시를 누르면 덧붙지 않고 그 글로 바뀐다. 여전히 요청은 없다.
    await user.click(screen.getByRole('button', { name: '가까운 후보부터 알려줘' }));
    expect(input).toHaveValue('가까운 후보부터 알려줘');
    expect(mockedAsk).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('assistant-ask-button'));
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(mockedAsk).toHaveBeenCalledWith('가까운 후보부터 알려줘', 'park-lee', 'LIST');
    expect(await screen.findByTestId('assistant-answer')).toBeInTheDocument();
  });

  it.each([
    ['영업 홈', '/', 'DASHBOARD'],
    ['거래처 후보', '/opportunities', 'LIST'],
    ['관심 기업', '/bookmarks', 'BOOKMARKS'],
    ['영업 분석', '/sales-analysis', 'ANALYSIS'],
  ] as const)(
    'Given %s 화면(%s) When 질문 칸 Then 그 화면의 안내 말풍선과 예시 질문 세 개가 나온다',
    (_name, path, page) => {
      renderWith(<AssistantAsk />, ON, undefined, path);
      expect(texts.examples[page]).toHaveLength(3);
      expect(exampleTexts()).toEqual(texts.examples[page]);
      expect(screen.getByTestId('assistant-intro').textContent).toBe(texts.intro[page]);
    },
  );

  it('Given 질문 칸이 놓이는 네 화면이 아닌 주소 When 질문 칸 Then 예시 질문 단추는 없고 기본 안내와 질문 칸만 보인다', () => {
    renderWith(<AssistantAsk />, ON, undefined, '/operations');
    expect(screen.queryByTestId('assistant-examples')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-example')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-intro').textContent).toBe(texts.intro.OTHER);
    expect(screen.getByTestId('assistant-question-input')).toBeEnabled();
  });

  it('Given 보기 전용·담당자 미선택 When 질문 칸 Then 예시 질문 단추 세 개가 모두 잠겨 눌러도 글이 채워지지 않는다', async () => {
    const user = userEvent.setup();
    renderWith(<AssistantAsk />, ON, { staffKey: null, canRecord: false }, LIST);
    const examples = screen.getAllByTestId('assistant-example');
    expect(examples).toHaveLength(3);
    for (const example of examples) expect(example).toBeDisabled();
    await user.click(examples[0]);
    expect(screen.getByTestId('assistant-question-input')).toHaveValue('');
    expect(mockedAsk).not.toHaveBeenCalled();
    // 안내 글은 비용 안내 대신 담당자를 고르라는 한 줄이다.
    expect(screen.getByTestId('assistant-ask-hint').textContent).toBe(texts.pickStaffFirst);
  });

  it('Given 스위치가 꺼짐 When 질문 칸 Then 말풍선도 예시 질문 단추도 보이지 않는다', () => {
    renderWith(<AssistantAsk />, OFF, undefined, LIST);
    expect(screen.getByTestId('assistant-disabled')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-intro')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-example')).not.toBeInTheDocument();
  });
});
