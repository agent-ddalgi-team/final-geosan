// 근거 상세(S2): 영역 순서 / 질문 3개+펼치기 / 요구 0개 문구 / 확인·추정 글자 / 점수 접힘 / 404 (+ 요구 표, 오류).
// 서버 호출(getOpportunityDetail)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import { ApiError, getOpportunityDetail } from '../../api/client';
import type { Envelope, OpportunityDetail, Question } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { detailSections, frame, opinionArea, states } from '../../labels/ko';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const base = detailFixture.data as unknown as OpportunityDetail;

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
          <Route path="/" element={<p>목록 화면</p>} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
  return setPageTitle;
}

describe('OpportunityDetailPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
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
    ]);
    const last = screen.getByTestId('detail-opinion');
    expect(within(last).getByTestId('opinion-area')).toBeInTheDocument();
    expect(setPageTitle).toHaveBeenCalledWith('A정밀 · 밸브 바디 아노다이징');
    expect(screen.getByTestId('detail-classification')).toHaveTextContent('지금 바로 연락 검토');
    expect(screen.getByTestId('detail-score')).toHaveTextContent('점수 81');
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
    ).toHaveTextContent('거산에 확인할 것 (소개서 값, 검수 전)');
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
    expect(hint).toHaveTextContent("상대 회사에 물을 것은 위의 '다음 할 일'에 있고");
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

  it('요약이 하나도 없으면 지금 화면 그대로 엔진이 만든 추천 이유 문장을 보인다', async () => {
    const items = base.scores!.items.map((item) => ({ ...item, summary: null }));
    mockedGet.mockResolvedValueOnce(reply({ ...base, scores: { ...base.scores!, items } }));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    expect(screen.queryByTestId('detail-reason-lines')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-reason')).toHaveTextContent(
      `추천 이유: ${base.reasons.reason}`,
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
    expect(screen.getByTestId('opportunity-detail')).not.toHaveTextContent(/확인된 점수 E/);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('접기');
    expect(screen.getByTestId('score-e')).toHaveTextContent('77');
    expect(screen.getByTestId('score-p')).toHaveTextContent('95');
    expect(screen.getByTestId('score-s')).toHaveTextContent('81.1');
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
