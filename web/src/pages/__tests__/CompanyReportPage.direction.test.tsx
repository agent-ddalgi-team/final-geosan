// 회사별 보고서의 "영업 방향"(#742): 메모 가운데 남긴 피드백과(#750) 가장 최근 다음 통화 준비만 싣는다.
// 서버 호출(getOpportunityDetail·getSalesQuestions)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyReportPage from '../CompanyReportPage';
import { getOpportunityDetail, getSalesQuestions } from '../../api/client';
import type { OpportunityDetail } from '../../api/types';
import { reportModelOf } from '../../components/report/reportModel';
import { companyReport, reportView } from '../../labels/ko';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getSalesQuestions: vi.fn(),
}));

const fixture = detailFixture.data as unknown as OpportunityDetail;
const ADVICE = '10/28에 물어본 납기에 아직 답을 못 줬어요.';
const SALES_MEMO = '영업 메모: 김 과장 010-1234-5678 다음 주 통화';

function detailWithAdvice(): OpportunityDetail {
  return {
    ...fixture,
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
      advice: [{ noteId: 'note-3', text: ADVICE, at: '2026-11-14T09:00:00+09:00', by: 'park-lee' }],
    },
  };
}

function renderReport() {
  render(
    <MemoryRouter initialEntries={['/opportunities/opp-1/report']}>
      <Routes>
        <Route path="/opportunities/:oppId/report" element={<CompanyReportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('회사별 보고서 › 6. 영업 방향 (#742)', () => {
  it('남긴 피드백은 날짜와 글만 싣고, 영업 메모·담당자 키는 싣지 않는다', async () => {
    vi.mocked(getOpportunityDetail).mockResolvedValue({ data: detailWithAdvice(), meta: {} });
    vi.mocked(getSalesQuestions).mockRejectedValue(
      new Error('이 시험에서는 질문 파일을 보지 않는다'),
    );
    renderReport();
    const section = await screen.findByTestId('report-direction-section');
    expect(section).toHaveTextContent(companyReport.sections.direction);
    expect(within(section).getByTestId('report-direction')).toHaveTextContent(
      `2026-11-14 · ${ADVICE}`,
    );
    const report = screen.getByTestId('company-report');
    expect(report).not.toHaveTextContent(SALES_MEMO);
    expect(section).not.toHaveTextContent('park-lee');
  });

  it('(#750) 가장 최근 다음 통화 준비가 남긴 피드백 아래 "다음 통화에 물어볼 것"으로 실린다', async () => {
    const base = detailWithAdvice();
    const lines = ['외주처는 어디인가요?', '방문 날짜를 정할 수 있을까요?'];
    vi.mocked(getOpportunityDetail).mockResolvedValue({
      data: {
        ...base,
        records: {
          ...base.records,
          callPrep: { noteId: 'note-4', lines, at: '2026-11-15T10:00:00+09:00', by: 'park-lee' },
        },
      },
      meta: {},
    });
    vi.mocked(getSalesQuestions).mockRejectedValue(new Error('질문 파일 없음'));
    renderReport();
    const section = await screen.findByTestId('report-direction-section');
    expect(section).toHaveTextContent(companyReport.direction.nextCall('2026-11-15'));
    expect(
      within(within(section).getByTestId('report-next-call'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(lines);
    expect(section).not.toHaveTextContent('park-lee');
  });

  it('(#974) Given 보고서 When 6. 영업 방향을 보면 Then 입력 칸 대신 [상세에서 기록 남기기 →] 링크 하나가 그 회사 상세를 가리키고 인쇄할 때 숨긴다', async () => {
    vi.mocked(getOpportunityDetail).mockResolvedValue({ data: detailWithAdvice(), meta: {} });
    vi.mocked(getSalesQuestions).mockRejectedValue(new Error('질문 파일 없음'));
    renderReport();
    const section = await screen.findByTestId('report-direction-section');
    const link = within(section).getByTestId('report-direction-link');
    expect(link).toHaveTextContent(reportView.directionLink);
    expect(link).toHaveAttribute('href', '/opportunities/opp-1');
    // 테스트 환경은 CSS를 읽지 않는다: 인쇄할 때 숨김은 붙은 클래스(no-print)까지만 확인한다.
    expect(link).toHaveClass('no-print');
    // 적는 곳은 상세의 영업 코치 한 곳뿐이다: 보고서에는 입력 칸·저장 단추가 없다.
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
    // 남긴 줄은 그대로 보인다.
    expect(within(section).getByTestId('report-direction')).toHaveTextContent(ADVICE);
  });

  it('(#974) 남긴 피드백이 없어도 [상세에서 기록 남기기 →] 링크는 보인다', async () => {
    vi.mocked(getOpportunityDetail).mockResolvedValue({ data: fixture, meta: {} });
    vi.mocked(getSalesQuestions).mockRejectedValue(new Error('질문 파일 없음'));
    renderReport();
    const section = await screen.findByTestId('report-direction-section');
    expect(within(section).getByTestId('report-direction-none')).toHaveTextContent(
      companyReport.direction.none,
    );
    expect(within(section).getByTestId('report-direction-link')).toHaveAttribute(
      'href',
      '/opportunities/opp-1',
    );
  });

  it('남긴 피드백이 없으면(옛 응답 포함) "없습니다" 한 줄이다', () => {
    const model = reportModelOf(fixture, false, null, '2026-11-14');
    expect(model.direction).toEqual([]);
    expect(model.nextCall).toBeNull();
    vi.mocked(getOpportunityDetail).mockResolvedValue({ data: fixture, meta: {} });
    vi.mocked(getSalesQuestions).mockRejectedValue(new Error('질문 파일 없음'));
    renderReport();
    return screen
      .findByTestId('report-direction-none')
      .then((node) => expect(node).toHaveTextContent(companyReport.direction.none));
  });
});
