// 회사별 보고서(#565): 한눈에·점수·근거·질문과 답 / 값 없는 칸 "확인 필요" / AI 제안 표시 / 가상 표시 /
// 영업 메모·대표번호는 안 보임 / 불러오기 실패 안내.
// 서버 호출(getOpportunityDetail·getSalesQuestions)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyReportPage from '../CompanyReportPage';
import { ApiError, getOpportunityDetail, getSalesQuestions } from '../../api/client';
import type { Envelope, OpportunityDetail, SalesQuestions } from '../../api/types';
import { reportModelOf } from '../../components/report/reportModel';
import { banner, companyReport } from '../../labels/ko';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getSalesQuestions: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedQuestions = vi.mocked(getSalesQuestions);
const fixture = detailFixture.data as unknown as OpportunityDetail;

const PHONE = '041-000-0000';
const SALES_MEMO = '영업 메모: 김 과장 010-1234-5678 다음 주 통화';
const ITEM_MEMO = '자료 줄 메모: 카탈로그 받아 둠';
const REPLY_TEXT = '2024년에 KS 인증 받았다고 함';
const SCHEDULE_NOTE = '견적 보내기 — 구매팀 이 대리';

const questionFile: SalesQuestions = {
  version: 1,
  steps: [],
  questions: [
    {
      questionId: 'switch',
      text: '외주처를 바꿀 생각이 있나요?',
      step: 'DEMAND_CONFIRMED',
      answers: [{ answerId: 'YES', label: '있음' }],
    },
  ],
};

/** 메모·대표번호·답 글·일정 글이 모두 실려 온 상세 응답. */
function detailWithSecrets(): OpportunityDetail {
  return {
    ...fixture,
    header: {
      ...fixture.header,
      address: '충청남도 당진시 가상로 1',
      homepageUrl: 'https://example.invalid/apjeong',
      mainPhone: PHONE,
    },
    records: {
      ...fixture.records,
      opinion: {
        opinion: 'WORTH_REVIEW',
        reason: SALES_MEMO,
        memo: SALES_MEMO,
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-10T09:00:00+09:00',
      },
      outcome: {
        status: 'IN_PROGRESS',
        nextScheduleAt: '2026-11-20',
        nextScheduleNote: SCHEDULE_NOTE,
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-12T09:00:00+09:00',
      },
      contactCount: { total: 3, call: 2, email: 0, visit: 1 },
      lastContactAt: '2026-11-12',
      salesStep: {
        code: 'DEMAND_CONFIRMED',
        since: '2026-11-12',
        overridden: false,
        known: [
          {
            questionId: 'plating',
            question: '지금 도금은?',
            answerId: 'OUTSOURCE',
            answer: '외주 줌',
            at: '2026-11-12',
            by: 'park-lee',
          },
        ],
        openQuestions: ['switch'],
      },
    },
    reviewItems: (fixture.reviewItems ?? []).map((item, index) =>
      index === 1 ? item : { ...item, note: { text: ITEM_MEMO, by: 'park-lee', at: '2026-11-11' } },
    ),
  };
}

function reply(data: OpportunityDetail, hasVirtualData = true): Envelope<OpportunityDetail> {
  return { data, meta: { updatedAt: '2026-10-20T09:00:00+09:00', hasVirtualData } };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/opportunities/opp-1/report']}>
      <Routes>
        <Route path="/opportunities/:oppId/report" element={<CompanyReportPage />} />
        <Route path="/opportunities/:oppId" element={<p>상세 화면</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CompanyReportPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedQuestions.mockReset();
    mockedQuestions.mockResolvedValue({ data: questionFile, meta: {} });
  });

  it('Given 저장된 상세 값 When 보고서를 열면 Then 첫 줄 표시와 한눈에·점수·근거·질문과 답·영업 단계가 보인다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithSecrets()));
    renderPage();

    expect(await screen.findByTestId('report-internal')).toHaveTextContent(companyReport.internal);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A정밀');

    expect(screen.getByTestId('report-name')).toHaveTextContent('A정밀');
    expect(screen.getByTestId('report-address')).toHaveTextContent('충청남도 당진시 가상로 1');
    expect(within(screen.getByTestId('report-homepage')).getByRole('link')).toHaveAttribute(
      'href',
      'https://example.invalid/apjeong',
    );
    expect(screen.getByTestId('report-intro')).toHaveTextContent(
      '알루미늄 주물 표면처리 전문 가상 기업',
    );
    expect(screen.getByTestId('report-reason')).toHaveTextContent('아노다이징 외주 협력사 모집');
    expect(screen.getByTestId('report-process-confirmed')).toHaveTextContent(
      `아노다이징 — 가상 (${companyReport.confirmed})`,
    );
    expect(screen.getByTestId('report-score')).toHaveTextContent('77점 · 7/8');

    expect(screen.getAllByTestId('report-score-row')).toHaveLength(fixture.scores!.items.length);
    expect(screen.getAllByTestId('report-evidence')).toHaveLength(fixture.evidence.length);
    expect(screen.getAllByTestId('report-evidence')[0]).toHaveTextContent('나라장터 공고 (가상)');

    // 꼬리 질문 답: 보기의 쉬운 말과 날짜
    expect(screen.getByTestId('report-known')).toHaveTextContent(
      '지금 도금은? 외주 줌 · 2026-11-12',
    );
    // 물을 것: 후속 조치, 아직 답 없는 꼬리 질문, 사례 파일에 적어 둔 확인 질문
    const ask = screen.getByTestId('report-ask-list');
    expect(ask).toHaveTextContent('응모 전 피막 두께 요구 확인');
    expect(ask).toHaveTextContent('외주처를 바꿀 생각이 있나요?');
    expect(ask).toHaveTextContent('당진 공장에서 직접 생산합니까? (사례 파일)');

    expect(screen.getByTestId('report-stage')).toHaveTextContent('접촉');
    expect(screen.getByTestId('report-step')).toHaveTextContent('수요 확인 (2026-11-12부터)');
    expect(screen.getByTestId('report-contacts')).toHaveTextContent('접촉 3회 (전화 2 · 방문 1)');
    expect(screen.getByTestId('report-last-contact')).toHaveTextContent('2026-11-12');
    expect(screen.getByTestId('report-next-schedule')).toHaveTextContent('2026-11-20');
  });

  // #719: 2023년 공지가 "자료 날짜 1/2"로만 보여 언제 자료인지 알 수 없었다. 보고서의 날짜는 연도까지 보인다.
  it('Given 여러 해에 걸친 날짜 When 보고서를 열면 Then 근거·답·접촉 날짜가 모두 연도까지 보인다', async () => {
    const detail = detailWithSecrets();
    mockedGet.mockResolvedValue(
      reply({
        ...detail,
        evidence: detail.evidence.map((row, index) =>
          index === 0 ? { ...row, occurredAt: '2023-01-02' } : row,
        ),
      }),
    );
    renderPage();
    await screen.findByTestId('company-report');
    expect(screen.getAllByTestId('report-evidence')[0]).toHaveTextContent('자료 날짜 2023-01-02');
    expect(screen.getByTestId('report-known')).toHaveTextContent(
      '지금 도금은? 외주 줌 · 2026-11-12',
    );
    expect(screen.getByTestId('report-step')).toHaveTextContent('수요 확인 (2026-11-12부터)');
    expect(screen.getByTestId('report-last-contact')).toHaveTextContent(/^.*2026-11-12$/);
    expect(screen.getAllByTestId('report-ask-answered')[0]).toHaveTextContent(
      '답 적음 · 2026-11-06',
    );
  });

  // #719: 인쇄하면 점수 표의 좁은 칸이 글자 중간에서 꺾였다("배/점", "강한 추/정", "자료 미/확보").
  // 화면 테스트는 칸에 붙는 클래스만 본다(테스트 환경은 CSS를 읽지 않는다). 인쇄 규칙은 src/styles.css의
  // .report-nowrap과 @media print에 있고, 실제 인쇄 모양은 이 테스트로 확인하지 못한다.
  it('Given 점수 표 When 보고서를 열면 Then 배점·점수·상태 칸은 줄이 꺾이지 않는 칸으로 표시된다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithSecrets()));
    renderPage();
    const table = await screen.findByTestId('report-scores-table');
    const head = within(table).getAllByRole('columnheader');
    expect(head.map((cell) => cell.textContent)).toEqual(['항목', '배점', '점수', '상태']);
    expect(head.map((cell) => cell.classList.contains('report-nowrap'))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    const row = within(table).getAllByTestId('report-score-row')[0];
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.classList.contains('report-nowrap')),
    ).toEqual([true, true, true]);
  });

  it('Given 값이 없는 점수 항목과 빈 기본 정보 When 보고서를 열면 Then 그 칸은 "확인 필요"이고 물을 것에 모인다', async () => {
    const items = fixture.scores!.items.map((item, index) =>
      index === 0 ? { ...item, score: null, state: 'UNAVAILABLE' } : item,
    );
    mockedGet.mockResolvedValue(
      reply({
        ...fixture,
        header: { ...fixture.header, address: null, homepageUrl: null, summaryLine: null },
        processLinks: [],
        scores: { ...fixture.scores!, items },
      }),
    );
    renderPage();

    const row = (await screen.findAllByTestId('report-score-row'))[0];
    expect(within(row).getByTestId('report-score-value')).toHaveTextContent(
      companyReport.needCheck,
    );
    for (const id of ['report-address', 'report-homepage', 'report-intro', 'report-process']) {
      expect(screen.getByTestId(id)).toHaveTextContent(companyReport.needCheck);
    }
    const ask = screen.getByTestId('report-ask-list');
    expect(within(ask).getByText(`${companyReport.questions.missingScoresTopic} —`)).toBeVisible();
    expect(ask).toHaveTextContent(items[0].label);
    expect(ask).toHaveTextContent('주소 · 홈페이지 · 한 줄 소개');
  });

  it('Given 점수가 아직 없는 회사 When 보고서를 열면 Then 점수표 대신 "점수 전 · 확인 필요"가 보인다', async () => {
    mockedGet.mockResolvedValue(
      reply({ ...fixture, header: { ...fixture.header, scoreDisplay: '--' }, scores: null }),
    );
    renderPage();

    expect(await screen.findByTestId('report-scores-none')).toHaveTextContent(
      companyReport.scores.none,
    );
    expect(screen.queryByTestId('report-scores-table')).not.toBeInTheDocument();
  });

  it('Given AI가 제안한 근거·공정·산업·점수 입력 When 보고서를 열면 Then "AI 제안 · 확인 전"이 붙는다', async () => {
    const code = fixture.scores!.items[0].itemCode;
    mockedGet.mockResolvedValue(
      reply({
        ...fixture,
        header: {
          ...fixture.header,
          fitLevel: 'HIGH',
          pickReason: '볼트를 만들고 도금을 외주로 줄 가능성이 큼',
          industries: ['기계·설비'],
          industriesSource: 'AI',
        },
        processLinks: [],
        evidence: fixture.evidence.map((row, index) =>
          index === 0 ? { ...row, isLlmProposed: true } : row,
        ),
        reviewItems: [
          {
            itemId: 'PL:ZINC',
            kind: 'PROCESS_LINK_PROPOSAL',
            source: 'AI',
            text: 'AI 공정 연결 제안 · 아연도금 · 근거: 볼트 생산',
            checked: false,
          },
          {
            itemId: `II:${code}`,
            kind: 'ITEM_INPUT_PROPOSAL',
            source: 'AI',
            text: 'AI 점수 입력 제안',
            checked: false,
          },
        ],
      }),
    );
    renderPage();

    const ai = companyReport.aiProposal;
    expect(await screen.findByTestId('report-process-proposed')).toHaveTextContent(
      `아연도금 (${ai})`,
    );
    expect(screen.getByTestId('report-industry')).toHaveTextContent(`기계·설비 (${ai})`);
    expect(screen.getByTestId('report-fit')).toHaveTextContent(`적합도 상 (${ai})`);
    expect(screen.getByTestId('report-pick-reason')).toHaveTextContent(ai);
    expect(screen.getAllByTestId('report-evidence')[0]).toHaveTextContent(ai);
    expect(screen.getAllByTestId('report-evidence')[1]).not.toHaveTextContent(ai);
    expect(screen.getAllByTestId('report-score-row')[0]).toHaveTextContent(ai);
    expect(screen.getAllByTestId('report-score-row')[1]).not.toHaveTextContent(ai);
  });

  it('Given 가상 자료 When 보고서를 열면 Then "가상·거산 실제 사양 아님" 표시가 보이고, 실제 자료면 보이지 않는다', async () => {
    mockedGet.mockResolvedValue(reply(fixture));
    renderPage();
    expect(await screen.findByTestId('report-virtual')).toHaveTextContent(banner.virtualData);
    expect(banner.virtualData).toContain('가상·거산 실제 사양 아님');
  });

  it('Given 실제 자료 When 보고서를 열면 Then 가상 표시는 없다', async () => {
    mockedGet.mockResolvedValue(
      reply({ ...fixture, header: { ...fixture.header, isVirtual: false } }, false),
    );
    renderPage();
    await screen.findByTestId('report-internal');
    expect(screen.queryByTestId('report-virtual')).not.toBeInTheDocument();
  });

  it('Given 응답에 영업 메모·대표번호·답 글·일정 글이 실려 와도 When 보고서를 열면 Then 화면 어디에도 보이지 않는다', async () => {
    const detail = detailWithSecrets();
    mockedGet.mockResolvedValue(reply(detail));
    renderPage();

    const page = await screen.findByTestId('company-report');
    for (const secret of [
      PHONE,
      SALES_MEMO,
      '010-1234-5678',
      ITEM_MEMO,
      REPLY_TEXT,
      SCHEDULE_NOTE,
      fixture.header.relationNote!,
      'park-lee',
    ]) {
      expect(page).not.toHaveTextContent(secret);
      // 화면이 그리는 모델에도 실리지 않는다.
      expect(JSON.stringify(reportModelOf(detail, true, questionFile))).not.toContain(secret);
    }
    // 답이 적힌 질문은 글 없이 답한 날만 보인다.
    expect(screen.getAllByTestId('report-ask-answered')[0]).toHaveTextContent(
      '답 적음 · 2026-11-06',
    );
  });

  it('Given 상세를 불러오지 못함 When 보고서를 열면 Then 빈 보고서가 아니라 오류 안내와 [다시 시도]가 보인다', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network'));
    mockedGet.mockResolvedValueOnce(reply(fixture));
    renderPage();

    expect(await screen.findByTestId('report-states-error')).toHaveTextContent(
      companyReport.loadError,
    );
    expect(screen.queryByTestId('company-report')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-print-button')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('report-states-retry-button'));
    expect(await screen.findByTestId('company-report')).toBeInTheDocument();
  });

  it('Given 없는 회사 When 보고서를 열면 Then 찾을 수 없다는 안내가 보인다', async () => {
    mockedGet.mockRejectedValue(
      new ApiError(404, { message: '없음', nextAction: '목록에서 고르기', ref: 'r-1' }),
    );
    renderPage();
    expect(await screen.findByTestId('report-states-empty')).toHaveTextContent(
      companyReport.notFound,
    );
  });

  it('Given 꼬리 질문 파일을 못 받음 When 보고서를 열면 Then 보고서는 보이되 빠진 줄이 있다고 알린다', async () => {
    mockedQuestions.mockRejectedValue(new Error('network'));
    mockedGet.mockResolvedValue(reply(detailWithSecrets()));
    renderPage();

    expect(await screen.findByTestId('report-states-partial')).toHaveTextContent(
      companyReport.questionsFailed,
    );
    expect(screen.getByTestId('company-report')).toBeInTheDocument();
    expect(screen.getByTestId('report-ask-list')).not.toHaveTextContent(
      '외주처를 바꿀 생각이 있나요?',
    );
  });

  it('Given 보고서 화면 When [인쇄]를 누르면 Then 브라우저 인쇄를 부르고, [상세로 돌아가기]는 상세로 간다', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    mockedGet.mockResolvedValue(reply(fixture));
    renderPage();

    await userEvent.click(await screen.findByTestId('report-print-button'));
    expect(print).toHaveBeenCalledTimes(1);
    // 단추·링크 줄은 인쇄할 때 숨기는 묶음 안에 있다.
    expect(screen.getByTestId('report-actions')).toHaveClass('no-print');

    await userEvent.click(screen.getByTestId('report-back-link'));
    expect(await screen.findByText('상세 화면')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
