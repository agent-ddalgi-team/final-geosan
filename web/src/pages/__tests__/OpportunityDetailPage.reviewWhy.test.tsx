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

  it('검토사항 영역 안, 줄 목록 위에 연결된 공정 이름이 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems: [] }));
    renderPage();
    const review = await screen.findByTestId('detail-review');
    const why = within(review).getByTestId('review-why');
    const expected = [
      ...new Set(base.processLinks.map((link) => link.processName || link.processCode)),
    ];
    expect(within(why).getByTestId('review-why-processes')).toHaveTextContent(
      `연결된 공정: ${expected.join(', ')}`,
    );
    const area = within(review).getByTestId('review-area');
    expect(why.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('검토사항이 없는 옛 응답이면 "왜 추천했나"도 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, reviewItems: undefined }));
    renderPage();
    await screen.findByTestId('detail-header');
    expect(screen.queryByTestId('review-why')).not.toBeInTheDocument();
  });
});
