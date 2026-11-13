// #691(PM 결정 2026-11-13) 상세 화면: 머리의 [기록 남기기] 바로 가기, 공정·산업을 함께 확정해 상세 전체를 다시 받아도
// 화면이 맨 위로 튀지 않고 "저장됨"과 고른 종류가 남는 것, "한눈에 › 확인할 것"과 "2. 통화에서 확인할 것"이 같은 기준인 것.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 실제 스크롤 위치는 이 시험 환경(jsdom)에 없어서
// "화면을 비우지 않고 같은 자리의 부품을 그대로 둔다"로 확인한다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import {
  getActivity,
  getOpportunityDetail,
  getPeers,
  getSalesQuestions,
  postOutcome,
} from '../../api/client';
import type { Envelope, OpportunityDetail, SalesQuestions } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  getPeers: vi.fn(),
  getSalesQuestions: vi.fn(),
  postOutcome: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const mockedOutcome = vi.mocked(postOutcome);
const fixtureData = detailFixture.data as unknown as OpportunityDetail;

const QUESTIONS: SalesQuestions = {
  version: 1,
  steps: [
    { code: 'NOT_REACHED', label: '연결 전', stage: 'IN_PROGRESS' },
    { code: 'REACHED', label: '연결됨', stage: 'IN_PROGRESS' },
    { code: 'DEMAND_CONFIRMED', label: '수요 확인', stage: 'IN_PROGRESS' },
    { code: 'MATERIAL_QUOTE', label: '자료·견적', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
    { code: 'VISIT_SAMPLE', label: '방문·샘플', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
  ],
  questions: [
    {
      questionId: 'CONFIRM_PROCESS',
      text: '어떤 공정을 맡길 수 있나요?',
      step: 'REACHED',
      choices: 'PROCESS',
      answers: [
        { answerId: 'ZINC_PLATING', label: '아연도금' },
        { answerId: 'ANODIZING', label: '아노다이징' },
      ],
    },
    {
      questionId: 'WHO_FIRST',
      text: '누가 먼저 연락했나요?',
      step: 'ALL',
      answers: [
        { answerId: 'OURS', label: '우리가', default: true },
        { answerId: 'THEIRS', label: '상대가' },
      ],
    },
  ],
};

/** 확정된 공정이 없고 세부 단계가 "연결됨"인 회사: 꼬리 질문에 공정 고르기가 바로 보인다. */
const unconfirmed: OpportunityDetail = {
  ...fixtureData,
  processLinks: [],
  reviewItems: [],
  records: {
    ...fixtureData.records,
    salesStep: {
      code: 'REACHED',
      since: '2026-11-10',
      overridden: false,
      known: [],
      openQuestions: ['CONFIRM_PROCESS'],
    },
  },
};

function reply(data: OpportunityDetail): Envelope<OpportunityDetail> {
  return { data, meta: { updatedAt: '2026-10-20T09:00:00+09:00' } };
}

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

describe('상세 화면 · 기록을 덜 오르내리게 (#691)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedOutcome.mockReset();
    vi.mocked(getActivity).mockResolvedValue({ data: [], meta: {} });
    vi.mocked(getPeers).mockRejectedValue(new Error('비슷한 회사는 이 시험에서 보지 않는다'));
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
  });

  it('머리의 [기록 남기기]를 누르면 기록 칸으로 내려가 첫 입력(종류)에 초점이 가고, 아무것도 저장하지 않는다', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockedGet.mockResolvedValue(reply(unconfirmed));
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const button = screen.getByTestId('detail-go-record-button');
    expect(button).toHaveTextContent('기록 남기기');
    // 읽는 곳(구분 줄 위) 머리에 있다.
    expect(screen.getByTestId('detail-header')).toContainElement(button);
    await user.click(button);
    const kind = screen.getByTestId('records-kind');
    expect(kind).toHaveFocus();
    expect(kind).toHaveValue('CALL');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(kind);
    expect(mockedOutcome).not.toHaveBeenCalled();
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('공정을 함께 확정해 상세 전체를 다시 받는 동안에도 화면을 비우지 않고, "저장됨"과 종류 "전화"가 그대로 남는다', async () => {
    const user = userEvent.setup();
    let finish: (value: Envelope<OpportunityDetail>) => void = () => {};
    const second = new Promise<Envelope<OpportunityDetail>>((resolve) => {
      finish = resolve;
    });
    // 처음 상세는 바로 받고, 저장 뒤의 요청(상세 전체 다시 받기 + 관심 값 다시 읽기)은 시험이 끝낼 때까지 기다린다.
    let loads = 0;
    mockedGet.mockImplementation(() => {
      loads += 1;
      return loads === 1 ? Promise.resolve(reply(unconfirmed)) : second;
    });
    mockedOutcome.mockResolvedValue({
      data: {
        version: 2,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-13T12:15:00Z',
        status: 'IN_PROGRESS',
      },
      meta: { reevaluated: true },
    });
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const area = screen.getByTestId('records-area');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await user.click(await screen.findByTestId('sales-choice-CONFIRM_PROCESS-ZINC_PLATING'));
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(mockedOutcome).toHaveBeenCalledTimes(1));
    expect(mockedOutcome.mock.calls[0][1]).toMatchObject({
      answers: [
        { questionId: 'WHO_FIRST', answerId: 'OURS' },
        { questionId: 'CONFIRM_PROCESS', answerId: 'ZINC_PLATING' },
      ],
    });
    expect(await screen.findByTestId('records-contact-saved')).toHaveTextContent('저장됨 21:15');

    // 다시 받는 중: 불러오는 중 화면으로 바뀌지 않고 같은 기록 칸이 그대로 있다(맨 위로 튀지 않는다).
    await waitFor(() => expect(loads).toBeGreaterThanOrEqual(3));
    expect(screen.getByTestId('opportunity-detail')).toBeInTheDocument();
    expect(screen.getByTestId('records-area')).toBe(area);
    expect(screen.getByTestId('records-contact-saved')).toHaveTextContent('저장됨 21:15');
    expect(screen.getByTestId('glance-fit-process')).toHaveTextContent('확인 전');

    // 다시 받은 뒤: 새 값(확정된 공정)이 "한눈에"에 보이고, 기록 칸은 같은 부품·같은 알림·같은 종류다.
    finish(
      reply({
        ...unconfirmed,
        processLinks: [
          { linkId: 'l-1', processCode: 'ZINC_PLATING', processName: '아연도금', result: 'PASS' },
        ] as OpportunityDetail['processLinks'],
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('glance-fit-process')).toHaveTextContent('아연도금'),
    );
    expect(screen.getByTestId('records-area')).toBe(area);
    expect(screen.getByTestId('records-contact-saved')).toHaveTextContent('저장됨 21:15');
    expect(screen.getByTestId('records-kind')).toHaveValue('CALL');
  });

  it('"한눈에 › 확인할 것"은 낱말이 없어도 아래 "2. 통화에서 확인할 것"에 줄이 있으면 그 수를 적는다', async () => {
    // 확인이 필요한 요구가 없어 낱말(공정·소재·근거 부족)은 없지만, 아래 목록에는 후속 조치·산업·질문 줄이 있다.
    mockedGet.mockResolvedValue(
      reply({
        ...fixtureData,
        requirements: fixtureData.requirements.filter((row) => row.result === 'PASS'),
      }),
    );
    renderPage();
    await screen.findByTestId('opportunity-detail');
    const lines = screen.getByTestId('call-list').children.length;
    expect(lines).toBeGreaterThan(0);
    expect(screen.getByTestId('glance-check-text')).toHaveTextContent(
      `통화에서 확인할 것 ${lines}가지 (아래 2번)`,
    );
    expect(screen.getByTestId('glance-check-text')).not.toHaveTextContent('지금 확인할 것 없음');
  });
});
