// 상세의 "영업 코치 · 통화 전" 칸(#680 자리, #750부터 저장된 코치 정리만): 구분 줄 아래 "기록 남기기" 구역 맨 위.
// 읽는 곳에는 두지 않는다(#674).
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
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
const META = { updatedAt: '2026-10-20T09:00:00+09:00' };
// 상세 화면이 읽는 담당자 목록은 비워 두고 영업 비서 값만 준다.
const configWith = (enabled: boolean) =>
  ({ staff: [], assistant: { enabled, questionMaxLength: 300 } }) as unknown as ConfigUi;

const PREP = {
  noteId: 'note-7',
  lines: ['외주처는 어디인가요?', '방문 날짜를 정할 수 있을까요?'],
  at: '2026-11-15T10:00:00+09:00',
  by: 'park-lee',
};

function renderPage(config: ConfigUi | null, callPrep: typeof PREP | null = PREP) {
  const base = detailFixture.data as unknown as OpportunityDetail;
  vi.mocked(getOpportunityDetail).mockResolvedValue({
    data: { ...base, records: { ...base.records, callPrep } },
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

describe('상세 › 확인사항 › 지난 통화에서 이어서 (#750 → #847)', () => {
  // #847(PM 결정 2026-11-17): 지난 통화 뒤 코치 정리는 따로 칸이 아니라 확인사항 맨 위 묶음이다(기록 칸 위).
  it('확인사항 맨 위 "지난 통화에서 이어서 · 11/15" 묶음에 코치가 정리한 물어볼 것이 체크칸과 함께 보이고, [통화 준비] 단추는 없다', async () => {
    renderPage(configWith(true));
    const records = await screen.findByTestId('detail-records');
    const group = within(records).getByTestId('check-group-prep');
    expect(screen.queryByTestId('detail-write-divider')).not.toBeInTheDocument();
    expect(
      group.compareDocumentPosition(within(records).getByTestId('records-area')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(group).getByTestId('check-group-title')).toHaveTextContent(
      '지난 통화에서 이어서 · 11/15',
    );
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
    expect(group).toHaveTextContent('외주처는 어디인가요?');
    expect(screen.queryByTestId('call-prep-button')).not.toBeInTheDocument();
  });

  it('남긴 정리가 없으면 그 묶음이 보이지 않는다', async () => {
    renderPage(configWith(false), null);
    await screen.findByTestId('detail-records');
    expect(screen.queryByTestId('check-group-prep')).not.toBeInTheDocument();
  });
});
