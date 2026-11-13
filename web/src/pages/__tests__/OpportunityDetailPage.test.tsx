// 근거 상세(S2): 영역 순서 / 질문 3개+펼치기 / 요구 0개 문구 / 확인·추정 글자 / 점수 접힘 / 404 (+ 요구 표, 오류).
// 서버 호출(getOpportunityDetail)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import {
  ApiError,
  getActivity,
  getOpportunityDetail,
  getPeers,
  postNote,
  postOutcome,
  postQuestionReply,
  postRecordCancel,
  postRelation,
  postReviewCheck,
  putBookmark,
} from '../../api/client';
import type { BookmarkRecord, Envelope, OpportunityDetail, Question } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import {
  detailReport,
  detailSections,
  frame,
  opinionArea,
  peersArea,
  recordsArea,
  reviewArea,
  scoreTags,
  states,
} from '../../labels/ko';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  getPeers: vi.fn(),
  postQuestionReply: vi.fn(),
  postNote: vi.fn(),
  postRecordCancel: vi.fn(),
  postRelation: vi.fn(),
  postReviewCheck: vi.fn(),
  postOutcome: vi.fn(),
  putBookmark: vi.fn(),
}));

const mockedNote = vi.mocked(postNote);
const mockedCancel = vi.mocked(postRecordCancel);
const mockedBookmark = vi.mocked(putBookmark);
const mockedOutcome = vi.mocked(postOutcome);
const mockedRelation = vi.mocked(postRelation);
const mockedCheck = vi.mocked(postReviewCheck);
const mockedGet = vi.mocked(getOpportunityDetail);
const mockedReply = vi.mocked(postQuestionReply);
const mockedActivity = vi.mocked(getActivity);
const mockedPeers = vi.mocked(getPeers);
const fixtureData = detailFixture.data as unknown as OpportunityDetail;
// 가짜 응답 파일에는 검토사항이 들어 있다. 아래 시험은 "서버가 아직 검토사항을 안 주는" 모양에서 시작한다.
const base: OpportunityDetail = { ...fixtureData, reviewItems: undefined };

function reply(data: OpportunityDetail): Envelope<OpportunityDetail> {
  return { data, meta: { updatedAt: '2026-10-20T09:00:00+09:00' } };
}

function question(n: number): Question {
  return {
    ...base.reasons.questions[0],
    questionId: `q-${n}`,
    text: `확인 질문 ${n}`,
  };
}

function renderPage(setPageTitle = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/opportunities/opp-1']}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: 'park-lee',
          setStaffKey: () => {},
          canRecord: true,
          setBannerMeta: () => {},
          setPageTitle,
        }}
      >
        <Routes>
          <Route path="/opportunities/:oppId" element={<OpportunityDetailPage />} />
          <Route path="/opportunities" element={<p>목록 화면</p>} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
  return setPageTitle;
}

describe('OpportunityDetailPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedActivity.mockReset();
    mockedPeers.mockReset();
    mockedPeers.mockResolvedValue({
      data: {
        summary: {
          processCount: 0,
          industryCount: 0,
          stageCounts: {},
          topLostReasons: [],
          contactReach: {},
        },
        companies: [],
      },
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
    mockedReply.mockReset();
    mockedRelation.mockReset();
    mockedCheck.mockReset();
    mockedOutcome.mockReset();
    mockedBookmark.mockReset();
    mockedNote.mockReset();
    mockedCancel.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('서버가 검토사항을 주면 "2. 통화에서 확인할 것"이 읽기 전용 목록으로 보이고 줄마다의 체크·단추는 없다 (#674)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        reasons: { ...base.reasons, questions: [1, 2].map(question) },
        reviewItems: [
          {
            itemId: 'Q:q-1',
            kind: 'QUESTION',
            source: 'AI',
            text: '확인 질문 1',
            targetLabel: '거산',
            checked: false,
          },
          {
            itemId: 'GAP:EVIDENCE',
            kind: 'DATA_NOT_FOUND',
            source: 'RULE',
            text: '근거를 찾지 못함',
            targetLabel: null,
            checked: true,
            checkedBy: 'park-lee',
            checkedAt: '2026-11-06T14:20:00+09:00',
          },
        ],
      }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    // 읽는 곳 순서(PM 결정 2026-11-13 #674): 한눈에 → 1. 왜 이 회사인가 → 2. 통화에서 확인할 것 → 3. 점수 자세히 보기.
    // "근거 자료"는 따로 구역을 두지 않고 1번 안에 붙는다.
    expect(headings.slice(0, 4)).toEqual([
      detailReport.glance.title,
      detailSections.reasons,
      detailSections.callChecklist,
      expect.stringContaining(detailSections.scores),
    ]);
    expect(headings).not.toContain(detailSections.evidence);
    expect(screen.queryByTestId('detail-questions')).not.toBeInTheDocument();
    const review = screen.getByTestId('detail-review');
    const rows = within(review).getAllByTestId('review-item');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('확인 질문 1');
    // 이미 저장돼 있던 확인 표시는 그 줄 아래에 읽기 전용으로 보인다.
    expect(within(rows[1]).getByTestId('review-checked-by')).toHaveTextContent('✓ 확인함');
    // 읽는 곳에는 체크·[답 적기]·[메모 적기]·[붙여넣고 조사]·진행 수가 없다.
    expect(within(review).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(review).queryByTestId('review-progress')).not.toBeInTheDocument();
    for (const id of ['review-reply-button', 'review-memo-button', 'review-paste-button']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it('서버가 검토사항을 아직 안 주면(옛 응답) 2번 자리에 후속 조치와 확인 질문이 예전 모양으로 보인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, reasons: { ...base.reasons, questions: [1].map(question) } }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(screen.queryByTestId('call-list')).not.toBeInTheDocument();
    const review = screen.getByTestId('detail-review');
    expect(within(review).getByTestId('detail-questions')).toBeInTheDocument();
    expect(within(review).getByTestId('detail-next-action')).toHaveTextContent(
      base.reasons.nextAction,
    );
  });

  it('가짜 응답 파일의 검토사항에는 질문 줄 답 1건이 있고 "답: …"이 읽기 전용으로 보인다 ([답 적기]·[답 고치기]는 없다, #674)', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const user = userEvent.setup();
    const review = screen.getByTestId('detail-review');
    // 질문 2줄은 바로 보이고, 기록이 없는 "자료 못 찾음" 1줄은 접혀 있다가 누르면 읽기 전용으로 펼쳐진다.
    expect(within(review).getAllByTestId('review-item')).toHaveLength(2);
    const fold = within(review).getByTestId('review-fold-toggle-gap');
    expect(fold).toHaveTextContent('아직 근거·자료가 없는 항목 1개 보기');
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    await user.click(fold);
    const rows = within(review).getAllByTestId('review-item');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('홈페이지를 찾지 못함');
    expect(within(rows[0]).getByTestId('review-reply')).toHaveTextContent(
      '답: 2024년에 KS 인증 받았다고 함',
    );
    expect(within(rows[1]).queryByTestId('review-reply')).not.toBeInTheDocument();
    // 적는 것은 아래 "기록 남기기"에서 한다. 읽는 곳에는 답 단추가 없다.
    expect(screen.queryByTestId('review-reply-button')).not.toBeInTheDocument();
    expect(screen.queryByText(reviewArea.replyEdit)).not.toBeInTheDocument();
    expect(screen.queryByText(reviewArea.replyAdd)).not.toBeInTheDocument();
  });

  it('읽는 곳에서는 답을 저장하는 요청을 보내지 않는다: 답 입력칸이 없고 활동 이력은 한 번만 불러온다 (#674)', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('review-reply-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-reply-save')).not.toBeInTheDocument();
    expect(mockedReply).not.toHaveBeenCalled();
  });

  it('맨 아래에 "비슷한 회사 참고"가 붙고 이 회사의 비슷한 회사를 불러와 보인다 (#269)', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    mockedPeers.mockResolvedValue({
      data: {
        summary: {
          processCount: 1,
          industryCount: 0,
          stageCounts: { IN_PROGRESS: 1 },
          topLostReasons: [],
          contactReach: {},
        },
        companies: [
          {
            oppId: 'opp-peer-1',
            name: '코파스',
            processCodes: ['ZINC_PLATING'],
            industries: [],
            outcomeStatus: 'IN_PROGRESS',
            lostReasonCode: null,
            lastContactAt: null,
            lastContactMethod: null,
            lastNote: null,
            sameProcess: true,
            sameIndustry: false,
          },
        ],
      },
      meta: { updatedAt: '2026-11-12T09:00:00+09:00' },
    });
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const section = screen.getByTestId('detail-peers');
    expect(await within(section).findByTestId('peer-company-name')).toHaveTextContent('코파스');
    expect(mockedPeers).toHaveBeenCalledWith('opp-1', expect.any(AbortSignal));
  });

  it('비슷한 회사를 못 불러와도 상세의 다른 영역은 그대로 보이고 그 영역만 [다시 불러오기]를 보인다 (#269)', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    mockedPeers.mockRejectedValue(
      new ApiError(500, { message: '서버 오류', nextAction: '잠시 뒤', ref: 'r-1' }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(await screen.findByTestId('peers-error')).toBeInTheDocument();
    expect(screen.getByTestId('detail-records')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-error')).not.toBeInTheDocument();
  });

  it('자료 줄에 저장돼 있던 메모는 그 줄 아래에 읽기 전용으로 보이고 [메모 적기]·[붙여넣고 조사]는 없다 (#674)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        reviewItems: [
          {
            itemId: 'GAP:HOMEPAGE',
            kind: 'DATA_NOT_FOUND',
            source: 'RULE',
            text: '홈페이지를 찾지 못함',
            targetLabel: null,
            checked: false,
            note: {
              text: '홈페이지 연혁에 2023 납품 기재 https://example.com/history',
              by: 'park-lee',
              at: '2026-11-20T10:00:00+09:00',
            },
          },
        ],
      }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    // 기록이 달린 줄은 접히지 않고 바로 보인다.
    const memo = screen.getByTestId('review-memo');
    expect(memo).toHaveTextContent('메모: 홈페이지 연혁에 2023 납품 기재');
    expect(within(memo).getByRole('link')).toHaveAttribute('target', '_blank');
    expect(screen.queryByTestId('review-memo-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-memo-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-paste-button')).not.toBeInTheDocument();
    expect(mockedNote).not.toHaveBeenCalled();
  });

  it('기록 영역 아래에 활동 타임라인이 붙고 최근 순으로 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    mockedActivity.mockResolvedValue({
      data: [
        {
          at: '2026-11-05T09:00:00+09:00',
          actor: 'system',
          kind: 'CLASSIFICATION',
          summary: '분류 변경',
        },
        { at: '2026-11-06T14:20:00+09:00', actor: 'park-lee', kind: 'NOTE', summary: '메모 남김' },
      ],
      meta: { updatedAt: '2026-11-06T14:30:00+09:00' },
    });
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const records = screen.getByTestId('detail-records');
    const rows = await within(records).findAllByTestId('timeline-item');
    expect(rows[0]).toHaveTextContent('메모 남김');
    expect(rows[1]).toHaveTextContent('분류 변경');
    expect(mockedActivity).toHaveBeenCalledWith('opp-1', 50, expect.any(AbortSignal));
  });

  it('위는 읽는 곳(한눈에·1~3번), 구분 줄 아래는 적는 곳(검토 의견·기록·비슷한 회사) 순서이고 이름이 제목으로 올라간다 (#674)', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    const setPageTitle = renderPage();
    await screen.findByTestId('opportunity-detail');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      detailReport.glance.title,
      detailSections.reasons,
      detailSections.callChecklist,
      expect.stringContaining(detailSections.scores),
      opinionArea.groupLabel,
      recordsArea.title,
      peersArea.title,
    ]);
    // 구분 줄 "여기부터 적는 곳"은 점수 구역과 검토 의견 사이에 있다.
    const divider = screen.getByTestId('detail-write-divider');
    expect(divider).toHaveTextContent(detailReport.writeDivider);
    const after = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(screen.getByTestId('detail-scores'), divider)).toBe(true);
    expect(after(divider, screen.getByTestId('detail-opinion'))).toBe(true);
    const opinion = screen.getByTestId('detail-opinion');
    expect(within(opinion).getByTestId('opinion-area')).toBeInTheDocument();
    // 맨 아래 기록 영역에 네 칸이 있다.
    const records = screen.getByTestId('detail-records');
    expect(within(records).getByTestId('records-area')).toBeInTheDocument();
    expect(setPageTitle).toHaveBeenCalledWith('A정밀 · 밸브 바디 아노다이징');
    expect(screen.getByTestId('detail-classification')).toHaveTextContent('지금 바로 연락 검토');
    // 서버 문자열 그대로 보이고 앞에 "점수 "를 붙이지 않는다. 낭독은 '조사'로 읽는다(#183).
    const score = screen.getByTestId('detail-score');
    expect(score).toHaveTextContent(/^77점 · 7\/8$/);
    expect(score).toHaveAttribute('aria-label', '점수 77점, 8개 항목 중 7개 조사');
  });

  it('주소 옆에 네이버 지도·카카오맵 링크 2개가 새 창으로 열리고 카카오는 도 이름을 줄인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        header: { ...base.header, address: '충청남도 천안시 서북구 성거읍 봉주로 303-1' },
      }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const naver = screen.getByTestId('detail-map-naver');
    const kakao = screen.getByTestId('detail-map-kakao');
    expect(naver).toHaveAttribute(
      'href',
      `https://map.naver.com/p/search/${encodeURIComponent('충청남도 천안시 서북구 성거읍 봉주로 303-1')}`,
    );
    expect(kakao).toHaveAttribute(
      'href',
      `https://map.kakao.com/link/search/${encodeURIComponent('충남 천안시 서북구 성거읍 봉주로 303-1')}`,
    );
    expect(naver).toHaveAttribute('target', '_blank');
    expect(kakao).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('주소가 없으면 지도 링크를 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(screen.queryByTestId('detail-map-links')).not.toBeInTheDocument();
  });

  it.each([
    ['참고 50점 · 3/8', /^참고 50점 · 3\/8$/, '참고 점수 50점, 8개 항목 중 3개 조사'],
    ['--', /^점수 --$/, '점수 산정 전'],
  ])('상세 머리 점수 "%s"는 글자와 낭독 문구가 각각 맞다', async (scoreDisplay, text, aria) => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, header: { ...base.header, scoreDisplay } }));
    renderPage();
    const score = await screen.findByTestId('detail-score');
    expect(score).toHaveTextContent(text);
    expect(score).toHaveAttribute('aria-label', aria);
    expect(score.getAttribute('aria-label')).not.toContain('판정');
  });

  it('상세 머리: 확정 전 점수는 흐리게 보이지만 "거래 확인 전" 꼬리표는 붙지 않는다 (#264 → #674에서 뺌)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        header: {
          ...base.header,
          scoreState: 'PENDING',
          // 서버는 거래 확인 전 점수를 분류가 필수조건 확인 대기일 때만 준다. 그 밖의 PENDING은 AI 제안이다(#498).
          classificationCode: 'FILTER_PENDING',
          relationStatus: 'UNCONFIRMED',
          scoreDisplay: '50점 · 3/8',
        },
      }),
    );
    renderPage();
    const score = await screen.findByTestId('detail-score');
    expect(score).toHaveTextContent(/^50점 · 3\/8$/);
    expect(score).toHaveAttribute('data-score-state', 'PENDING');
    // 상세는 거래 관계를 다루지 않는다(PM 결정 2026-11-13): 꼬리표를 그리지 않는다. 카드는 그대로다.
    expect(screen.queryByTestId('detail-score-pending-tag')).not.toBeInTheDocument();
    expect(screen.queryByText(scoreTags.pending)).not.toBeInTheDocument();
    expect(screen.queryByTestId('detail-score-existing-tag')).not.toBeInTheDocument();
    // 분류 꼬리표 "필수조건 확인 필요"도 카드(#659)와 같게 보이지 않는다.
    expect(screen.queryByTestId('detail-classification')).not.toBeInTheDocument();
  });

  it('상세 머리: AI 제안으로 계산된 점수(확정 전인데 분류가 확인 대기가 아님)는 흐리게 "AI 제안 · 확인 전"이 붙는다 (#498)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        header: {
          ...base.header,
          scoreState: 'PENDING',
          classificationCode: 'CONTACT_REVIEW',
          relationStatus: 'UNCONFIRMED',
          scoreDisplay: '참고 50점 · 3/8',
        },
      }),
    );
    renderPage();
    const score = await screen.findByTestId('detail-score');
    expect(score).toHaveAttribute('data-score-state', 'PENDING');
    expect(screen.getByTestId('detail-score-ai-proposal-tag')).toHaveTextContent(
      'AI 제안 · 확인 전',
    );
    expect(screen.queryByTestId('detail-score-pending-tag')).not.toBeInTheDocument();
  });

  it('상세 머리에 기업 요약(한 줄·특징·대표번호)이 보인다 (#210)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, header: { ...base.header, homepageStatus: 'NOT_FOUND' } }),
    );
    renderPage();
    expect(await screen.findByTestId('company-summary-line')).toHaveTextContent(
      '알루미늄 주물 표면처리 전문 가상 기업',
    );
    expect(screen.getByTestId('company-highlights')).toBeInTheDocument();
    expect(screen.getByTestId('company-phone-link')).toHaveTextContent('041-000-0000');
    // 홈페이지 띠는 없애고(#596) 점수 줄 옆 "조사 중단 · 이유" 꼬리표로 대신한다.
    expect(screen.queryByTestId('homepage-band')).not.toBeInTheDocument();
  });

  it.each([
    ['RUNNING', '조사 중'],
    ['NO_SCORE_EVIDENCE', '조사 중단 · 점수 근거 없음'],
    ['NOT_FOUND', '조사 중단 · 홈페이지 못 찾음'],
    ['READ_FAILED', '조사 중단 · 홈페이지 읽기 실패'],
    ['NOT_TRIED', '조사 중단 · 조사 안 됨'],
  ] as const)('조사 상태 %s면 점수 줄 옆에 "%s"가 보인다 (#596)', async (state, text) => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, header: { ...base.header, researchState: state } }),
    );
    renderPage();
    expect(await screen.findByTestId('detail-research-state')).toHaveTextContent(text);
  });

  it('조사 상태가 없으면(점수가 남) 꼬리표가 없고, 확신이 낮은 홈페이지에도 확인 표시가 없다 (#596)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, header: { ...base.header, homepageStatus: 'NEEDS_CONFIRMATION' } }),
    );
    renderPage();
    await screen.findByTestId('company-summary-line');
    expect(screen.queryByTestId('detail-research-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('homepage-band')).not.toBeInTheDocument();
    expect(screen.queryByTestId('homepage-needs-confirm')).not.toBeInTheDocument();
  });

  it('[다시 조사]는 상세 맨 위 "목록으로"와 같은 줄에 하나만 있고 [맞음]·[고치기]는 없다 (#596)', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    const back = await screen.findByTestId('back-to-list-link');
    const rerun = screen.getByTestId('homepage-rerun-button');
    // 같은 줄 오른쪽에 [관심]과 [다시 조사]가 나란히 있다(#674).
    expect(back.parentElement).toContainElement(screen.getByTestId('homepage-controls'));
    expect(back.parentElement).toContainElement(screen.getByTestId('bookmark-button'));
    expect(rerun).toHaveTextContent('다시 조사');
    expect(screen.queryByTestId('homepage-confirm-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('homepage-edit-button')).not.toBeInTheDocument();
  });

  it('접촉 횟수는 기록 영역이 아니라 머리에 보이고, 접촉을 저장하면 머리의 횟수가 바로 늘어난다 (#210)', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        records: { ...base.records, contactCount: { total: 3, call: 2, email: 0, visit: 1 } },
      }),
    );
    mockedOutcome.mockResolvedValueOnce({
      data: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-04T01:12:00Z',
        status: 'IN_PROGRESS',
      },
      meta: {},
    });
    renderPage();
    const count = await screen.findByTestId('detail-contact-count');
    expect(count).toHaveTextContent('접촉 3회 (전화 2 · 방문 1)');
    expect(within(screen.getByTestId('detail-records')).queryByText(/접촉 3회/)).toBeNull();
    await user.selectOptions(screen.getByTestId('records-kind'), '메일');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() =>
      expect(screen.getByTestId('detail-contact-count')).toHaveTextContent(
        '접촉 4회 (전화 2 · 방문 1 · 메일 1)',
      ),
    );
  });

  it('활동 이력에서 [잘못 입력]을 표시하면 상세를 다시 불러와 접촉 횟수가 서버 값으로 돌아온다 (#254)', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        records: { ...base.records, contactCount: { total: 3, call: 2, email: 0, visit: 1 } },
      }),
    );
    // 취소 뒤 서버가 취소된 접촉을 빼고 다시 센 값.
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        records: { ...base.records, contactCount: { total: 2, call: 1, email: 0, visit: 1 } },
      }),
    );
    mockedActivity.mockResolvedValue({
      data: [
        {
          at: '2026-11-06T14:20:00+09:00',
          actor: 'park-lee',
          kind: 'CONTACT_ATTEMPT',
          summary: "전화 · 부재 '담당자 외근'",
          recordId: 'outcome-7',
          recordKind: 'OUTCOME',
          cancelled: false,
        },
      ],
      meta: { updatedAt: '2026-11-06T14:30:00+09:00' },
    });
    mockedCancel.mockResolvedValueOnce({
      data: {
        recordId: 'outcome-7',
        recordKind: 'OUTCOME',
        cancelledBy: 'park-lee',
        cancelledAt: '2026-11-06T15:00:00+09:00',
      },
      meta: {},
    });
    renderPage();
    expect(await screen.findByTestId('detail-contact-count')).toHaveTextContent(
      '접촉 3회 (전화 2 · 방문 1)',
    );
    const activityCallsBefore = mockedActivity.mock.calls.length;
    await user.click(await screen.findByTestId('timeline-cancel-open'));
    await user.click(screen.getByTestId('timeline-cancel-confirm'));
    expect(mockedCancel).toHaveBeenCalledWith('opp-1', 'outcome-7', {}, 'park-lee');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('detail-contact-count')).toHaveTextContent(
        '접촉 2회 (전화 1 · 방문 1)',
      ),
    );
    expect(mockedActivity.mock.calls.length).toBeGreaterThan(activityCallsBefore);
  });

  it('서버가 접촉 횟수를 주지 않으면 머리의 접촉 횟수 줄은 보이지 않는다 (#210)', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    await screen.findByTestId('detail-glance');
    expect(screen.queryByTestId('detail-contact-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('glance-sales')).not.toBeInTheDocument();
  });

  it('상세 머리에 거래 관계 입력이 없다: 단추도 "거래 관계: …" 글도 보이지 않고 저장 요청도 가지 않는다 (#266 → #674에서 뺌)', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    await screen.findByTestId('detail-header');
    expect(screen.queryByTestId('detail-relation-text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('relation-button-NEW_CONFIRMED')).not.toBeInTheDocument();
    expect(screen.queryByText(/거래 관계:/)).not.toBeInTheDocument();
    expect(mockedRelation).not.toHaveBeenCalled();
  });

  it('거래 중으로 확인된 회사는 점수 옆 "기존 거래처" 표시가 남는다 (#674)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, header: { ...base.header, relationStatus: 'EXISTING_CONFIRMED' } }),
    );
    renderPage();
    expect(await screen.findByTestId('detail-score-existing-tag')).toHaveTextContent(
      scoreTags.existing,
    );
  });

  describe('읽는 곳과 적는 곳 (#674)', () => {
    const proposal = {
      itemId: 'II:NEW_MATERIAL',
      kind: 'ITEM_INPUT_PROPOSAL' as const,
      source: 'AI' as const,
      text: 'AI 제안 · 소재와 보유 공정 일치 — 일부 가능(강한 추정) · 근거: 알루미늄 주물',
      checked: false,
      stepOptions: ['정확히 일치', '일부 가능'],
    };
    const gap = (code: string, text: string) => ({
      itemId: `GAP:ITEM:${code}`,
      kind: 'DATA_INSUFFICIENT' as const,
      source: 'RULE' as const,
      text,
      checked: false,
    });

    it('점수는 기본으로 접혀 있고 제목 줄에 요약이 보이며, AI 점수 입력 제안의 [확정]·[고치기]는 펼친 안쪽에만 있다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply({ ...base, reviewItems: [proposal] }));
      mockedCheck.mockResolvedValueOnce({
        data: {
          itemId: 'II:NEW_MATERIAL',
          checked: true,
          checkedBy: 'park-lee',
          checkedAt: '2026-11-13T10:00:00+09:00',
        },
        meta: { reevaluated: true },
      });
      renderPage();
      await screen.findByTestId('opportunity-detail');
      const scores = screen.getByTestId('detail-scores');
      const toggle = within(scores).getByTestId('detail-scores-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // 가상 사례: 8항목 가운데 수주(신호 없음)·채용(자료 미확보)을 뺀 6항목에 근거가 있다.
      expect(within(scores).getByTestId('detail-scores-summary')).toHaveTextContent(
        '77점 · 8항목 중 6항목 근거 있음',
      );
      // 접혀 있을 때는 제안 단추가 화면 어디에도 없다(통화에서 확인할 것 구역에도 없다).
      expect(screen.queryByTestId('review-proposal-confirm')).not.toBeInTheDocument();
      expect(screen.getByTestId('detail-review')).not.toHaveTextContent('AI 제안');

      await user.click(toggle);
      const proposals = within(scores).getByTestId('score-proposals');
      expect(within(proposals).getByTestId('review-text')).toHaveTextContent(proposal.text);
      expect(within(proposals).getByTestId('review-proposal-fix')).toBeInTheDocument();
      expect(within(scores).getByTestId('score-items-table')).toBeInTheDocument();
      await user.click(within(proposals).getByTestId('review-proposal-confirm'));
      expect(mockedCheck).toHaveBeenCalledWith(
        'opp-1',
        'II:NEW_MATERIAL',
        { checked: true, evalId: base.evalId },
        'park-lee',
      );
      // 확정하면 점수가 바뀌므로 상세를 다시 불러오고, 점수 구역은 펼친 채로 남는다.
      await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
      expect(await screen.findByTestId('detail-scores-toggle')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('점수가 없으면 점수 구역 제목 줄에 "점수 전"이 보인다', async () => {
      mockedGet.mockResolvedValueOnce(reply({ ...base, scores: null, reviewItems: [] }));
      renderPage();
      await screen.findByTestId('opportunity-detail');
      expect(screen.getByTestId('detail-scores-summary')).toHaveTextContent(/^점수 전$/);
      expect(screen.queryByTestId('detail-scores-toggle')).not.toBeInTheDocument();
    });

    it('공고·채용 "근거 없음" 줄은 접힌 묶음을 펼쳐도 보이지 않고, 나머지는 읽기 전용으로 남는다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValueOnce(
        reply({
          ...base,
          reviewItems: [
            gap('NEW_RECORD', '유사 산업·부품 납품실적 근거 없음'),
            gap('SIG_BID', '입찰·협력사 모집·구매 공고 근거 없음'),
            gap('SIG_HIRE', '관련 직무 채용(구매·품질·생산기술·표면처리) 근거 없음'),
          ],
        }),
      );
      renderPage();
      await screen.findByTestId('opportunity-detail');
      const review = screen.getByTestId('detail-review');
      await user.click(within(review).getByTestId('review-fold-toggle-gap'));
      const rows = within(review).getAllByTestId('review-item');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('유사 산업·부품 납품실적 근거 없음');
      expect(review).not.toHaveTextContent('공고 근거 없음');
      expect(review).not.toHaveTextContent('채용');
    });

    // #691: 머리에 [기록 남기기]가 더해졌다. 저장하지 않고 기록 칸으로 내려가기만 하는 이동 단추다.
    it('구분 줄 위(읽는 곳)의 단추는 [목록으로]·[관심]·[다시 조사]·[기록 남기기](이동)와 접힌 구역을 여는 단추뿐이고 입력칸이 없다', async () => {
      mockedGet.mockResolvedValueOnce(
        reply({
          ...fixtureData,
          reviewItems: [...(fixtureData.reviewItems ?? []), proposal],
          records: {
            ...fixtureData.records,
            contactCount: { total: 1, call: 1, email: 0, visit: 0 },
          },
        }),
      );
      renderPage();
      await screen.findByTestId('opportunity-detail');
      const divider = screen.getByTestId('detail-write-divider');
      const above = (el: HTMLElement) =>
        Boolean(el.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING);
      const buttons = [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]
        .filter(above)
        .filter((el) => el.tagName !== 'A' || el.getAttribute('target') !== '_blank')
        .map((el) => el.getAttribute('data-testid'));
      expect(buttons.sort()).toEqual(
        [
          'back-to-list-link',
          'bookmark-button',
          // 대표번호는 누르면 전화가 걸리는 링크다(단추가 아님).
          'company-phone-link',
          'detail-go-record-button',
          'detail-scores-toggle',
          'homepage-rerun-button',
          'review-fold-toggle-gap',
        ].sort(),
      );
      for (const role of ['textbox', 'checkbox', 'combobox', 'radio']) {
        expect(screen.queryAllByRole(role).filter(above)).toHaveLength(0);
      }
      // 적는 곳은 구분 줄 아래에 그대로 있다: 검토 의견 → 기록 남기기 → 활동 이력 → 비슷한 회사 참고.
      const below = ['detail-opinion', 'detail-records', 'detail-peers'].map((id) =>
        screen.getByTestId(id),
      );
      for (const el of below) expect(above(el)).toBe(false);
      expect(within(below[1]).getByTestId('records-area')).toBeInTheDocument();
      expect(
        below[0].compareDocumentPosition(below[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        below[1].compareDocumentPosition(below[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('맨 위에 단계 진행 막대가 있고, 접촉 기록이 없으면 모두 빈 점과 "아직 접촉 기록이 없습니다"가 보인다', async () => {
      mockedGet.mockResolvedValueOnce(reply(base));
      renderPage();
      const header = await screen.findByTestId('detail-header');
      const steps = within(header).getAllByTestId('sales-progress-step');
      expect(steps).toHaveLength(5);
      expect(steps.every((el) => el.getAttribute('data-state') === 'todo')).toBe(true);
      expect(within(header).getByTestId('sales-progress-empty')).toHaveTextContent(
        '아직 접촉 기록이 없습니다',
      );
    });

    it('진행 중인 회사는 지금 단계와 다음 일정이 막대에, 접촉 횟수와 마지막 접촉이 "한눈에"에 보인다', async () => {
      mockedGet.mockResolvedValueOnce(
        reply({
          ...base,
          records: {
            ...base.records,
            contactCount: { total: 3, call: 2, email: 0, visit: 1 },
            lastContactAt: '2026-11-12',
            salesStep: {
              code: 'DEMAND_CONFIRMED',
              since: '2026-11-12',
              overridden: false,
              known: [],
              openQuestions: [],
            },
            outcome: {
              version: 3,
              updatedBy: 'park-lee',
              updatedAt: '2026-11-12T09:00:00+09:00',
              status: 'IN_PROGRESS',
              nextScheduleAt: '2026-11-20',
              nextScheduleNote: '견적 보내기',
            },
          },
        }),
      );
      renderPage();
      const header = await screen.findByTestId('detail-header');
      expect(within(header).getByTestId('sales-progress-now')).toHaveTextContent(
        '지금 (11/12부터)',
      );
      expect(within(header).getByTestId('sales-progress-next')).toHaveTextContent(
        '다음 일정: 11/20 견적 보내기',
      );
      expect(screen.getByTestId('detail-contact-count')).toHaveTextContent(
        '접촉 3회 (전화 2 · 방문 1) · 마지막 접촉 11/12',
      );
    });
  });

  describe('머리의 [관심] 단추 (#357)', () => {
    const bookmarked: BookmarkRecord = {
      version: 1,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-06T01:00:00Z',
      active: true,
    };
    const withBookmark = (value: BookmarkRecord | null): OpportunityDetail => ({
      ...base,
      records: { ...base.records, bookmark: value },
    });

    it('상세 응답의 관심 값대로 머리에 "관심"(꺼짐) 또는 "관심 기업"(켜짐)이 보인다', async () => {
      mockedGet.mockResolvedValueOnce(reply(withBookmark(bookmarked)));
      renderPage();
      const header = await screen.findByTestId('detail-header');
      const button = within(header).getByTestId('bookmark-button');
      expect(button).toHaveTextContent(/^관심 기업$/);
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('[관심]을 누르면 켜기 요청을 보내고 머리 단추가 바뀌며, 상세를 통째로 다시 부르지 않고 활동 이력만 새로 읽는다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValueOnce(reply(withBookmark(null)));
      mockedBookmark.mockResolvedValueOnce({ data: bookmarked, meta: {} });
      renderPage();
      const button = await screen.findByTestId('bookmark-button');
      expect(button).toHaveTextContent(/^관심$/);
      expect(button).toHaveAttribute('aria-pressed', 'false');
      await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(1));
      await user.click(button);
      expect(mockedBookmark).toHaveBeenCalledWith(
        'opp-1',
        { active: true, expectedVersion: null },
        'park-lee',
      );
      await waitFor(() =>
        expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true'),
      );
      expect(mockedGet).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(2));
    });

    it('영업 기록을 저장하면 관심 값만 서버에서 다시 읽어 머리 단추를 "관심 기업"으로 맞춘다 (자동 관심)', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValueOnce(reply(withBookmark(null)));
      // 저장 뒤 다시 읽을 때 서버는 관심을 켠 값을 준다.
      mockedGet.mockResolvedValueOnce(reply(withBookmark(bookmarked)));
      mockedOutcome.mockResolvedValueOnce({
        data: {
          version: 1,
          updatedBy: 'park-lee',
          updatedAt: '2026-11-06T01:12:00Z',
          status: 'ON_HOLD',
        },
        meta: {},
      });
      renderPage();
      expect(await screen.findByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
      // 영업 단계 칸은 기본으로 접혀 있다(#674). [단계 고치기]를 눌러 펼친다.
      await user.click(screen.getByTestId('records-stage-toggle'));
      await user.selectOptions(screen.getByTestId('records-stage-select'), '보류');
      await user.click(screen.getByTestId('records-stage-save-button'));
      await waitFor(() =>
        expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true'),
      );
      expect(mockedGet).toHaveBeenCalledTimes(2);
      // 화면을 통째로 다시 그리지 않아 방금 저장한 안내와 현재 단계가 그대로 남는다.
      expect(screen.getByTestId('records-stage-saved')).toBeInTheDocument();
      expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 보류');
      // 관심은 서버가 켠다. 화면이 따로 켜기 요청을 보내지 않는다.
      expect(mockedBookmark).not.toHaveBeenCalled();
    });

    it('저장 뒤 관심 값을 다시 읽지 못해도 상세 화면은 그대로이고 단추는 지금 값을 유지한다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValueOnce(reply(withBookmark(null)));
      mockedGet.mockRejectedValueOnce(new Error('boom'));
      mockedOutcome.mockResolvedValueOnce({
        data: {
          version: 1,
          updatedBy: 'park-lee',
          updatedAt: '2026-11-06T01:12:00Z',
          status: 'ON_HOLD',
        },
        meta: {},
      });
      renderPage();
      await screen.findByTestId('bookmark-button');
      // 영업 단계 칸은 기본으로 접혀 있다(#674). [단계 고치기]를 눌러 펼친다.
      await user.click(screen.getByTestId('records-stage-toggle'));
      await user.selectOptions(screen.getByTestId('records-stage-select'), '보류');
      await user.click(screen.getByTestId('records-stage-save-button'));
      await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('opportunity-detail')).toBeInTheDocument();
      expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByTestId('bookmark-error')).not.toBeInTheDocument();
      expect(screen.queryByTestId('five-states-error')).not.toBeInTheDocument();
    });
  });

  it('상세 머리: 거래 중으로 확인된 회사는 점수가 확정이어도 "기존 거래처" 꼬리표가 붙는다 (#264)', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    await screen.findByTestId('detail-score');
    expect(screen.getByTestId('detail-score-existing-tag')).toHaveTextContent(scoreTags.existing);
    expect(screen.queryByTestId('detail-score-pending-tag')).not.toBeInTheDocument();
  });

  it('확인 질문은 3개까지 보이고 나머지는 펼치기로 보이며 상태가 글자로 보인다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, reasons: { ...base.reasons, questions: [1, 2, 3, 4].map(question) } }),
    );
    renderPage();
    await screen.findByTestId('detail-questions');
    expect(
      screen.getByRole('heading', { name: detailSections.questionsHeading }),
    ).toHaveTextContent('거산 역량 확인사항');
    expect(screen.getAllByTestId('detail-question')).toHaveLength(3);
    expect(screen.getAllByTestId('detail-question')[0]).toHaveTextContent('대기');
    const toggle = screen.getByTestId('detail-questions-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent(detailSections.expandQuestions(1));

    await user.click(toggle);
    expect(screen.getAllByTestId('detail-question')).toHaveLength(4);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent(detailSections.collapseQuestions);
  });

  it('확인 질문 제목 아래에 거산 소개서 값 확인이라는 설명 한 줄이 보인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, reasons: { ...base.reasons, questions: [1].map(question) } }),
    );
    renderPage();
    const hint = await screen.findByTestId('detail-questions-hint');
    expect(hint).toHaveTextContent('점수 계산에 쓴 거산 소개서 값입니다.');
    expect(hint).toHaveTextContent("상대 회사에 물을 것은 위의 '후속 조치'에 있고");
    expect(hint).toHaveTextContent('답 기록 기능은 11월에 들어갑니다.');
  });

  // PM 결정 2026-11-13(#659): 재접촉 관리를 하지 않으므로 "고객이 요구하는 것과 거산의 준비 상태" 구역을 그리지 않는다.
  // 요구 표와 "승인 가능 여부" 줄의 모양 검사는 부품 시험(components/detail/__tests__/RequirementsTable.test.tsx)으로 옮겼다.
  it('공정 적합성 검토 구역은 공정 연결이 있어도 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(base.processLinks.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('detail-process-links')).not.toBeInTheDocument();
    expect(screen.queryByTestId('process-link')).not.toBeInTheDocument();
    expect(
      screen.queryByText(detailSections.processLinks, { exact: false }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['요구가 있을 때', base],
    ['요구가 없을 때', { ...base, requirements: [] }],
  ])('요구와 준비 상태 구역은 %s도 보이지 않는다', async (_name, data) => {
    mockedGet.mockResolvedValueOnce(reply(data));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(screen.queryByTestId('detail-requirements')).not.toBeInTheDocument();
    expect(screen.queryByTestId('requirements-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('requirements-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('requirement-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-eligibility-line')).not.toBeInTheDocument();
    expect(
      screen.queryByText(detailSections.requirements, { exact: false }),
    ).not.toBeInTheDocument();
  });

  it('근거는 사실(확인)과 추정을 글자로 구분하고 LLM 제안 표시를 붙인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        evidence: [
          base.evidence[0],
          {
            ...base.evidence[1],
            evidenceId: 'ev-x',
            certainty: 'STRONG',
            isLlmProposed: true,
            quote: '알루미늄 주물 밸브',
          },
        ],
      }),
    );
    renderPage();
    const items = await screen.findAllByTestId('evidence-item');
    expect(items[0]).toHaveTextContent('사실(확인)');
    expect(items[0]).toHaveTextContent('출처 등급 A');
    expect(items[0]).not.toHaveTextContent('LLM 제안');
    expect(items[1]).toHaveTextContent('추정(강한)');
    expect(items[1]).not.toHaveTextContent('사실(확인)');
    expect(within(items[1]).getByTestId('evidence-llm-tag')).toBeInTheDocument();
  });

  it('근거 출처에 주소가 있으면 그 주소만 새 창 링크가 되고, 주소가 없는 출처는 글자만 보인다 (#174)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        evidence: [
          {
            ...base.evidence[0],
            evidenceId: 'ev-url',
            sourceRef: '코파스 홈페이지 제품 재질 선택 http://kofas.com/productK/',
          },
          { ...base.evidence[1], evidenceId: 'ev-text', sourceRef: '카탈로그 3쪽 (인쇄면)' },
        ],
      }),
    );
    renderPage();
    const items = await screen.findAllByTestId('evidence-item');

    const link = within(items[0]).getByRole('link', { name: 'http://kofas.com/productK/' });
    expect(link).toHaveAttribute('href', 'http://kofas.com/productK/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(within(items[0]).getByTestId('evidence-source')).toHaveTextContent(
      '코파스 홈페이지 제품 재질 선택 http://kofas.com/productK/',
    );

    expect(within(items[1]).queryByRole('link')).not.toBeInTheDocument();
    expect(within(items[1]).getByTestId('evidence-source')).toHaveTextContent(
      '카탈로그 3쪽 (인쇄면)',
    );
  });

  it('항목별 요약이 있으면 추천 이유가 요약 한 줄씩으로 보이고 추정 항목에만 "(추정)"이 붙는다', async () => {
    const items = base.scores!.items.slice(0, 5).map((item, index) => ({
      ...item,
      itemCode: ['NEW_PRODUCT', 'NEW_MATERIAL', 'NEW_PERF', 'SIG_EXPAND', 'NOT_IN_TABLE'][index],
      label: index === 4 ? '표에 없는 긴 항목 이름' : '점수 표의 긴 이름',
      state: ['CONFIRMED', 'CONFIRMED', 'STRONG', 'NO_SIGNAL', 'CONFIRMED'][index],
      summary: index === 3 ? null : `요약 문장 ${index} (출처 ${index})`,
    }));
    mockedGet.mockResolvedValueOnce(reply({ ...base, scores: { ...base.scores!, items } }));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const lines = screen.getAllByTestId('detail-reason-text');
    expect(lines.map((line) => line.textContent)).toEqual([
      '제품: 요약 문장 0 (출처 0)',
      '소재: 요약 문장 1 (출처 1)',
      '처리 목적(추정): 요약 문장 2 (출처 2)',
      '표에 없는 긴 항목 이름: 요약 문장 4 (출처 4)',
    ]);
    // 항목별 요약이 있으면 서버의 한 줄 추천 이유는 따로 보이지 않는다.
    expect(screen.queryByTestId('detail-reason')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-reasons')).not.toHaveTextContent(base.reasons.reason);
    // 후속 조치는 "2. 통화에서 확인할 것" 자리에 있다(검토사항이 없는 옛 응답은 예전 부품).
    expect(
      within(screen.getByTestId('detail-review')).getByTestId('detail-next-action'),
    ).toHaveTextContent(base.reasons.nextAction);
  });

  it('요약 줄 끝 괄호 글자는 그 항목 근거의 첫 주소로 가는 새 창 링크가 되고, 주소가 없으면 글자만 보인다 (#175)', async () => {
    const [first, second, third] = base.scores!.items;
    const evidence = [
      { ...base.evidence[0], evidenceId: 'ev-a', sourceRef: '카탈로그 인쇄면' },
      {
        ...base.evidence[1],
        evidenceId: 'ev-b',
        sourceRef: '홈페이지 http://kofas.com/productK/ 와 http://kofas.com/other/',
      },
    ];
    const items = [
      {
        ...first,
        itemCode: 'NEW_PRODUCT',
        state: 'CONFIRMED',
        summary: '볼트를 만든다고 밝혔습니다. (홈페이지 제품 목록)',
        evidenceIds: ['ev-a', 'ev-b'],
      },
      {
        ...second,
        itemCode: 'NEW_MATERIAL',
        state: 'CONFIRMED',
        summary: '재질을 고를 수 있습니다. (카탈로그)',
        evidenceIds: ['ev-a'],
      },
      {
        ...third,
        itemCode: 'NEW_PERF',
        state: 'CONFIRMED',
        summary: '괄호가 없는 요약입니다',
        evidenceIds: ['ev-b'],
      },
    ];
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, evidence, scores: { ...base.scores!, items } }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const rows = screen.getAllByTestId('detail-reason-line');
    const lines = screen.getAllByTestId('detail-reason-text');
    // 문장 바로 아래에 그 문장에 쓴 근거의 인용과 출처가 붙는다(#674): 첫 줄은 근거 2건, 출처 주소는 새 창 링크.
    const quotes = within(rows[0]).getAllByTestId('evidence-item');
    expect(quotes).toHaveLength(2);
    expect(
      within(quotes[1]).getByRole('link', { name: 'http://kofas.com/productK/' }),
    ).toHaveAttribute('target', '_blank');
    expect(within(rows[1]).getAllByTestId('evidence-item')).toHaveLength(1);

    // 글은 그대로이고 괄호 안 글자만 링크다. 주소 있는 첫 근거(ev-b)의 첫 주소를 쓴다.
    expect(lines[0]).toHaveTextContent('제품: 볼트를 만든다고 밝혔습니다. (홈페이지 제품 목록)');
    const link = within(lines[0]).getByRole('link', { name: '홈페이지 제품 목록' });
    expect(link).toHaveAttribute('href', 'http://kofas.com/productK/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));

    // 주소 있는 근거가 없거나 괄호가 없으면 지금처럼 글자만.
    expect(within(lines[1]).queryByRole('link')).not.toBeInTheDocument();
    expect(lines[1]).toHaveTextContent('소재: 재질을 고를 수 있습니다. (카탈로그)');
    expect(within(lines[2]).queryByRole('link')).not.toBeInTheDocument();
  });

  it('회사 홈페이지 주소가 있으면 제목 아래에 새 창 링크가 보이고, 없거나 http가 아니면 보이지 않는다 (#175)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, header: { ...base.header, homepageUrl: 'http://kofas.com/' } }),
    );
    renderPage();
    const link = await screen.findByRole('link', { name: /기업 소개 페이지/ });
    expect(link).toHaveTextContent('기업 소개 페이지 ↗ http://kofas.com/');
    expect(link).toHaveAttribute('href', 'http://kofas.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it.each([[null], ['javascript:alert(1)']])(
    '홈페이지 주소가 %s 이면 회사 페이지 링크를 보이지 않는다 (#175)',
    async (homepageUrl) => {
      mockedGet.mockResolvedValueOnce(reply({ ...base, header: { ...base.header, homepageUrl } }));
      renderPage();
      await screen.findByTestId('opportunity-detail');
      expect(screen.queryByTestId('detail-homepage')).not.toBeInTheDocument();
    },
  );

  it('요약이 하나도 없으면 지금 화면 그대로 엔진이 만든 추천 이유 문장을 보인다', async () => {
    const items = base.scores!.items.map((item) => ({ ...item, summary: null }));
    mockedGet.mockResolvedValueOnce(reply({ ...base, scores: { ...base.scores!, items } }));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(screen.queryByTestId('detail-reason-lines')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-reason')).toHaveTextContent(
      `추천 근거: ${base.reasons.reason}`,
    );
  });

  it('점수 자세히 보기는 기본으로 접혀 있고 펼치면 E/P/S/R과 항목표·규칙 정보가 보인다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    const toggle = await screen.findByTestId('detail-scores-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('펼치기');
    expect(screen.queryByTestId('score-e')).not.toBeInTheDocument();
    // 전문 용어는 접힌 동안 화면 어디에도 없다(BR10.9).
    expect(screen.getByTestId('opportunity-detail')).not.toHaveTextContent(/현재 평가점수 E/);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('접기');
    expect(screen.getByTestId('score-e')).toHaveTextContent('77');
    expect(screen.getByTestId('score-p')).toHaveTextContent('95');
    expect(screen.getByTestId('score-s')).toHaveTextContent('81.1');
    // 머리의 "참고"(거산 확인 전)와 헷갈리지 않게 S 이름표는 "확인 비율"로 쓴다(#200).
    expect(screen.getByTestId('score-s')).toHaveTextContent('확인 비율 S (E÷P×100)');
    expect(screen.getByTestId('score-s')).not.toHaveTextContent('참고');
    expect(screen.getByTestId('score-r')).toHaveTextContent('82');
    expect(screen.getAllByTestId('score-item-row')).toHaveLength(8);
    expect(screen.getByTestId('score-footer')).toHaveTextContent('v0.17-a');
    expect(screen.getByTestId('score-footer')).toHaveTextContent('가상 검수');
    expect(screen.getByTestId('score-footer')).toHaveTextContent('평가 10/20 09:00');
  });

  it('점수 표의 숫자·상태 칸은 "미확보"처럼 짧은 글이 세로로 꺾이지 않게 한 줄로 둔다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    await user.click(await screen.findByTestId('detail-scores-toggle'));
    const rows = screen.getAllByTestId('score-item-row');
    for (const row of rows) {
      // 첫 칸(항목 설명)은 길어서 줄바꿈을 허용하고, 나머지 여섯 칸은 한 줄로 둔다.
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(6);
      for (const cell of cells) expect(cell).toHaveStyle({ whiteSpace: 'nowrap' });
    }
  });

  it('없는 기회(404)이면 "이 기회를 찾을 수 없습니다"와 [목록으로]를 보이고 누르면 목록으로 간다', async () => {
    const user = userEvent.setup();
    mockedGet.mockRejectedValueOnce(
      new ApiError(404, { message: '없음', nextAction: '목록으로 돌아가세요', ref: 'r-404' }),
    );
    renderPage();
    expect(await screen.findByText(states.detailNotFound)).toBeInTheDocument();
    await user.click(screen.getByTestId('not-found-back-button'));
    expect(await screen.findByText('목록 화면')).toBeInTheDocument();
    expect(frame.backToList).toBe('목록으로');
  });

  it('불러오지 못하면 쉬운 말 오류와 [다시 시도]를 보이고 누르면 다시 불러온다', async () => {
    const user = userEvent.setup();
    mockedGet.mockRejectedValueOnce(
      new ApiError(500, {
        message: '상세를 가져오는 중 문제가 생겼습니다.',
        nextAction: '잠시 뒤 다시 시도해 주세요.',
        ref: 'r-1',
        kind: 'INTERNAL_ERROR',
      }),
    );
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(states.detailError);
    expect(alert).not.toHaveTextContent('INTERNAL_ERROR');
    await user.click(screen.getByRole('button', { name: states.retry }));
    expect(await screen.findByTestId('opportunity-detail')).toBeInTheDocument();
  });
});
