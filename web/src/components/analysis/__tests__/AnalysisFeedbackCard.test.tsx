// #824 "AI 분석 피드백" 카드: 저장본을 먼저 읽고(AI 호출 없음), 실패를 먼저 근거 숫자와 함께 보이며,
// 스위치가 꺼져 있거나 보기 전용이면 단추가 잠기고, [AI 분석 받기 유료]를 눌러야 받는다(#981: 💰 대신 "유료" 꼬리표). 숫자는 가상이다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnalysisFeedbackCard from '../AnalysisFeedbackCard';
import { getSalesFeedback, requestSalesFeedback } from '../../../api/salesAnalysis';
import type { AnalysisFeedback, FeedbackState } from '../../../api/salesAnalysis';
import { FrameContext } from '../../frame/FrameContext';
import type { ConfigUi } from '../../../api/types';
import fixture from '../../../test/fixtures/config-ui.json';

vi.mock('../../../api/salesAnalysis', async (original) => ({
  ...(await original<typeof import('../../../api/salesAnalysis')>()),
  getSalesFeedback: vi.fn(),
  requestSalesFeedback: vi.fn(),
}));

const config = (fixture as unknown as { data: ConfigUi }).data;
const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

const FEEDBACK: AnalysisFeedback = {
  feedbackId: 'feedback-1',
  periodFrom: '2026-10-01',
  periodTo: '2026-10-31',
  generatedAt: '2026-11-17T01:00:00Z',
  generatedBy: 'park-lee',
  model: 'gpt-6.1-sol',
  promptVersion: '[지시문 버전] analysis-v1',
  inputHash: 'abc',
  costUsd: 0.0042,
  failure: {
    where: [{ text: '견적 단계에서 3곳이 빠졌다.', evidence: ['자료·견적: 3곳'] }],
    why: [{ text: '가격이 가장 많았다.', evidence: ['PRICE: 3건'] }],
    signals: [],
    vsSuccess: [],
    next: [{ text: '견적 전에 물량을 확인한다.', evidence: ['PRICE: 3건'] }],
  },
  success: {
    where: [],
    why: [{ text: '방문이 빨랐다.', evidence: ['첫 방문 2번째'] }],
    signals: [],
  },
  next: [{ text: '방문을 앞당긴다.', evidence: ['성사 3곳'] }],
  heldBack: ['답별 칸은 표본 부족이라 판단 보류'],
  comparedToPrevious: {
    previousFrom: '2026-08-31',
    previousTo: '2026-09-30',
    rows: [
      { key: 'CONTACTED', current: 12, previous: 9 },
      { key: 'WON', current: 3, previous: 3 },
    ],
  },
  aiGenerated: true,
};

function stateOf(overrides: Partial<FeedbackState>): { data: FeedbackState; meta: never } {
  return {
    data: { feedback: null, current: false, switchOn: true, ...overrides },
    meta: {} as never,
  };
}

function renderCard(staffKey: string | null = 'park-lee') {
  render(
    <FrameContext.Provider
      value={{
        config,
        staffKey,
        setStaffKey: () => {},
        canRecord: staffKey !== null && staffKey !== 'viewer',
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <AnalysisFeedbackCard period={PERIOD} />
    </FrameContext.Provider>,
  );
}

beforeEach(() => {
  vi.mocked(getSalesFeedback).mockReset();
  vi.mocked(requestSalesFeedback).mockReset();
});

it('저장본이 있으면 실패를 먼저 근거 숫자와 함께 보이고 AI를 부르지 않는다', async () => {
  vi.mocked(getSalesFeedback).mockResolvedValueOnce(stateOf({ feedback: FEEDBACK, current: true }));
  renderCard();
  const failure = await screen.findByTestId('feedback-failure');
  expect(within(failure).getByText('가격이 가장 많았다.')).toBeInTheDocument();
  expect(within(failure).getAllByTestId('feedback-evidence')[0]).toHaveTextContent(
    '근거: 자료·견적: 3곳',
  );
  // 실패 구역이 성공 구역보다 앞에 있다.
  const success = screen.getByTestId('feedback-success');
  expect(failure.compareDocumentPosition(success) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByTestId('feedback-ai-tag')).toHaveTextContent('AI가 쓴 글 · 확인 필요');
  expect(screen.getByTestId('feedback-held-back')).toHaveTextContent('표본 부족이라 판단 보류');
  expect(screen.getByTestId('feedback-compared')).toHaveTextContent('접촉 12 (↑3)');
  expect(screen.getByTestId('feedback-compared')).toHaveTextContent('성사 3 (—)');
  // 다시 받는 것도 돈이 들어 "유료" 꼬리표가 붙는다(#981, 💰 대신).
  const refresh = screen.getByTestId('feedback-request');
  expect(refresh).toHaveAccessibleName('다시 받기 유료');
  expect(within(refresh).getByTestId('paid-tag')).toHaveTextContent(/^유료$/);
  expect(refresh).not.toHaveTextContent('💰');
  expect(requestSalesFeedback).not.toHaveBeenCalled();
});

it('기록이 바뀌었으면 "기록이 바뀌었습니다"를 보인다', async () => {
  vi.mocked(getSalesFeedback).mockResolvedValueOnce(
    stateOf({ feedback: FEEDBACK, current: false }),
  );
  renderCard();
  expect(await screen.findByTestId('feedback-stale')).toHaveTextContent('기록이 바뀌었습니다');
});

it('[AI 분석 받기 유료]를 누르면 받아서 보인다', async () => {
  vi.mocked(getSalesFeedback).mockResolvedValueOnce(stateOf({}));
  vi.mocked(requestSalesFeedback).mockResolvedValueOnce({
    data: { feedback: FEEDBACK, reused: false },
    meta: {} as never,
  });
  renderCard();
  const button = await screen.findByTestId('feedback-request');
  await waitFor(() => expect(button).toBeEnabled());
  expect(button).toHaveAccessibleName('AI 분석 받기 유료');
  expect(within(button).getByTestId('paid-tag')).toHaveTextContent(/^유료$/);
  expect(button).not.toHaveTextContent('💰');
  await userEvent.click(button);
  expect(requestSalesFeedback).toHaveBeenCalledWith(PERIOD, false, 'park-lee');
  expect(await screen.findByTestId('feedback-failure')).toBeInTheDocument();
});

it('스위치가 꺼져 있으면 단추가 잠기고 안내가 보인다', async () => {
  vi.mocked(getSalesFeedback).mockResolvedValueOnce(stateOf({ switchOn: false }));
  renderCard();
  expect(await screen.findByTestId('feedback-switch-off')).toHaveTextContent('설정이 꺼져');
  expect(screen.getByTestId('feedback-request')).toBeDisabled();
});

it('보기 전용이면 단추가 잠긴다', async () => {
  vi.mocked(getSalesFeedback).mockResolvedValueOnce(stateOf({}));
  renderCard('viewer');
  await waitFor(() => expect(getSalesFeedback).toHaveBeenCalled());
  expect(screen.getByTestId('feedback-request')).toBeDisabled();
});
