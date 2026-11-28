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

// #996(PM 결정 2026-11-29): 공정 · 소재는 "한눈에 › 거산과 맞는 점"에서 머리의 요약 줄로 옮겨 갔다. 값과 표시는 같고
// 찾는 자리만 요약 줄로 바꿨다. "한눈에 › 확인할 것" 줄은 "확인할 점" 핵심 줄로 바뀌었다.
describe('상세 › 요약 줄의 공정 칸 (전에는 "한눈에"의 공정 줄, 그 전에는 검토사항 맨 위 "왜 추천했나")', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedActivity.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('확정된 공정은 요약 줄에 이름·확정, 소재·판정으로 보이고 "공정 적합성 검토" 구역은 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems: [] }));
    renderPage();
    const summary = await screen.findByTestId('detail-summary-row');
    // 가상 사례의 공정 연결 1건(PM 지시 2026-11-13 #659 → #674에서 "한눈에"로 → #996에서 요약 줄로 옮김).
    expect(base.processLinks).toHaveLength(1);
    expect(within(summary).getByTestId('glance-fit-process')).toHaveTextContent(
      /^공정아노다이징 — 가상 ✓확인됨$/,
    );
    expect(within(summary).getByTestId('glance-fit-material')).toHaveTextContent(
      /^소재알루미늄 주물 ✓통과$/,
    );
    // 한 곳에만 보인다: "한눈에"에는 공정 · 소재 칸이 없고, 맞는 점 핵심 줄이 확정 값으로 적힌다.
    const glance = screen.getByTestId('detail-glance');
    expect(within(glance).queryByTestId('glance-fit-process')).not.toBeInTheDocument();
    expect(
      within(within(glance).getByTestId('glance-key-fit')).getByTestId('glance-key-text'),
    ).toHaveTextContent(/^공정 아노다이징 — 가상 확인됨 · 소재 알루미늄 주물 통과$/);
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
    const summary = await screen.findByTestId('detail-summary-row');
    const count = new Set(base.processLinks.map((link) => link.processCode)).size;
    expect(count).toBe(1);
    const process = within(summary).getByTestId('glance-fit-process');
    expect(process).toHaveTextContent('AI 제안 · 확인 전');
    expect(within(process).getByTestId('glance-fit-mark')).toHaveAttribute('data-mark', 'ai');
    // "한눈에"의 "확인할 점"과 영업 코치 "확인사항"이 공정을 말한다. 확정 공정이 없으니 "맞는 점" 줄은 없다.
    const glance = screen.getByTestId('detail-glance');
    expect(
      within(within(glance).getByTestId('glance-key-check')).getByTestId('glance-key-text'),
    ).toHaveTextContent(/^확인 전: 공정/);
    expect(within(glance).queryByTestId('glance-key-fit')).not.toBeInTheDocument();
    const review = screen.getByTestId('detail-review');
    // #847: 확인사항 "회사 확인" 묶음의 짧은 요약 "맡길 공정".
    expect(within(review).getByTestId('check-group-company')).toHaveTextContent('맡길 공정');
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
