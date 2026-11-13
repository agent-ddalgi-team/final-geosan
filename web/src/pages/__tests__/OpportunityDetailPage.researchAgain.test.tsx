// 상세(#677): 조사한 지 한 달(설정)이 지난 관심 회사에 다시 조사를 제안한다.
// 서버 호출(getOpportunityDetail·postHomepage)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import { getActivity, getOpportunityDetail, postHomepage } from '../../api/client';
import type { BookmarkRecord, Envelope, OpportunityDetail } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { companySummary, homepageControls } from '../../labels/ko';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';
import { daysAgo } from '../../utils/time';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  postHomepage: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedActivity = vi.mocked(getActivity);
const mockedHomepage = vi.mocked(postHomepage);
const base = detailFixture.data as unknown as OpportunityDetail;
const RESEARCHED_AT = new Date(Date.now() - 35 * 86_400_000).toISOString();

function bookmark(active: boolean): BookmarkRecord {
  return { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-01T09:00:00+09:00', active };
}

function detail(suggest: boolean | undefined, active = true): OpportunityDetail {
  return {
    ...base,
    header: {
      ...base.header,
      researchSource: 'AI',
      researchedAt: RESEARCHED_AT,
      researchSuggestAgain: suggest,
    },
    records: { ...base.records, bookmark: bookmark(active) },
  };
}

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

describe('상세 › 다시 조사 제안(#677)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedHomepage.mockReset();
    mockedActivity.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('서버가 제안하면 [다시 조사] 단추 옆에 "조사한 지 n일"이 보이고 단추가 강조된다', async () => {
    mockedGet.mockResolvedValueOnce(reply(detail(true)));
    renderPage();
    const hint = await screen.findByTestId('homepage-suggest-again');
    const days = daysAgo(RESEARCHED_AT) as number;
    expect(days).toBeGreaterThanOrEqual(34);
    expect(hint).toHaveTextContent(homepageControls.suggestAgain(days));
    // 새 단추를 만들지 않고 기존 [다시 조사] 단추를 강조한다.
    expect(screen.getAllByRole('button', { name: homepageControls.rerunButton })).toHaveLength(1);
    expect(screen.getByTestId('homepage-rerun-button')).toHaveClass('ant-btn-primary');
    expect(screen.getByTestId('company-suggest-again-tag')).toHaveTextContent(
      companySummary.suggestAgainTag,
    );
    // 알리기만 한다. 누르기 전에는 조사를 부르지 않는다.
    expect(mockedHomepage).not.toHaveBeenCalled();
  });

  it.each([
    ['제안이 거짓이면', false],
    ['칸이 없는 옛 응답이면', undefined],
  ])('%s 안내도 꼬리표도 없고 단추는 평소 모양이다', async (_, suggest) => {
    mockedGet.mockResolvedValueOnce(reply(detail(suggest)));
    renderPage();
    await screen.findByTestId('homepage-rerun-button');
    expect(screen.queryByTestId('homepage-suggest-again')).not.toBeInTheDocument();
    expect(screen.queryByTestId('company-suggest-again-tag')).not.toBeInTheDocument();
    expect(screen.getByTestId('homepage-rerun-button')).not.toHaveClass('ant-btn-primary');
  });

  it('화면에서 관심이 꺼져 있으면 단추 옆 안내를 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply(detail(true, false)));
    renderPage();
    await screen.findByTestId('homepage-rerun-button');
    expect(screen.queryByTestId('homepage-suggest-again')).not.toBeInTheDocument();
  });
});
