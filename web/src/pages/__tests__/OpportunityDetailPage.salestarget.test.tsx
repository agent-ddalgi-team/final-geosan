// #697(PM 결정 2026-11-13) 상세 화면: 접촉을 남기면 검토 의견 칸이 "영업 대상"으로 바뀌어 보이고,
// 제외한 회사에 접촉을 남기려 하면 그 자리에서 한 번 묻는다.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(의견을 정하는 것은 서버다).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import {
  getActivity,
  getOpportunityDetail,
  getPeers,
  getSalesQuestions,
  postOpinion,
  postOutcome,
} from '../../api/client';
import type { Envelope, OpinionRecord, OpportunityDetail } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  getPeers: vi.fn(),
  getSalesQuestions: vi.fn(),
  postOpinion: vi.fn(),
  postOutcome: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedOutcome = vi.mocked(postOutcome);
const mockedOpinion = vi.mocked(postOpinion);
const fixtureData = detailFixture.data as unknown as OpportunityDetail;

function opinion(value: OpinionRecord['opinion'], version: number): OpinionRecord {
  return {
    version,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-14T01:00:00Z',
    opinion: value,
    reason: value === 'NOT_TARGET' ? '가상 제외 사유' : null,
    memo: null,
  };
}

function detail(record: OpinionRecord | null): Envelope<OpportunityDetail> {
  return {
    data: { ...fixtureData, records: { ...fixtureData.records, opinion: record } },
    meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
  };
}

const savedContact = {
  data: {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-14T01:00:00Z',
    status: 'IN_PROGRESS' as const,
  },
  meta: {},
};

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

async function pressSaveCall(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('records-contact-result'), '부재');
  await user.click(screen.getByTestId('records-contact-save-button'));
}

describe('상세 화면 · 접촉을 남기면 영업 대상 (#697)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedOutcome.mockReset();
    mockedOpinion.mockReset();
    vi.mocked(getActivity).mockResolvedValue({ data: [], meta: {} });
    vi.mocked(getPeers).mockRejectedValue(new Error('비슷한 회사는 이 시험에서 보지 않는다'));
    vi.mocked(getSalesQuestions).mockRejectedValue(
      new Error('질문 파일은 이 시험에서 쓰지 않는다'),
    );
  });

  it('검토 의견 단추 세 개가 새 말(영업 대상·검토 중·제외)로 보인다', async () => {
    mockedGet.mockResolvedValue(detail(null));
    renderPage();
    const area = within(await screen.findByTestId('detail-opinion'));
    expect(area.getByTestId('opinion-worth-review-button')).toHaveTextContent('영업 대상');
    expect(area.getByTestId('opinion-need-check-button')).toHaveTextContent('검토 중');
    expect(area.getByTestId('opinion-not-target-button')).toHaveTextContent('제외');
    expect(area.queryByText(/검토 권고|추가 확인 필요|검토 대상 제외/)).not.toBeInTheDocument();
  });

  it('의견 없는 회사에 접촉을 저장하면 묻지 않고 저장하고, 다시 받은 의견 "영업 대상"이 검토 의견 칸에 보인다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(detail(null));
    // 접촉 저장 뒤 조용히 다시 받는 상세: 서버가 의견을 영업 대상으로 정해 두었다.
    mockedGet.mockResolvedValue(detail(opinion('WORTH_REVIEW', 1)));
    mockedOutcome.mockResolvedValueOnce(savedContact);
    renderPage();
    await screen.findByTestId('opportunity-detail');
    await pressSaveCall(user);
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('records-excluded-ask')).not.toBeInTheDocument();
    expect(mockedOutcome.mock.calls[0][1]).not.toHaveProperty('restoreExcluded');
    await waitFor(() =>
      expect(screen.getByTestId('detail-opinion')).toHaveTextContent('의견: 영업 대상'),
    );
    // 화면이 의견을 따로 저장하지 않는다(서버가 같은 저장 안에서 정한다).
    expect(mockedOpinion).not.toHaveBeenCalled();
  });

  it('제외한 회사에 접촉을 저장하려 하면 한 번 묻고, 되돌리고 저장하면 검토 의견 칸이 "영업 대상"으로 바뀐다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(detail(opinion('NOT_TARGET', 1)));
    mockedGet.mockResolvedValue(detail(opinion('WORTH_REVIEW', 2)));
    mockedOutcome.mockResolvedValueOnce(savedContact);
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(screen.getByTestId('detail-opinion')).toHaveTextContent('의견: 제외');
    await pressSaveCall(user);
    expect(screen.getByTestId('records-excluded-ask')).toHaveTextContent(
      '제외한 회사입니다. 영업 대상으로 되돌릴까요?',
    );
    expect(mockedOutcome).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('records-excluded-restore-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({ restoreExcluded: true });
    await waitFor(() =>
      expect(screen.getByTestId('detail-opinion')).toHaveTextContent('의견: 영업 대상'),
    );
    // 영업 대상으로 돌아온 뒤에는 다음 접촉에서 다시 묻지 않는다.
    mockedOutcome.mockResolvedValueOnce(savedContact);
    await pressSaveCall(user);
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('records-excluded-ask')).not.toBeInTheDocument();
  });

  it('의견 칸에서 방금 "제외"로 저장한 회사도 접촉을 저장하려 하면 묻는다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(detail(null));
    mockedOpinion.mockResolvedValueOnce({ data: opinion('NOT_TARGET', 1), meta: {} });
    renderPage();
    await screen.findByTestId('opportunity-detail');
    await user.click(screen.getByTestId('opinion-not-target-button'));
    await user.type(screen.getByTestId('opinion-reason-input'), '가상 제외 사유');
    await user.click(screen.getByTestId('opinion-reason-save-button'));
    await waitFor(() => expect(mockedOpinion).toHaveBeenCalledTimes(1));
    await pressSaveCall(user);
    expect(await screen.findByTestId('records-excluded-ask')).toBeInTheDocument();
    expect(mockedOutcome).not.toHaveBeenCalled();
  });
});
