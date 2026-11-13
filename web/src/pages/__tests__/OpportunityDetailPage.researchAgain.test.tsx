// 상세(#677): 조사한 지 한 달(설정)이 지난 관심 회사에 다시 조사를 제안하고,
// 확정한 공정과 다른 AI 공정 제안은 덮어쓰지 않고 "AI는 다르게 봄" 줄로 알려 고르게 한다.
// 서버 호출(getOpportunityDetail·postHomepage·postReviewCheck)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import {
  ApiError,
  getActivity,
  getOpportunityDetail,
  postHomepage,
  postReviewCheck,
} from '../../api/client';
import type { BookmarkRecord, Envelope, OpportunityDetail, ReviewItem } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { companySummary, detailReport, homepageControls } from '../../labels/ko';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';
import { daysAgo } from '../../utils/time';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  postHomepage: vi.fn(),
  postReviewCheck: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedActivity = vi.mocked(getActivity);
const mockedHomepage = vi.mocked(postHomepage);
const mockedCheck = vi.mocked(postReviewCheck);
const difference = detailReport.glance.difference;
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

function renderPage(canRecord = true) {
  render(
    <MemoryRouter initialEntries={['/opportunities/opp-1']}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: canRecord ? 'park-lee' : null,
          setStaffKey: () => {},
          canRecord,
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

/** 가짜 응답의 확정 공정은 "아노다이징 — 가상" 하나다. 여기에 AI가 다른 공정(아연도금)을 제안한 모양. */
const PROPOSED = '아연도금(전기아연도금)';
const proposal: ReviewItem = {
  itemId: 'PL:ZINC_PLATING',
  kind: 'PROCESS_LINK_PROPOSAL',
  source: 'AI',
  text: `AI 공정 연결 제안 · ${PROPOSED} · 근거: 인용 없음`,
  checked: false,
};
const CONFIRMED = base.processLinks[0].processName as string;

function withProposal(): OpportunityDetail {
  return { ...base, reviewItems: [...(base.reviewItems ?? []), proposal] };
}

function saved(checked: boolean) {
  return {
    data: {
      itemId: proposal.itemId,
      checked,
      checkedBy: 'park-lee',
      checkedAt: '2026-11-14T09:00:00+09:00',
    },
    meta: { updatedAt: '2026-11-14T09:00:00+09:00', reevaluated: true },
  };
}

describe('상세 › 한눈에 › AI 공정 제안이 확정 값과 다를 때(#677)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedCheck.mockReset();
    mockedActivity.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('확정 공정은 그대로 보이고 그 아래에 "AI 새 제안 · 확정 값"과 두 단추가 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply(withProposal()));
    renderPage();
    const line = await screen.findByTestId('glance-process-difference-line');
    expect(line).toHaveTextContent(difference.tag);
    expect(line).toHaveTextContent(difference.line(PROPOSED, [CONFIRMED]));
    expect(screen.getByTestId('glance-process-keep')).toHaveTextContent(difference.keep);
    expect(screen.getByTestId('glance-process-add')).toHaveTextContent(difference.add(PROPOSED));
    // 확정 값은 공정 줄에 "확인됨"으로 그대로다.
    expect(screen.getByTestId('glance-fit-process')).toHaveTextContent(CONFIRMED);
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('[확정 값 유지]를 누르면 그 제안을 물리치는 저장을 보내고, 새로 불러온 뒤 줄이 사라진다', async () => {
    mockedGet.mockResolvedValueOnce(reply(withProposal())).mockResolvedValueOnce(reply(base));
    mockedCheck.mockResolvedValueOnce(saved(false));
    renderPage();
    await userEvent.click(await screen.findByTestId('glance-process-keep'));
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      'PL:ZINC_PLATING',
      { checked: false, evalId: base.evalId },
      'park-lee',
    );
    await waitFor(() =>
      expect(screen.queryByTestId('glance-process-difference')).not.toBeInTheDocument(),
    );
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('glance-fit-process')).toHaveTextContent(CONFIRMED);
  });

  it('[○○도 추가]를 누르면 기존 확정 저장(checked:true)을 보낸다', async () => {
    mockedGet.mockResolvedValueOnce(reply(withProposal())).mockResolvedValueOnce(reply(base));
    mockedCheck.mockResolvedValueOnce(saved(true));
    renderPage();
    await userEvent.click(await screen.findByTestId('glance-process-add'));
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      'PL:ZINC_PLATING',
      { checked: true, evalId: base.evalId },
      'park-lee',
    );
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });

  it('저장에 실패하면 서버 안내를 그 줄 아래에 보이고 줄은 남는다', async () => {
    mockedGet.mockResolvedValueOnce(reply(withProposal()));
    mockedCheck.mockRejectedValueOnce(
      new ApiError(400, { message: '서버 안내', nextAction: '다음 행동', ref: 'ref-1' }),
    );
    renderPage();
    await userEvent.click(await screen.findByTestId('glance-process-keep'));
    expect(await screen.findByTestId('glance-process-error')).toHaveTextContent('서버 안내');
    expect(screen.getByTestId('glance-process-difference-line')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('확정한 공정이 없고 AI 제안만 있으면 이 줄은 없고 지금처럼 "AI 제안 · 확인 전"으로 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...withProposal(), processLinks: [] }));
    renderPage();
    expect(await screen.findByTestId('glance-fit-process')).toHaveTextContent(PROPOSED);
    expect(screen.queryByTestId('glance-process-difference')).not.toBeInTheDocument();
  });

  it('AI 제안이 없으면 이 줄은 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    await screen.findByTestId('glance-fit-process');
    expect(screen.queryByTestId('glance-process-difference')).not.toBeInTheDocument();
  });

  it('담당자를 고르기 전에는 단추가 잠기고 안내가 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply(withProposal()));
    renderPage(false);
    expect(await screen.findByTestId('glance-process-keep')).toBeDisabled();
    expect(screen.getByTestId('glance-process-add')).toBeDisabled();
    expect(screen.getByTestId('glance-process-pick-staff')).toHaveTextContent(
      difference.pickStaffFirst,
    );
  });
});
