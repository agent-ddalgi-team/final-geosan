// 상세의 [통화 준비 💰] 자리(#680): 구분 줄 아래 "기록 남기기" 구역 맨 위. 읽는 곳에는 두지 않는다(#674).
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import { postCallPrep } from '../../api/assistant';
import { getActivity, getOpportunityDetail, getPeers } from '../../api/client';
import type { ConfigUi, OpportunityDetail } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  getPeers: vi.fn(),
}));
vi.mock('../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/assistant')>()),
  postCallPrep: vi.fn(),
}));

const mockedPrep = vi.mocked(postCallPrep);
const META = { updatedAt: '2026-10-20T09:00:00+09:00' };
// 상세 화면이 읽는 담당자 목록은 비워 두고 영업 비서 값만 준다.
const configWith = (enabled: boolean) =>
  ({ staff: [], assistant: { enabled, questionMaxLength: 300 } }) as unknown as ConfigUi;

function renderPage(config: ConfigUi | null) {
  vi.mocked(getOpportunityDetail).mockResolvedValue({
    data: detailFixture.data as unknown as OpportunityDetail,
    meta: META,
  });
  vi.mocked(getActivity).mockResolvedValue({ data: [], meta: META });
  vi.mocked(getPeers).mockRejectedValue(new Error('이 시험에서는 비슷한 회사를 보지 않는다'));
  render(
    <MemoryRouter initialEntries={['/opportunities/opp-1']}>
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
        <Routes>
          <Route path="/opportunities/:oppId" element={<OpportunityDetailPage />} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('상세 › 통화 준비 (#680)', () => {
  beforeEach(() => mockedPrep.mockReset());

  it('[통화 준비 💰]는 구분 줄 아래 "기록 남기기" 구역의 기록 칸 위에 있고, 누르면 답이 그 아래에 펴진다', async () => {
    const user = userEvent.setup();
    mockedPrep.mockResolvedValueOnce({
      data: {
        answer: '외주 여부부터 확인해 보세요.\n- 지금 도금은 어떻게 하나요?',
        sources: [{ oppId: 'opp-1', name: 'A정밀' }],
        aiGenerated: true,
        usedQueries: ['COMPANY_SUMMARY', 'PEERS'],
      },
      meta: {},
    });
    renderPage(configWith(true));
    const records = await screen.findByTestId('detail-records');
    const prep = within(records).getByTestId('call-prep');
    const divider = screen.getByTestId('detail-write-divider');
    expect(divider.compareDocumentPosition(prep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      prep.compareDocumentPosition(within(records).getByTestId('records-area')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(within(prep).getByTestId('call-prep-button'));
    expect(mockedPrep).toHaveBeenCalledWith('opp-1', 'park-lee');
    expect(await within(prep).findByTestId('assistant-answer-text')).toHaveTextContent(
      '외주 여부부터 확인해 보세요.',
    );
  });

  it('스위치가 꺼져 있으면 단추가 보이지 않는다', async () => {
    renderPage(configWith(false));
    await screen.findByTestId('detail-records');
    expect(screen.queryByTestId('call-prep-button')).not.toBeInTheDocument();
  });
});
