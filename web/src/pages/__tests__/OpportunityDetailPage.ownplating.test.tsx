// 상세 머리(#364): 표면처리를 직접 하는 회사일 수 있음 꼬리표. 참일 때만 보이고, 거짓·칸 없음이면 아무것도 안 보인다.
// 서버 호출(getOpportunityDetail)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import { getActivity, getOpportunityDetail } from '../../api/client';
import type { Envelope, OpportunityDetail } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { ownPlatingLine } from '../../labels/ko';
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

describe('상세 머리 › 표면처리를 직접 하는 회사일 수 있음 꼬리표', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedActivity.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('표시가 참이면 머리에 카드와 같은 글자의 꼬리표가 보인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, header: { ...base.header, ownPlatingLineSuspected: true } }),
    );
    renderPage();
    const header = await screen.findByTestId('detail-header');
    const tag = await screen.findByTestId('detail-own-plating-tag');
    expect(header).toContainElement(tag);
    expect(tag).toHaveTextContent(ownPlatingLine.tag);
  });

  it('표시가 거짓이면 꼬리표가 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, header: { ...base.header, ownPlatingLineSuspected: false } }),
    );
    renderPage();
    await screen.findByTestId('detail-header');
    expect(screen.queryByTestId('detail-own-plating-tag')).not.toBeInTheDocument();
  });

  it('칸이 없는 옛 응답이면 꼬리표가 보이지 않는다', async () => {
    const header = { ...base.header };
    delete header.ownPlatingLineSuspected;
    mockedGet.mockResolvedValueOnce(reply({ ...base, header }));
    renderPage();
    await screen.findByTestId('detail-header');
    expect(screen.queryByTestId('detail-own-plating-tag')).not.toBeInTheDocument();
  });
});
