// 회사별 보고서 새 모양(#972): 맨 위 줄 · 목차 · 한눈에 꼬리표와 점수 동그라미 · 점수 줄 펼치기 · 근거 거르기 ·
// 단계 그림 · 읽기 전용 영업 방향 · 넣지 않는 값이 여전히 없는지.
// 서버 호출(getOpportunityDetail·getSalesQuestions)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// 테스트 환경은 CSS를 읽지 않는다: 인쇄할 때 숨김·펼침은 붙은 클래스(no-print)와 hidden 값까지만 확인한다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyReportPage from '../CompanyReportPage';
import { getOpportunityDetail, getSalesQuestions } from '../../api/client';
import type { Envelope, OpportunityDetail, SalesQuestions } from '../../api/types';
import { banner, companyReport, reportView } from '../../labels/ko';
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
const SCHEDULE_NOTE = '견적 보내기 — 구매팀 이 대리';
const ADVICE = '아연도금 물량이 있는지부터 묻기';

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

/** 영업 기록(메모·일정 글·담당자 키 포함)과 근거 네 건(두 묶음)이 실린 상세 응답. */
function detailWithRecords(nextScheduleAt = '2099-12-31'): OpportunityDetail {
  const [signal, product] = fixture.evidence;
  return {
    ...fixture,
    header: { ...fixture.header, mainPhone: PHONE },
    evidence: [
      signal,
      product,
      { ...product, evidenceId: 'ev-3', quote: '하우징 가공 후 표면처리 (가상)' },
      { ...product, evidenceId: 'ev-4', quote: '알루미늄 주물 부품 (가상)', subject: 'MATERIAL' },
    ],
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
        nextScheduleAt,
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
      advice: [{ noteId: 'note-3', text: ADVICE, at: '2026-11-14T09:00:00+09:00', by: 'park-lee' }],
    },
  };
}

function reply(data: OpportunityDetail): Envelope<OpportunityDetail> {
  return { data, meta: { updatedAt: '2026-10-20T09:00:00+09:00', hasVirtualData: true } };
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

describe('회사별 보고서 새 모양 (#972)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedQuestions.mockReset();
    mockedQuestions.mockResolvedValue({ data: questionFile, meta: {} });
  });

  it('Given 보고서 When 열면 Then 맨 위 줄에 돌아가기·이름·만든 날·모두 펼치기·인쇄가 있고 인쇄할 때 숨기는 묶음이다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    await screen.findByTestId('company-report');

    const bar = screen.getByTestId('report-actions');
    expect(bar).toHaveClass('no-print');
    expect(within(bar).getByTestId('report-back-link')).toHaveTextContent(
      `← ${companyReport.backToDetail}`,
    );
    expect(within(bar).getByTestId('report-back-link')).toHaveAttribute(
      'href',
      '/opportunities/opp-1',
    );
    expect(bar).toHaveTextContent(companyReport.pageTitle);
    expect(within(bar).getByTestId('report-made-at')).toHaveTextContent(
      /^만든 날 \d{4}-\d{2}-\d{2} · 저장된 값 그대로\(AI를 다시 부르지 않음\)$/,
    );
    expect(within(bar).getByTestId('report-expand-all-button')).toHaveTextContent(
      reportView.expandAll,
    );
    expect(within(bar).getByTestId('report-print-button')).toHaveTextContent(companyReport.print);
    // 인쇄한 종이에는 맨 위 줄 대신 "회사별 보고서 — 회사 · 품목"과 만든 날 줄이 나온다.
    expect(screen.getByTestId('report-print-head')).toHaveTextContent(
      `${companyReport.pageTitle} — ${fixture.header.title}`,
    );
    expect(screen.getByTestId('report-print-head')).toHaveTextContent(/만든 날 \d{4}-\d{2}-\d{2}/);
  });

  it('Given 목차 When 5번 "영업 단계"를 누르면 Then 그 묶음으로 화면과 초점이 옮겨 가고 목차는 인쇄할 때 숨긴다', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    await screen.findByTestId('company-report');

    const toc = screen.getByRole('navigation', { name: reportView.toc.title });
    expect(toc).toHaveClass('no-print');
    const links = within(toc).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      '1한눈에',
      '2점수 8항목',
      '3근거',
      '4확인 질문',
      '5영업 단계',
      '6영업 방향',
    ]);
    // 목차의 줄마다 가리키는 묶음이 화면에 있다.
    for (const link of links) {
      const id = link.getAttribute('href')!.slice(1);
      expect(screen.getByTestId(id)).toHaveAttribute('id', id);
    }
    expect(links[0]).toHaveAttribute('aria-current', 'location');

    await userEvent.click(links[4]);
    const sales = screen.getByTestId('report-sales');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(sales);
    expect(sales).toHaveFocus();
    expect(links[4]).toHaveAttribute('aria-current', 'location');
    expect(links[0]).not.toHaveAttribute('aria-current');
  });

  it('Given 가상 사례 When 보고서를 열면 Then 한눈에 카드에 회사·검토 대상과 "내부용 · 거산 확인 전"·가상 표시·꼬리표가 보인다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const glance = await screen.findByTestId('report-glance');

    expect(within(glance).getByRole('heading', { level: 1 })).toHaveTextContent('A정밀');
    expect(within(glance).getByTestId('report-item')).toHaveTextContent(
      '검토 대상 · 밸브 바디 아노다이징',
    );
    const marks = within(glance).getByTestId('report-marks');
    expect(within(marks).getByTestId('report-internal')).toHaveTextContent(companyReport.internal);
    expect(within(marks).getByTestId('report-virtual')).toHaveTextContent(banner.virtualData);
    expect(within(marks).getByTestId('report-process-tag')).toHaveTextContent('공정 확인됨');
    // 사례 파일에는 홈페이지·산업 값이 없다 → 두 칸이 "확인 필요".
    expect(within(marks).getByTestId('report-need-check-count')).toHaveTextContent('확인 필요 2');
    expect(within(glance).getByTestId('report-homepage')).toHaveTextContent(
      companyReport.needCheck,
    );
    expect(within(glance).getByTestId('report-industry')).toHaveTextContent(
      companyReport.needCheck,
    );
  });

  it('Given 77점(배점 합 100) When 보고서를 열면 Then 점수 동그라미와 합계 / 100, 상태별 개수, 영업 요약 네 칸이 보인다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const card = await screen.findByTestId('report-score-card');

    const ring = within(card).getByRole('img', { name: '점수 100점 가운데 77점' });
    expect(ring).toHaveAttribute('data-ratio', '0.77');
    expect(within(card).getByTestId('report-score-total')).toHaveTextContent('77 / 100');
    // 서버가 준 점수 글자도 그대로 보인다.
    expect(within(card).getByTestId('report-score')).toHaveTextContent('77점 · 7/8');
    expect(within(card).getByTestId('report-score-states')).toHaveTextContent(
      '확인 6 · 신호 없음 1 · 자료 미확보 1',
    );
    expect(within(card).getByTestId('report-glance-stage')).toHaveTextContent('영업 단계 접촉');
    expect(within(card).getByTestId('report-glance-step')).toHaveTextContent('세부 단계 수요 확인');
    expect(within(card).getByTestId('report-glance-contacts')).toHaveTextContent('접촉 3회');
    expect(within(card).getByTestId('report-glance-last-contact')).toHaveTextContent(
      '마지막 접촉 2026-11-12',
    );
    // 앞으로의 일정이면 놓친 일정 알림은 없다.
    expect(screen.queryByTestId('report-missed-alert')).not.toBeInTheDocument();
  });

  it('Given 지난 날짜의 일정 When 보고서를 열면 Then 한눈에 카드에 "놓친 일정" 알림 줄이 보이고 할 일 글은 없다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords('2020-01-02')));
    renderPage();
    const alert = await screen.findByTestId('report-missed-alert');
    expect(alert).toHaveTextContent('놓친 일정2020-01-02 · 다음 일정을 다시 잡아 주세요');
    expect(alert).not.toHaveTextContent(SCHEDULE_NOTE);
  });

  it('Given 점수가 아직 없는 회사 When 보고서를 열면 Then 동그라미는 비어 있고 "점수 전"으로 읽히며 모두 펼치기 단추가 없다', async () => {
    mockedGet.mockResolvedValue(
      reply({ ...fixture, header: { ...fixture.header, scoreDisplay: '--' }, scores: null }),
    );
    renderPage();
    const card = await screen.findByTestId('report-score-card');
    expect(within(card).getByRole('img', { name: reportView.glance.ringAriaNone })).toHaveAttribute(
      'data-ratio',
      '0.00',
    );
    expect(within(card).getByTestId('report-score-total')).toHaveTextContent('--');
    expect(screen.queryByTestId('report-expand-all-button')).not.toBeInTheDocument();
  });

  it('Given 점수 줄 When 줄을 누르면 Then 그 줄의 이유만 펼쳐지고 다시 누르면 접힌다(키보드로도)', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const rows = await screen.findAllByTestId('report-score-row');
    const first = within(rows[0]).getByRole('button');
    const why = within(rows[0]).getByTestId('report-score-why');

    // 처음에는 모두 접혀 있다.
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(why).not.toBeVisible();
    expect(first).toHaveAttribute('aria-controls', why.id);

    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(why).toBeVisible();
    expect(why).toHaveTextContent(fixture.scores!.items[0].factJudged!);
    expect(within(rows[1]).getByTestId('report-score-why')).not.toBeVisible();

    first.focus();
    await userEvent.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(why).not.toBeVisible();
  });

  it('Given 점수 줄 When [근거 설명 모두 펼치기]를 누르면 Then 모든 줄의 이유가 펼쳐지고 단추가 [모두 접기]로 바뀐다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const button = await screen.findByTestId('report-expand-all-button');
    const reasons = screen.getAllByTestId('report-score-why');
    expect(reasons).toHaveLength(fixture.scores!.items.length);
    for (const reason of reasons) expect(reason).not.toBeVisible();

    await userEvent.click(button);
    for (const reason of reasons) expect(reason).toBeVisible();
    expect(button).toHaveTextContent(reportView.collapseAll);
    expect(button).toHaveAttribute('aria-pressed', 'true');

    // 한 줄만 접으면 단추는 다시 [모두 펼치기]다.
    await userEvent.click(screen.getAllByTestId('report-score-toggle')[0]);
    expect(reasons[0]).not.toBeVisible();
    expect(button).toHaveTextContent(reportView.expandAll);

    await userEvent.click(button);
    await userEvent.click(button);
    for (const reason of reasons) expect(reason).not.toBeVisible();
  });

  it('Given 이유(판정 요지)가 없는 점수 줄 When 보고서를 열면 Then 그 줄은 누르는 단추가 아니다', async () => {
    const items = fixture.scores!.items.map((item, index) =>
      index === 0 ? { ...item, factJudged: null } : item,
    );
    mockedGet.mockResolvedValue(reply({ ...fixture, scores: { ...fixture.scores!, items } }));
    renderPage();
    const rows = await screen.findAllByTestId('report-score-row');
    expect(within(rows[0]).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[0]).queryByTestId('report-score-why')).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('button')).toBeInTheDocument();
  });

  it('Given 점수 묶음 When 보고서를 열면 Then 아래 합계 줄에 합계·점수를 받은 항목 수·가장 크게 비는 곳이 보인다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const summary = await screen.findByTestId('report-score-summary');
    expect(summary).toHaveTextContent('합계 77 / 100');
    expect(summary).toHaveTextContent('점수를 받은 항목 6개');
    expect(summary).toHaveTextContent('가장 크게 비는 곳 신규 수주·제품 출시·사업 확대 (0 / 8)');
  });

  it('Given 묶음이 셋인 근거 네 건 When 거르기 단추를 누르면 Then 그 묶음 카드만 보이고 [전체]로 돌아온다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const filters = await screen.findByTestId('report-evidence-filters');
    // 거르기 단추는 인쇄할 때 숨긴다(인쇄에는 전체가 나온다).
    expect(filters).toHaveClass('no-print');
    const buttons = within(filters).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      '전체',
      '회사 소식 1',
      '제품 2',
      '소재 1',
    ]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    const cards = screen.getAllByTestId('report-evidence');
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(card).toBeVisible();
    expect(screen.getByTestId('report-evidence-section')).toHaveTextContent('원문 인용 4개');

    await userEvent.click(buttons[2]);
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(cards.map((card) => card.hidden)).toEqual([true, false, false, true]);
    // 걸러도 카드는 지우지 않는다(인쇄할 때 전체가 나오게).
    expect(screen.getAllByTestId('report-evidence')).toHaveLength(4);

    await userEvent.click(buttons[0]);
    expect(cards.map((card) => card.hidden)).toEqual([false, false, false, false]);
  });

  it('Given 묶음이 하나뿐인 근거 When 보고서를 열면 Then 거르기 단추는 없다', async () => {
    mockedGet.mockResolvedValue(reply({ ...fixture, evidence: [fixture.evidence[0]] }));
    renderPage();
    await screen.findByTestId('report-evidence-list');
    expect(screen.queryByTestId('report-evidence-filters')).not.toBeInTheDocument();
  });

  it('Given 접촉 단계의 회사 When 보고서를 열면 Then 상세와 같은 단계 그림이 보이고 그 그림에 일정의 할 일 글·연도 없는 날짜가 없다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const sales = await screen.findByTestId('report-sales');
    const progress = within(sales).getByTestId('report-progress');
    const bar = within(progress).getByTestId('sales-progress');
    expect(within(bar).getAllByTestId('sales-progress-band')).toHaveLength(4);
    expect(
      within(bar)
        .getAllByTestId('sales-progress-step')
        .find((step) => step.getAttribute('aria-current') === 'step'),
    ).toHaveTextContent('수요 확인');
    expect(progress).not.toHaveTextContent(SCHEDULE_NOTE);
    expect(progress).not.toHaveTextContent('다음 일정');
    expect(progress).not.toHaveTextContent('11/12');
    // 날짜는 그림 밖에서 연도까지 적는다.
    expect(within(sales).getByTestId('report-step')).toHaveTextContent(
      '세부 단계 · 수요 확인 (2026-11-12부터)',
    );
    expect(within(sales).getByTestId('report-next-schedule')).toHaveTextContent(
      '다음 일정 2099-12-31 다음 연락',
    );
  });

  it('Given 저장된 코치 피드백 When 보고서를 열면 Then 영업 방향은 읽기만 하고 화면 어디에도 글 입력 칸·[피드백 남기기]가 없다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords()));
    renderPage();
    const section = await screen.findByTestId('report-direction-section');
    expect(within(section).getByTestId('report-direction')).toHaveTextContent(
      `2026-11-14 · ${ADVICE}`,
    );
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
    const page = screen.getByTestId('report-page');
    expect(within(page).queryByRole('textbox')).not.toBeInTheDocument();
    expect(page.querySelector('textarea, input[type="text"], select')).toBeNull();
    expect(page).not.toHaveTextContent('피드백 남기기');
  });

  it('Given 영업 메모·대표번호·일정 글·담당자 키가 실린 응답 When 새 모양의 보고서를 모두 펼쳐도 Then 화면 어디에도 없다', async () => {
    mockedGet.mockResolvedValue(reply(detailWithRecords('2020-01-02')));
    renderPage();
    await userEvent.click(await screen.findByTestId('report-expand-all-button'));
    const page = screen.getByTestId('report-page');
    for (const secret of [
      PHONE,
      SALES_MEMO,
      '010-1234-5678',
      SCHEDULE_NOTE,
      fixture.header.relationNote!,
      'park-lee',
    ]) {
      expect(page).not.toHaveTextContent(secret);
    }
    expect(page.innerHTML).not.toContain('park-lee');
    expect(page.innerHTML).not.toContain(PHONE);
  });
});
