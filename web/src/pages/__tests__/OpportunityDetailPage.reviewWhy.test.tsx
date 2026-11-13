// 상세 › 공정 한 줄. 전에는 검토사항 맨 위 "왜 추천했나"(#619·#659)였고, #674(PM 결정 2026-11-13)부터 "한눈에" 상자의 "거산과 맞는 점"에 보인다.
// 옛 줄(`WhyRecommended`)의 부품 시험은 `components/review/__tests__/WhyRecommended.test.tsx`에 그대로 있다.
// 서버 호출(getOpportunityDetail)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import { getActivity, getOpportunityDetail } from '../../api/client';
import type { Envelope, OpportunityDetail } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedActivity = vi.mocked(getActivity);
const base = detailFixture.data as unknown as OpportunityDetail;

function reply(data: OpportunityDetail): Envelope<OpportunityDetail> {
  return { data, meta: { updatedAt: '2026-10-20T09:00:00+09:00' } };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/opportunities/opp-1']}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: 'park-lee',
          setStaffKey: () => {},
          canRecord: true,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <Routes>
          <Route path="/opportunities/:oppId" element={<OpportunityDetailPage />} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('상세 › "한눈에"의 공정 줄 (전에는 검토사항 맨 위 "왜 추천했나")', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedActivity.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('확정된 공정은 "한눈에"의 "거산과 맞는 점"에 이름·확정, 소재·판정으로 보이고 "공정 적합성 검토" 구역은 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems: [] }));
    renderPage();
    const glance = await screen.findByTestId('detail-glance');
    // 가상 사례의 공정 연결 1건(PM 지시 2026-11-13 #659 → #674에서 "한눈에"로 옮김).
    expect(base.processLinks).toHaveLength(1);
    expect(within(glance).getByTestId('glance-fit-process')).toHaveTextContent(
      /^공정아노다이징 — 가상 ✓확인됨$/,
    );
    expect(within(glance).getByTestId('glance-fit-material')).toHaveTextContent(
      /^소재알루미늄 주물 ✓통과$/,
    );
    // 같은 내용을 두 군데에 쓰지 않는다: 아래쪽 구역도, 옛 "왜 추천했나" 줄도 그리지 않는다.
    expect(screen.queryByTestId('detail-process-links')).not.toBeInTheDocument();
    expect(screen.queryByTestId('process-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-why')).not.toBeInTheDocument();
  });

  it('공정 연결이 모두 AI 제안이면 중립 표시 "AI 제안 · 확인 전"이 보이고, AI 공정 제안 줄과 [확정]은 화면에 없다 (#659 → #674)', async () => {
    const reviewItems = base.processLinks.map((link) => ({
      itemId: `PL:${link.processCode}`,
      kind: 'PROCESS_LINK_PROPOSAL',
      source: 'AI',
      text: `AI 공정 연결 제안 · ${link.processName || link.processCode} · 근거: 인용 없음`,
      checked: false,
    })) as unknown as OpportunityDetail['reviewItems'];
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems }));
    renderPage();
    const glance = await screen.findByTestId('detail-glance');
    const count = new Set(base.processLinks.map((link) => link.processCode)).size;
    expect(count).toBe(1);
    const process = within(glance).getByTestId('glance-fit-process');
    expect(process).toHaveTextContent('AI 제안 · 확인 전');
    expect(within(process).getByTestId('glance-fit-mark')).toHaveAttribute('data-mark', 'ai');
    // "확인할 것"과 "통화에서 확인할 것"이 공정을 말한다.
    expect(within(glance).getByTestId('glance-check-text')).toHaveTextContent('공정');
    const review = screen.getByTestId('detail-review');
    expect(within(review).getByText('공정 —')).toBeInTheDocument();
    expect(review).not.toHaveTextContent('AI 공정 연결 제안');
    expect(screen.queryByTestId('review-proposal-confirm')).not.toBeInTheDocument();
  });

  it('검토사항이 없는 옛 응답이면 "왜 추천했나"도 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems: undefined }));
    renderPage();
    await screen.findByTestId('detail-header');
    expect(screen.queryByTestId('review-why')).not.toBeInTheDocument();
  });
});
