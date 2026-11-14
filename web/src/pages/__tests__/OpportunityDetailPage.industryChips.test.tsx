// 상세 산업군 칩(#646): 구분 줄 아래(적는 곳) 맨 앞에 보이고, [확정]하면 상세와 활동 이력을 새로 불러와 초록 ✓로 바뀐다.
// 서버 호출(getOpportunityDetail·getActivity·postIndustries)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import { getActivity, getOpportunityDetail, getPeers, postIndustries } from '../../api/client';
import type { Envelope, OpportunityDetail } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  getPeers: vi.fn(),
  postIndustries: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedActivity = vi.mocked(getActivity);
const mockedPeers = vi.mocked(getPeers);
const mockedPost = vi.mocked(postIndustries);
const base = detailFixture.data as unknown as OpportunityDetail;
const META = { updatedAt: '2026-10-20T09:00:00+09:00' };

function reply(source: 'AI' | 'STAFF'): Envelope<OpportunityDetail> {
  return {
    data: {
      ...base,
      header: { ...base.header, industries: ['자동차 부품'], industriesSource: source },
    },
    meta: META,
  };
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

describe('상세 › 산업군 칩 (#646)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPost.mockReset();
    mockedActivity.mockReset();
    mockedActivity.mockResolvedValue({ data: [], meta: META });
    mockedPeers.mockReset();
    mockedPeers.mockRejectedValue(new Error('이 시험에서는 비슷한 회사를 보지 않는다'));
  });

  it('칩은 구분 줄 아래 적는 곳의 맨 앞(검토 의견 위)에 있고, 읽는 곳 "한눈에"의 산업 줄은 그대로다', async () => {
    mockedGet.mockResolvedValue(reply('AI'));
    renderPage();
    const section = await screen.findByTestId('detail-industries');
    const divider = screen.getByTestId('detail-write-divider');
    const opinion = screen.getByTestId('detail-opinion');
    expect(
      divider.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      section.compareDocumentPosition(opinion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(section).getByTestId('industry-chip')).toHaveTextContent('자동차 부품 (AI 제안)');
    expect(screen.getByTestId('glance-fit-industry')).toHaveTextContent('자동차 부품');
  });

  it('[확정]을 누르면 저장한 뒤 상세와 활동 이력을 새로 불러오고 칩이 초록 ✓로 바뀐다', async () => {
    mockedGet.mockResolvedValueOnce(reply('AI')).mockResolvedValue(reply('STAFF'));
    mockedPost.mockResolvedValueOnce({
      data: {
        industries: ['자동차 부품'],
        industriesSource: 'STAFF',
        industriesConfirmedAt: '2026-11-14T09:00:00+09:00',
      },
      meta: META,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('industry-confirm-button'));
    await waitFor(() =>
      expect(screen.getByTestId('industry-chip')).toHaveTextContent('자동차 부품 ✓'),
    );
    expect(mockedPost).toHaveBeenCalledWith('opp-1', ['자동차 부품'], 'park-lee');
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedActivity.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('industry-confirm-button')).not.toBeInTheDocument();
  });
});
