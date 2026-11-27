// 회사별 보고서 "방문·통화 때 물을 것"의 체크칸(#972): 체크는 이 브라우저(localStorage)에만 회사별로 기억한다.
// 서버 호출(getOpportunityDetail·getSalesQuestions)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// 인쇄한 종이에 체크 모양이 그대로 나오는지는 이 테스트로 확인하지 못한다(브라우저 인쇄 동작).
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyReportPage from '../CompanyReportPage';
import { getOpportunityDetail, getSalesQuestions } from '../../api/client';
import type { OpportunityDetail } from '../../api/types';
import { ASKED_STORAGE_PREFIX } from '../../components/report/ReportQuestions';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getSalesQuestions: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedQuestions = vi.mocked(getSalesQuestions);
const fixture = detailFixture.data as unknown as OpportunityDetail;

function renderPage(oppId = 'opp-1') {
  return render(
    <MemoryRouter initialEntries={[`/opportunities/${oppId}/report`]}>
      <Routes>
        <Route path="/opportunities/:oppId/report" element={<CompanyReportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function askLines() {
  const list = await screen.findByTestId('report-ask-list');
  return within(list).getAllByTestId('report-ask');
}

describe('회사별 보고서 › 방문·통화 때 물을 것 체크칸 (#972)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
    mockedQuestions.mockReset();
    mockedGet.mockResolvedValue({ data: fixture, meta: { hasVirtualData: true } });
    mockedQuestions.mockResolvedValue({ data: { version: 1, steps: [], questions: [] }, meta: {} });
  });

  it('Given 물을 것 목록 When 한 줄을 체크하면 Then "n개 남음"이 하나 줄고, 이 브라우저에 회사별로 기억하며 서버는 다시 부르지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPage();
    const lines = await askLines();
    const total = lines.length;
    expect(total).toBeGreaterThan(1);
    expect(screen.getByTestId('report-ask-left')).toHaveTextContent(`${total}개 남음`);
    for (const line of lines) expect(within(line).getByRole('checkbox')).not.toBeChecked();

    const second = within(lines[1]).getByRole('checkbox');
    await userEvent.click(second);

    expect(second).toBeChecked();
    expect(screen.getByTestId('report-ask-left')).toHaveTextContent(`${total - 1}개 남음`);
    expect(JSON.parse(window.localStorage.getItem(`${ASKED_STORAGE_PREFIX}opp-1`)!)).toEqual([
      lines[1].getAttribute('data-line'),
    ]);
    // 체크는 서버에 저장하지 않는다: 처음 불러온 두 호출 말고는 아무것도 부르지 않는다.
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedQuestions).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('Given 줄의 글자 When 글자를 누르면 Then 그 줄의 체크칸이 체크된다(줄 전체가 체크칸의 이름표)', async () => {
    renderPage();
    const lines = await askLines();
    const text = lines[0].querySelector('.report-ask-text')!;
    await userEvent.click(text);
    expect(within(lines[0]).getByRole('checkbox')).toBeChecked();
    // 체크칸의 이름은 그 줄의 글이다.
    expect(within(lines[0]).getByRole('checkbox')).toHaveAccessibleName(
      expect.stringContaining(text.textContent!.trim()),
    );
  });

  it('Given 체크해 둔 보고서 When 닫았다 다시 열면 Then 체크가 그대로이고, 풀면 기억에서도 지워진다', async () => {
    renderPage();
    let lines = await askLines();
    await userEvent.click(within(lines[0]).getByRole('checkbox'));
    await userEvent.click(within(lines[2]).getByRole('checkbox'));
    cleanup();

    renderPage();
    lines = await askLines();
    expect(
      lines.map((line) => within(line).getByRole<HTMLInputElement>('checkbox').checked),
    ).toEqual(lines.map((_, index) => index === 0 || index === 2));
    expect(screen.getByTestId('report-ask-left')).toHaveTextContent(`${lines.length - 2}개 남음`);

    await userEvent.click(within(lines[0]).getByRole('checkbox'));
    await userEvent.click(within(lines[2]).getByRole('checkbox'));
    expect(window.localStorage.getItem(`${ASKED_STORAGE_PREFIX}opp-1`)).toBeNull();
    expect(screen.getByTestId('report-ask-left')).toHaveTextContent(`${lines.length}개 남음`);
  });

  it('Given 한 회사에서 체크해 둠 When 다른 회사의 보고서를 열면 Then 그 회사의 체크칸은 비어 있다', async () => {
    renderPage('opp-1');
    const lines = await askLines();
    await userEvent.click(within(lines[0]).getByRole('checkbox'));
    cleanup();

    renderPage('opp-2');
    for (const line of await askLines()) {
      expect(within(line).getByRole('checkbox')).not.toBeChecked();
    }
    expect(window.localStorage.getItem(`${ASKED_STORAGE_PREFIX}opp-2`)).toBeNull();
    expect(window.localStorage.getItem(`${ASKED_STORAGE_PREFIX}opp-1`)).not.toBeNull();
  });

  it('Given 기억해 둔 값이 깨져 있음 When 보고서를 열면 Then 체크 없이 열리고 체크는 정상으로 된다', async () => {
    window.localStorage.setItem(`${ASKED_STORAGE_PREFIX}opp-1`, '{깨진 값');
    renderPage();
    const lines = await askLines();
    for (const line of lines) expect(within(line).getByRole('checkbox')).not.toBeChecked();
    await userEvent.click(within(lines[0]).getByRole('checkbox'));
    expect(JSON.parse(window.localStorage.getItem(`${ASKED_STORAGE_PREFIX}opp-1`)!)).toEqual([
      lines[0].getAttribute('data-line'),
    ]);
  });

  it('Given 체크칸이 생긴 보고서 When 열면 Then 글을 적는 칸은 여전히 없다', async () => {
    renderPage();
    await askLines();
    const page = screen.getByTestId('report-page');
    expect(within(page).queryByRole('textbox')).not.toBeInTheDocument();
    expect(page.querySelectorAll('input:not([type="checkbox"]), textarea, select')).toHaveLength(0);
  });
});
