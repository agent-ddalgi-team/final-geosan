// 오늘 정리 부품(#743). 요청 함수는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getAssistantDaily } from '../../../api/assistant';
import type { DailyBrief } from '../../../api/assistant';
import { ApiError } from '../../../api/client';
import { assistantTexts as texts } from '../../../labels/ko';
import AssistantDaily from '../AssistantDaily';

vi.mock('../../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/assistant')>()),
  getAssistantDaily: vi.fn(),
}));

const mockedDaily = vi.mocked(getAssistantDaily);

const brief: DailyBrief = {
  summary: '- 화 11/18 A정밀 방문 → 근처 1.5km B금속(관심)도 들르세요\n- 보류: C산업',
  sources: [
    { oppId: 'opp-1', name: 'A정밀' },
    { oppId: 'opp-2', name: 'B금속' },
  ],
  aiGenerated: true,
  day: '2026-11-14',
  generatedAt: '2026-11-14T00:00:00Z',
  reused: true,
};

function renderDaily() {
  return render(
    <MemoryRouter>
      <AssistantDaily staffKey="park-lee" />
    </MemoryRouter>,
  );
}

function apiError(kind: string, message: string) {
  return new ApiError(503, { message, nextAction: '', ref: 'r', kind });
}

describe('대시보드 › 오늘 확인할 것 › 오늘 정리 (#743)', () => {
  beforeEach(() => mockedDaily.mockReset());

  it('쓰는 동안 안내 한 줄, 받으면 글·"AI가 쓴 글 · 확인 필요"·근거 회사 링크가 보인다', async () => {
    mockedDaily.mockResolvedValue({ data: brief });
    renderDaily();
    expect(screen.getByTestId('assistant-daily-loading')).toHaveTextContent(texts.dailyLoading);
    const box = await screen.findByTestId('assistant-daily');
    expect(within(box).getByTestId('assistant-daily-mark')).toHaveTextContent(texts.dailyMark);
    expect(within(box).getByTestId('assistant-daily-text')).toHaveTextContent('B금속(관심)');
    const links = within(box).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/opportunities/opp-1',
      '/opportunities/opp-2',
    ]);
    expect(mockedDaily).toHaveBeenCalledWith('park-lee', expect.any(AbortSignal));
  });

  it('정리할 것이 없으면(ASSISTANT_NO_RECORDS) 아무것도 보이지 않는다', async () => {
    mockedDaily.mockRejectedValueOnce(
      apiError('ASSISTANT_NO_RECORDS', '오늘 정리할 것이 없습니다.'),
    );
    const { container } = renderDaily();
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByTestId('assistant-daily-error')).not.toBeInTheDocument();
  });

  it('한도를 넘는 등 받지 못하면 이유와 함께 한 줄로 알린다', async () => {
    mockedDaily.mockRejectedValueOnce(apiError('ASSISTANT_LIMIT', '오늘 질문 한도를 넘었습니다.'));
    renderDaily();
    const line = await screen.findByTestId('assistant-daily-error');
    expect(line).toHaveTextContent(texts.dailyFailed);
    expect(line).toHaveTextContent('오늘 질문 한도를 넘었습니다.');
    expect(screen.queryByTestId('assistant-daily')).not.toBeInTheDocument();
  });
});
