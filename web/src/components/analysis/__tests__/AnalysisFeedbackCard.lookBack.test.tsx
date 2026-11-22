// #887(PM 결정 2026-11-22) AI 분석 피드백: 지난 제안 돌아보기 묶음과 다음 할 일 [넣기].
// [넣기]는 영업 코치와 같은 줄을 쓰고, 영업 분석에서 눌렀다는 표시(source ANALYSIS)를 함께 보낸다. 값은 가상이다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AnalysisFeedbackCard from '../AnalysisFeedbackCard';
import { getSalesFeedback } from '../../../api/salesAnalysis';
import type { AnalysisFeedback } from '../../../api/salesAnalysis';
import { postSchedule } from '../../../api/assistant';
import { FrameContext } from '../../frame/FrameContext';
import type { ConfigUi } from '../../../api/types';
import fixture from '../../../test/fixtures/config-ui.json';

vi.mock('../../../api/salesAnalysis', async (original) => ({
  ...(await original<typeof import('../../../api/salesAnalysis')>()),
  getSalesFeedback: vi.fn(),
  requestSalesFeedback: vi.fn(),
}));
vi.mock('../../../api/assistant', async (original) => ({
  ...(await original<typeof import('../../../api/assistant')>()),
  postSchedule: vi.fn(),
}));

const config = (fixture as unknown as { data: ConfigUi }).data;
const PERIOD = { from: '2026-11-01', to: '2026-11-30' };

const BASE: AnalysisFeedback = {
  feedbackId: 'feedback-2',
  periodFrom: '2026-11-01',
  periodTo: '2026-11-30',
  generatedAt: '2026-11-22T01:00:00Z',
  generatedBy: 'park-lee',
  model: 'gpt-6.1-sol',
  promptVersion: '[지시문 버전] analysis-v3',
  inputHash: 'def',
  costUsd: 0.07,
  failure: { where: [], why: [], signals: [], vsSuccess: [], next: [] },
  success: { where: [], why: [], signals: [] },
  next: [{ text: '가상정밀에 이번 주 방문한다.', evidence: ['가상정밀 · 11/20 메모'] }],
  heldBack: [],
  comparedToPrevious: null,
  aiGenerated: true,
};

function renderWith(feedback: AnalysisFeedback) {
  vi.mocked(getSalesFeedback).mockResolvedValue({
    data: { feedback, current: true, switchOn: true },
    meta: {} as never,
  });
  render(
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config,
          staffKey: 'park-lee',
          setStaffKey: () => {},
          canRecord: true,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <AnalysisFeedbackCard period={PERIOD} />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getSalesFeedback).mockReset();
  vi.mocked(postSchedule).mockReset();
});

describe('AI 분석 피드백 · 지난 제안 돌아보기 (#887)', () => {
  it('지난 분석을 돌아본 글이 있으면 받은 날과 함께 맨 위에 보인다', async () => {
    renderWith({
      ...BASE,
      lookBack: [
        {
          text: "지난번 '물량 먼저' → 견적 단계 3곳 중 2곳이 물량을 먼저 물었다.",
          evidence: ['가상정밀 · 11/21 메모'],
        },
      ],
      lookBackFrom: '2026-11-15',
    });
    const section = await screen.findByTestId('feedback-look-back');
    expect(section).toHaveTextContent('🔁 지난 제안 돌아보기');
    expect(section).toHaveTextContent('2026-11-15에 받은 분석의 제안을 그 뒤 기록과 견줌');
    expect(section).toHaveTextContent("지난번 '물량 먼저'");
  });

  it('옛 저장본처럼 돌아보기·제안 칸이 없으면 그 묶음이 보이지 않는다', async () => {
    renderWith(BASE);
    await screen.findByTestId('feedback-next');
    expect(screen.queryByTestId('feedback-look-back')).toBeNull();
    expect(screen.queryByTestId('feedback-suggestions')).toBeNull();
  });

  it('일정 제안의 [넣기]는 영업 분석 표시와 함께 저장한다', async () => {
    vi.mocked(postSchedule).mockResolvedValue({ data: {}, meta: {} } as never);
    renderWith({
      ...BASE,
      suggestions: [
        {
          oppId: 'opp-1',
          name: '가상정밀',
          actionId: 'VISIT',
          actionLabel: '방문',
          date: '2026-11-25',
          currentScheduleAt: null,
          currentScheduleNote: null,
          outcomeVersion: 3,
        },
      ],
    });
    const section = await screen.findByTestId('feedback-suggestions');
    expect(section).toHaveTextContent('가상정밀');
    await userEvent.click(screen.getByTestId('assistant-suggestion-put'));
    expect(postSchedule).toHaveBeenCalledWith(
      'opp-1',
      { nextScheduleAt: '2026-11-25', actionId: 'VISIT', expectedVersion: 3, source: 'ANALYSIS' },
      'park-lee',
    );
    expect(await screen.findByTestId('assistant-suggestion-done')).toBeInTheDocument();
  });
});
