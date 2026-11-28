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

  // #803(PM 결정 2026-11-16): 따로 있던 "회사 소개 · 산업군" 카드를 없애고 "한눈에"의 산업 칸 안에서 바로 고쳤다.
  // #996(PM 결정 2026-11-29): 산업은 머리의 요약 줄에 값과 표시로 보이고, [확정]·[고치기] 칩은 [정보 고치기]를 눌러 편 칸 안에 있다.
  it('요약 줄에는 산업 값과 "AI 제안 · 확인 전"이 보이고, 칩은 [정보 고치기]를 편 칸의 산업 줄에 있다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply('AI'));
    renderPage();
    const industryLine = await screen.findByTestId('glance-fit-industry');
    expect(screen.getByTestId('detail-summary-row')).toContainElement(industryLine);
    expect(industryLine).toHaveTextContent(/^산업자동차 부품 ○AI 제안 · 확인 전$/);
    // 접혀 있을 때는 칩과 [확정]이 화면에 없다.
    expect(screen.queryByTestId('detail-industries')).not.toBeInTheDocument();
    expect(screen.queryByTestId('industry-confirm-button')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    const section = screen.getByTestId('detail-industries');
    expect(screen.getByTestId('detail-summary-fix-industry')).toContainElement(section);
    expect(within(section).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(section).getByTestId('industry-chip')).toHaveTextContent('자동차 부품 (AI 제안)');
    expect(screen.queryByTestId('detail-write-divider')).not.toBeInTheDocument();
  });

  it('[정보 고치기]를 펴고 [확정]을 누르면 저장한 뒤 상세와 활동 이력을 새로 불러오고 요약 줄과 칩이 초록 ✓로 바뀐다', async () => {
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
    await user.click(await screen.findByTestId('detail-summary-fix-toggle'));
    await user.click(screen.getByTestId('industry-confirm-button'));
    // 저장하면 상세를 새로 불러와 요약 줄이 다시 그려진다(고치기 칸은 접힌 채).
    await waitFor(() =>
      expect(screen.getByTestId('glance-fit-industry')).toHaveTextContent(
        /^산업자동차 부품 ✓확인됨$/,
      ),
    );
    expect(mockedPost).toHaveBeenCalledWith('opp-1', ['자동차 부품'], 'park-lee');
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedActivity.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('detail-summary-fix-panel')).not.toBeInTheDocument();
    // 다시 펴면 칩이 초록 ✓이고 [확정]은 없다.
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    expect(screen.getByTestId('industry-chip')).toHaveTextContent('자동차 부품 ✓');
    expect(screen.queryByTestId('industry-confirm-button')).not.toBeInTheDocument();
  });
});
