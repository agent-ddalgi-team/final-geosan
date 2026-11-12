// 근거 상세(S2): 영역 순서 / 질문 3개+펼치기 / 요구 0개 문구 / 확인·추정 글자 / 점수 접힘 / 404 (+ 요구 표, 오류).
// 서버 호출(getOpportunityDetail)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import {
  ApiError,
  getActivity,
  getOpportunityDetail,
  postNote,
  postOutcome,
  postQuestionReply,
  postRecordCancel,
  postRelation,
  putBookmark,
} from '../../api/client';
import type { BookmarkRecord, Envelope, OpportunityDetail, Question } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import {
  detailSections,
  frame,
  opinionArea,
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
  postQuestionReply: vi.fn(),
  postNote: vi.fn(),
  postRecordCancel: vi.fn(),
  postRelation: vi.fn(),
  postOutcome: vi.fn(),
  putBookmark: vi.fn(),
}));

const mockedNote = vi.mocked(postNote);
const mockedCancel = vi.mocked(postRecordCancel);
const mockedBookmark = vi.mocked(putBookmark);
const mockedOutcome = vi.mocked(postOutcome);
const mockedRelation = vi.mocked(postRelation);
const mockedGet = vi.mocked(getOpportunityDetail);
const mockedReply = vi.mocked(postQuestionReply);
const mockedActivity = vi.mocked(getActivity);
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
    mockedReply.mockReset();
    mockedRelation.mockReset();
    mockedOutcome.mockReset();
    mockedBookmark.mockReset();
    mockedNote.mockReset();
    mockedCancel.mockReset();
    mockedActivity.mockResolvedValue({
      data: [],
      meta: { updatedAt: '2026-10-20T09:00:00+09:00' },
    });
  });

  it('서버가 검토사항을 주면 추천 이유 바로 아래에 영역이 생기고 확인 질문은 1번 영역에서 빠진다', async () => {
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
    expect(headings.slice(0, 3)).toEqual([
      detailSections.reasons,
      reviewArea.title,
      detailSections.requirements,
    ]);
    expect(screen.queryByTestId('detail-questions')).not.toBeInTheDocument();
    const review = screen.getByTestId('detail-review');
    expect(within(review).getByTestId('review-progress')).toHaveTextContent('확인 1 / 2');
    expect(within(review).getAllByTestId('review-item')).toHaveLength(2);
  });

  it('서버가 검토사항을 아직 안 주면 영역을 만들지 않고 확인 질문은 예전처럼 1번 영역에 남는다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply({ ...base, reasons: { ...base.reasons, questions: [1].map(question) } }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(screen.queryByTestId('detail-review')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-questions')).toBeInTheDocument();
  });

  it('가짜 응답 파일의 검토사항에는 질문 줄 답 1건이 있고 "답: …"과 [답 고치기]가 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const rows = within(screen.getByTestId('detail-review')).getAllByTestId('review-item');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByTestId('review-reply')).toHaveTextContent(
      '답: 2024년에 KS 인증 받았다고 함',
    );
    expect(within(rows[0]).getByTestId('review-reply-button')).toHaveTextContent(
      reviewArea.replyEdit,
    );
    expect(within(rows[1]).getByTestId('review-reply-button')).toHaveTextContent(
      reviewArea.replyAdd,
    );
    // 자료 줄에는 [답 적기]가 없다.
    expect(within(rows[2]).queryByTestId('review-reply-button')).not.toBeInTheDocument();
  });

  it('검토사항에서 답을 저장하면 활동 이력을 새로 불러온다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    mockedReply.mockResolvedValueOnce({
      data: {
        questionId: 'q-fixture-unanswered',
        replyText: '직접 생산한다고 함',
        repliedAt: '2026-11-06',
        repliedBy: 'park-lee',
      },
      meta: {},
    });
    renderPage();
    await screen.findByTestId('opportunity-detail');
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(1));
    const rows = within(screen.getByTestId('detail-review')).getAllByTestId('review-item');
    await user.click(within(rows[1]).getByTestId('review-reply-button'));
    fireEvent.change(screen.getByTestId('review-reply-input'), {
      target: { value: '직접 생산한다고 함' },
    });
    await user.click(screen.getByTestId('review-reply-save'));
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(2));
  });

  it('자료 줄에 메모를 저장하면 활동 이력만 새로 불러오고 상세는 다시 읽지 않는다 (#260)', async () => {
    const user = userEvent.setup();
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
          },
        ],
      }),
    );
    mockedNote.mockResolvedValueOnce({
      data: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-20T10:00:00+09:00',
        noteId: 'note-1',
      },
      meta: {},
    });
    renderPage();
    await screen.findByTestId('opportunity-detail');
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('review-memo-button'));
    fireEvent.change(screen.getByTestId('review-memo-input'), {
      target: { value: '홈페이지 연혁에 2023 납품 기재' },
    });
    await user.click(screen.getByTestId('review-memo-save'));
    expect(await screen.findByTestId('review-memo')).toHaveTextContent(
      '메모: 홈페이지 연혁에 2023 납품 기재',
    );
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(2));
    expect(mockedGet).toHaveBeenCalledTimes(1);
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

  it('영역이 1~5번 순서로 나오고 맨 아래에 의견 영역이 있으며 이름이 제목으로 올라간다', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    const setPageTitle = renderPage();
    await screen.findByTestId('opportunity-detail');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      detailSections.reasons,
      detailSections.requirements,
      detailSections.processLinks,
      detailSections.evidence,
      expect.stringContaining(detailSections.scores),
      opinionArea.groupLabel,
      recordsArea.title,
    ]);
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

  it('상세 머리: 거래 확인 전 점수는 흐리게 "거래 확인 전" 꼬리표가 붙고, 확정이면 꼬리표가 없다 (#264)', async () => {
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
    expect(screen.getByTestId('detail-score-pending-tag')).toHaveTextContent(scoreTags.pending);
    expect(screen.queryByTestId('detail-score-existing-tag')).not.toBeInTheDocument();
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
    expect(back.parentElement).toBe(screen.getByTestId('homepage-controls').parentElement);
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
    await screen.findByTestId('detail-relation-text');
    expect(screen.queryByTestId('detail-contact-count')).not.toBeInTheDocument();
  });

  it('거래 관계를 바꾸면 서버에 저장한 뒤 상세와 활동 이력을 새로 불러온다 (#266)', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValueOnce(reply(base));
    mockedGet.mockResolvedValueOnce(
      reply({
        ...base,
        evalId: 'eval-reevaluated',
        reevaluated: true,
        header: { ...base.header, relationStatus: 'NEW_CONFIRMED', relationNote: null },
      }),
    );
    mockedRelation.mockResolvedValueOnce({
      data: {
        relationStatus: 'NEW_CONFIRMED',
        relationConfirmedAt: '2026-11-05',
        relationConfirmedBy: 'park-lee',
        evalId: 'eval-reevaluated',
      },
      meta: { reevaluated: true },
    });
    renderPage();
    expect(await screen.findByTestId('detail-relation-text')).toHaveTextContent(
      '거래 관계: 거래 중',
    );
    const activityCallsBefore = mockedActivity.mock.calls.length;
    await user.click(screen.getByTestId('relation-button-NEW_CONFIRMED'));
    expect(mockedRelation).toHaveBeenCalledWith(
      'opp-1',
      { relationStatus: 'NEW_CONFIRMED', evalId: base.evalId },
      'park-lee',
    );
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('detail-relation-text')).toHaveTextContent('거래 관계: 거래 없음'),
    );
    expect(mockedActivity.mock.calls.length).toBeGreaterThan(activityCallsBefore);
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

  it('확인된 요구가 없으면 표 대신 안내 문구를 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...base, requirements: [] }));
    renderPage();
    expect(await screen.findByTestId('requirements-empty')).toHaveTextContent(
      states.noRequirements,
    );
    expect(screen.queryByTestId('requirements-table')).not.toBeInTheDocument();
  });

  it('요구 표는 머리글 행이 있는 진짜 표이고 판정이 색 아닌 글자로도 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply(base));
    renderPage();
    const table = await screen.findByTestId('requirements-table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    for (const th of within(table).getAllByRole('columnheader')) {
      expect(th).toHaveAttribute('scope', 'col');
    }
    const rows = screen.getAllByTestId('requirement-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('ISO 9001');
    expect(rows[0]).toHaveTextContent('통과 (응모 가능)');
    expect(rows[1]).toHaveTextContent('품질팀 샘플 승인');
    expect(rows[1]).toHaveTextContent('나중 단계');
    expect(rows[2]).toHaveTextContent('Nadcap');
    expect(rows[2]).toHaveTextContent('질문 필요 (승인은 막지 않음)');
    expect(screen.getByTestId('approval-eligibility-line')).toHaveTextContent(
      `${detailSections.approvalEligible}`,
    );
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
    const lines = screen.getAllByTestId('detail-reason-line');
    expect(lines.map((line) => line.textContent)).toEqual([
      '제품: 요약 문장 0 (출처 0)',
      '소재: 요약 문장 1 (출처 1)',
      '처리 목적(추정): 요약 문장 2 (출처 2)',
      '표에 없는 긴 항목 이름: 요약 문장 4 (출처 4)',
    ]);
    expect(screen.getByTestId('detail-reason')).not.toHaveTextContent(base.reasons.reason);
    expect(screen.getByTestId('detail-next-action')).toHaveTextContent(base.reasons.nextAction);
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
    const lines = screen.getAllByTestId('detail-reason-line');

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
