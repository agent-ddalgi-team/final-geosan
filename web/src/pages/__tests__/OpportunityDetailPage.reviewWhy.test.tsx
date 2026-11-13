// 상세 › 검토사항 맨 위 "왜 추천했나"(#619): 검토사항 영역 안, 줄 목록 위에 붙는다. 검토사항이 없는 옛 응답이면 없다.
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

describe('상세 › 검토사항 "왜 추천했나"', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedActivity.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('검토사항 영역 안, 줄 목록 위에 공정 한 줄이 보이고 "공정 적합성 검토" 구역은 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems: [] }));
    renderPage();
    const review = await screen.findByTestId('detail-review');
    const why = within(review).getByTestId('review-why');
    // 가상 사례의 공정 연결 1건: 이름 · 적용 소재 · 판정을 한 줄로(PM 지시 2026-11-13 #659).
    expect(base.processLinks).toHaveLength(1);
    expect(within(why).getByTestId('review-why-processes')).toHaveTextContent(
      /^공정: 아노다이징 — 가상 · 소재 알루미늄 주물 · 통과$/,
    );
    // 같은 내용을 두 군데에 쓰지 않는다: 아래쪽 구역은 그리지 않는다.
    expect(screen.queryByTestId('detail-process-links')).not.toBeInTheDocument();
    expect(screen.queryByTestId('process-link')).not.toBeInTheDocument();
    const area = within(review).getByTestId('review-area');
    expect(why.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('공정 연결이 모두 AI 제안이면 "공정 확인 전 · AI 제안 n개"가 보이고 접힌 제안 줄은 그대로다(#659)', async () => {
    const reviewItems = base.processLinks.map((link) => ({
      itemId: `PL:${link.processCode}`,
      kind: 'PROCESS_LINK_PROPOSAL',
      source: 'AI',
      text: `AI 공정 연결 제안 · ${link.processName || link.processCode} · 근거: 인용 없음`,
      checked: false,
    })) as unknown as OpportunityDetail['reviewItems'];
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems }));
    renderPage();
    const review = await screen.findByTestId('detail-review');
    const why = within(review).getByTestId('review-why');
    expect(within(why).queryByTestId('review-why-processes')).not.toBeInTheDocument();
    const count = new Set(base.processLinks.map((link) => link.processCode)).size;
    expect(within(why).getByTestId('review-why-process-unconfirmed')).toHaveTextContent(
      `공정 확인 전 · AI 제안 ${count}개`,
    );
    expect(within(review).getByTestId('review-area')).toHaveTextContent('AI 공정 연결 제안');
  });

  it('검토사항이 없는 옛 응답이면 "왜 추천했나"도 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems: undefined }));
    renderPage();
    await screen.findByTestId('detail-header');
    expect(screen.queryByTestId('review-why')).not.toBeInTheDocument();
  });
});
