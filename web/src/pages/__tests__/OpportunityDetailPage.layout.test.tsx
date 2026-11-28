// #996(PM 결정 2026-11-29) 기업 상세 새 구성: 머리 → 요약 줄 → 담당자 의견 → [영업 단계 | 담당자 연락처]
// → [한눈에 + 왜 이 회사인가(한 블록) | 기록] → 비슷한 회사 → 점수 자세히 보기. 오른쪽 영업 코치 칸은 그대로.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 실제 화면 폭 · 칸 좌표는 이 시험 환경(jsdom)에 없어서
// 문서 순서(좁으면 그 순서대로 쌓인다)와 두 줄이 같은 격자 값을 쓰는지로 확인한다. 회사 · 값은 가상이다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpportunityDetailPage from '../OpportunityDetailPage';
import {
  ApiError,
  getActivity,
  getContacts,
  getMonthSpend,
  getOpportunityDetail,
  getPeers,
  getSalesQuestions,
  postOpinion,
} from '../../api/client';
import type { Envelope, OpportunityDetail, OpinionRecord } from '../../api/types';
import { detailMainCell, detailRowStyle, detailSideCell } from '../../components/detail/detailGrid';
import { FrameContext } from '../../components/frame/FrameContext';
import type { FrameValue } from '../../components/frame/FrameContext';
import { detailCompose, frame as frameTexts, recordsArea } from '../../labels/ko';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';
import { opinionNudge } from '../../theme/tokens';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  getActivity: vi.fn(),
  getPeers: vi.fn(),
  getSalesQuestions: vi.fn(),
  getContacts: vi.fn(),
  getMonthSpend: vi.fn(),
  postOpinion: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunityDetail);
const fixtureData = detailFixture.data as unknown as OpportunityDetail;
const META = { updatedAt: '2026-11-29T09:00:00+09:00' };

function reply(patch: Partial<OpportunityDetail> = {}): Envelope<OpportunityDetail> {
  return { data: { ...fixtureData, ...patch }, meta: META };
}

function opinion(value: OpinionRecord['opinion'], version = 1): OpinionRecord {
  return {
    version,
    updatedBy: 'staff-a',
    updatedAt: '2026-11-29T10:00:00+09:00',
    opinion: value,
  } as OpinionRecord;
}

/** 넓은 화면: 오른쪽 영업 코치 칸(dockSlot)이 있다. 좁은 기기: 그 칸이 본문 아래에 놓인다(narrowDevice). */
function renderPage(options: { dock?: boolean; narrowDevice?: boolean; canRecord?: boolean } = {}) {
  const { dock = false, narrowDevice = false, canRecord = true } = options;
  const slot = dock ? document.createElement('div') : null;
  if (slot) {
    slot.setAttribute('data-testid', 'coach-dock-slot');
    document.body.appendChild(slot);
  }
  const value: FrameValue = {
    config: {
      staff: [{ key: 'staff-a', displayName: '영업 담당' }],
    } as unknown as FrameValue['config'],
    staffKey: canRecord ? 'staff-a' : 'viewer',
    setStaffKey: () => {},
    canRecord,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    dockSlot: slot,
    narrowDevice,
  };
  render(
    <MemoryRouter initialEntries={['/opportunities/opp-1']}>
      <FrameContext.Provider value={value}>
        <Routes>
          <Route path="/opportunities/:oppId" element={<OpportunityDetailPage />} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
  return slot;
}

/** a가 b보다 문서에서 앞에 있는가(좁은 화면에서는 이 순서대로 위에서 아래로 쌓인다). */
function before(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  mockedGet.mockReset();
  vi.mocked(postOpinion).mockReset();
  vi.mocked(getActivity).mockResolvedValue({
    data: [
      { at: '2026-11-25T14:00:00+09:00', actor: 'staff-a', kind: 'NOTE', summary: '소개서 보냄' },
    ],
    meta: META,
  });
  vi.mocked(getPeers).mockRejectedValue(new Error('비슷한 회사는 이 시험에서 보지 않는다'));
  vi.mocked(getSalesQuestions).mockRejectedValue(new Error('질문 파일은 이 시험에서 쓰지 않는다'));
  vi.mocked(getContacts).mockResolvedValue({ data: { contacts: [] }, meta: META });
  vi.mocked(getMonthSpend).mockResolvedValue({
    data: { month: { usedUsd: 44.87, limitUsd: 50, usedCalls: 10, limitCalls: 3000 } },
    meta: META,
  });
});

afterEach(() => {
  document.querySelectorAll('[data-testid="coach-dock-slot"]').forEach((node) => node.remove());
});

describe('기업 상세 새 구성 — 넓은 화면 (#996)', () => {
  it('Given 영업 코치 칸이 옆에 있는 화면 When 상세를 열면 Then 머리에 [기록 남기기 ↓]가 없고 기록 남기기는 영업 코치 칸에 있다', async () => {
    mockedGet.mockResolvedValue(reply());
    const slot = renderPage({ dock: true }) as HTMLElement;
    await screen.findByTestId('opportunity-detail');
    expect(screen.queryByTestId('detail-go-record-button')).not.toBeInTheDocument();
    // 기록 남기기(확인사항 · 기록 칸)는 오른쪽 영업 코치 칸 안에 그려진다.
    const dock = within(slot).getByTestId('records-dock-content');
    expect(within(dock).getByTestId('records-area')).toBeInTheDocument();
    expect(within(dock).getByTestId('coach-next-schedule')).toBeInTheDocument();
    // 본문의 기록 칸에는 활동 이력만 있다.
    const records = screen.getByTestId('detail-records');
    expect(within(records).queryByTestId('records-area')).not.toBeInTheDocument();
    expect(within(records).getByTestId('activity-timeline')).toBeInTheDocument();
    // 머리의 다른 단추는 그대로다.
    const actions = screen.getByTestId('detail-actions');
    expect(within(actions).getByTestId('bookmark-button')).toBeInTheDocument();
    expect(within(actions).getByTestId('homepage-rerun-button')).toBeInTheDocument();
    expect(within(actions).getByTestId('detail-report-link')).toBeInTheDocument();
  });

  it('Given 넓은 화면 When 상세를 열면 Then 맨 위 줄 오른쪽 끝에 "이번 달 AI 사용 $44.87 / $50.00"이 한 번만 보인다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true });
    const top = await screen.findByTestId('detail-top-line');
    expect(await within(top).findByTestId('month-spend')).toHaveTextContent(
      '이번 달 AI 사용 $44.87 / $50.00',
    );
    expect(screen.getAllByTestId('month-spend')).toHaveLength(1);
  });

  it('Given 넓은 화면 When 영업 단계 칸 Then 그림 아래에 "들은 답 · 단계 고치기" 자리가 있고 [일정만 바꾸기]는 영업 코치의 "다음 일정 [바꾸기]"만 남는다', async () => {
    mockedGet.mockResolvedValue(
      reply({
        records: {
          ...fixtureData.records,
          outcome: {
            version: 2,
            updatedBy: 'staff-a',
            updatedAt: '2026-11-25T09:00:00+09:00',
            status: 'IN_PROGRESS',
            nextScheduleAt: '2026-12-05',
            nextScheduleNote: '견적 문의 의향 확인',
          },
        },
      }),
    );
    const slot = renderPage({ dock: true }) as HTMLElement;
    const card = await screen.findByTestId('detail-stage-card');
    const side = await within(card).findByTestId('records-side');
    expect(within(side).getByTestId('records-stage-toggle')).toHaveTextContent(
      recordsArea.stageFixOpen,
    );
    expect(within(card).getByTestId('sales-progress-next')).toHaveTextContent(
      '다음 일정: 12/5 견적 문의 의향 확인',
    );
    expect(screen.queryByTestId('records-schedule-toggle')).not.toBeInTheDocument();
    expect(within(slot).getByTestId('coach-next-schedule-open')).toBeEnabled();
  });
});

describe('기업 상세 새 구성 — 좁은 기기 (#996)', () => {
  it('Given 기록 칸이 본문 아래로 가는 좁은 기기 When 상세를 열면 Then 머리에 [기록 남기기 ↓]가 남는다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true, narrowDevice: true });
    await screen.findByTestId('opportunity-detail');
    expect(screen.getByTestId('detail-go-record-button')).toHaveTextContent(recordsArea.goRecord);
    expect(
      within(screen.getByTestId('detail-actions')).getByTestId('bookmark-button'),
    ).toBeTruthy();
  });

  it('Given 좁은 화면 When 한 줄로 쌓이면 Then 머리 → 요약 줄 → 담당자 의견 → 영업 단계 → 담당자 연락처 → 한눈에 → 왜 이 회사인가 → 기록 → 비슷한 회사 → 점수 순서다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true, narrowDevice: true });
    await screen.findByTestId('opportunity-detail');
    const order = [
      'detail-top-line',
      'detail-name-line',
      'detail-summary-row',
      'detail-opinion',
      'detail-stage-card',
      'detail-contacts-card',
      'detail-glance',
      'detail-reasons',
      'detail-records',
      'detail-peers',
      'detail-scores',
    ].map((id) => screen.getByTestId(id));
    for (let index = 0; index + 1 < order.length; index += 1) {
      expect(before(order[index], order[index + 1])).toBe(true);
    }
    // 좁으면 줄이 바뀌어 쌓이게 두 줄 모두 줄바꿈을 허용한다.
    expect(screen.getByTestId('detail-row-stage')).toHaveStyle({ flexWrap: 'wrap' });
    expect(screen.getByTestId('detail-row-main')).toHaveStyle({ flexWrap: 'wrap' });
  });
});

describe('기업 상세 새 구성 — 둘째 · 셋째 줄 (#996)', () => {
  it('Given 상세 When 둘째 줄과 셋째 줄 Then 두 줄이 같은 격자 값(1.25 : 1)을 써서 칸 경계가 맞는다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true });
    await screen.findByTestId('opportunity-detail');
    const rows = ['detail-row-stage', 'detail-row-main'].map((id) => screen.getByTestId(id));
    const mains = ['detail-cell-stage', 'detail-cell-glance'].map((id) => screen.getByTestId(id));
    const sides = ['detail-cell-contacts', 'detail-cell-records'].map((id) =>
      screen.getByTestId(id),
    );
    // 두 줄의 줄 · 왼쪽 칸 · 오른쪽 칸 스타일이 글자 그대로 같다.
    expect(rows[0].getAttribute('style')).toBe(rows[1].getAttribute('style'));
    expect(mains[0].getAttribute('style')).toBe(mains[1].getAttribute('style'));
    expect(sides[0].getAttribute('style')).toBe(sides[1].getAttribute('style'));
    for (const row of rows) expect(row).toHaveStyle({ gap: `${detailRowStyle.gap}px` });
    for (const cell of mains) {
      expect(cell.style.flexGrow).toBe('1.25');
      expect(cell.style.flex).toBe(detailMainCell.flex);
    }
    for (const cell of sides) {
      expect(cell.style.flexGrow).toBe('1');
      expect(cell.style.flex).toBe(detailSideCell.flex);
    }
    // 칸 안: 영업 단계 | 담당자 연락처, 한눈에 + 왜 이 회사인가 | 기록.
    expect(mains[0]).toContainElement(screen.getByTestId('detail-stage-card'));
    expect(sides[0]).toContainElement(screen.getByTestId('detail-contacts-card'));
    expect(mains[1]).toContainElement(screen.getByTestId('detail-glance-why'));
    expect(sides[1]).toContainElement(screen.getByTestId('detail-records'));
    expect(rows[0]).toContainElement(mains[0]);
    expect(rows[0]).toContainElement(sides[0]);
    expect(rows[1]).toContainElement(mains[1]);
    expect(rows[1]).toContainElement(sides[1]);
  });

  it('Given 상세 When 한 블록 Then 카드 하나 안에 큰 제목 "한눈에" → 구분 띠 → "왜 이 회사인가" 순서로 있다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true });
    const block = await screen.findByTestId('detail-glance-why');
    const titles = within(block).getAllByRole('heading', { level: 2 });
    expect(titles.map((title) => title.textContent)).toEqual(['한눈에', '왜 이 회사인가']);
    // 두 제목 모두 왼쪽 세로 강조 막대가 붙은 큰 제목이다.
    expect(within(block).getAllByTestId('block-heading-bar')).toHaveLength(2);
    const band = within(block).getByTestId('detail-block-band');
    expect(before(titles[0], band)).toBe(true);
    expect(before(band, titles[1])).toBe(true);
    // 한눈에 · 왜 이 회사인가는 따로 카드를 그리지 않는다(블록이 카드다).
    expect(within(block).getByTestId('detail-glance')).not.toHaveStyle({ borderRadius: '12px' });
    expect(block).toHaveStyle({ borderRadius: '12px' });
  });

  it('Given 상세 When 기록 칸 Then 활동 이력이 "왜 이 회사인가" 옆 칸에 있고 거르기 단추와 접촉 횟수가 그대로 보인다', async () => {
    mockedGet.mockResolvedValue(
      reply({
        records: {
          ...fixtureData.records,
          contactCount: { total: 3, call: 2, email: 1, visit: 0 },
          lastContactAt: '2026-11-25',
        },
      }),
    );
    renderPage({ dock: true });
    await screen.findByTestId('opportunity-detail');
    const cell = screen.getByTestId('detail-cell-records');
    const records = within(cell).getByTestId('detail-records');
    expect(within(records).getByRole('heading', { level: 2 })).toHaveTextContent(/^기록$/);
    const timeline = within(records).getByTestId('activity-timeline');
    expect(await within(timeline).findByTestId('timeline-group-filter')).toBeInTheDocument();
    expect(within(timeline).getByTestId('timeline-group-ALL')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await within(timeline).findByText('소개서 보냄')).toBeInTheDocument();
    expect(within(records).getByTestId('detail-contact-count')).toHaveTextContent(
      '접촉 3회 (전화 2 · 메일 1) · 마지막 접촉 11/25',
    );
    // 같은 줄(셋째 줄) 안에서 한눈에 + 왜 이 회사인가 블록 다음 칸이다.
    expect(screen.getByTestId('detail-row-main')).toContainElement(cell);
    expect(before(screen.getByTestId('detail-cell-glance'), cell)).toBe(true);
  });

  it('Given 상세 When 담당자 연락처 칸 Then 영업 단계 옆 칸에 회사 대표번호 · 대표명 · 상대 담당자가 있다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true });
    await screen.findByTestId('opportunity-detail');
    const card = within(screen.getByTestId('detail-cell-contacts')).getByTestId(
      'detail-contacts-card',
    );
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent(/^담당자 연락처$/);
    expect(within(card).getByTestId('company-phone-link')).toHaveTextContent('041-000-0000');
    expect(within(card).getByTestId('company-representative')).toHaveTextContent('대표명');
    expect(await within(card).findByTestId('contacts-empty')).toBeInTheDocument();
    expect(within(card).getByTestId('contact-add-button')).toBeEnabled();
    // 전에 있던 자리("한눈에")에는 없다.
    expect(
      within(screen.getByTestId('detail-glance')).queryByTestId('company-phone'),
    ).not.toBeInTheDocument();
  });
});

describe('기업 상세 새 구성 — 담당자 의견 (#996)', () => {
  it('Given 의견을 아직 안 고른 회사 When 상세를 열면 Then 요약 줄 아래에 주황 "담당자 의견" 칸과 "아직 안 골랐습니다 · 골라 주세요"가 보인다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true });
    const area = await screen.findByTestId('detail-opinion');
    const box = within(area).getByRole('group', { name: detailCompose.opinion.title });
    expect(box).toHaveStyle({ background: opinionNudge.bg });
    expect(within(box).getByTestId('opinion-nudge')).toHaveTextContent(detailCompose.opinion.nudge);
    expect(before(screen.getByTestId('detail-summary-row'), area)).toBe(true);
    expect(screen.getByTestId('detail-header')).toContainElement(area);
  });

  it('Given 안 고른 회사 When [검토 중]을 누르면 Then 저장하고 고른 단추 · 고른 사람 · 날짜가 보이며 주황 알림이 사라진다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply());
    vi.mocked(postOpinion).mockResolvedValueOnce({ data: opinion('NEED_CHECK'), meta: META });
    renderPage({ dock: true });
    const area = await screen.findByTestId('detail-opinion');
    await user.click(within(area).getByTestId('opinion-need-check-button'));
    await waitFor(() => expect(postOpinion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOpinion).mock.calls[0][1]).toMatchObject({
      opinion: 'NEED_CHECK',
      evalId: fixtureData.evalId,
    });
    await waitFor(() =>
      expect(within(area).getByTestId('opinion-need-check-button')).toHaveTextContent('✓ 검토 중'),
    );
    expect(within(area).getByTestId('opinion-picked-by')).toHaveTextContent('영업 담당 · 11/29');
    expect(within(area).queryByTestId('opinion-nudge')).not.toBeInTheDocument();
  });

  it('Given 서버에 저장된 의견 "영업 대상" When 상세를 열면 Then 그 단추만 고른 모양이다', async () => {
    mockedGet.mockResolvedValue(
      reply({ records: { ...fixtureData.records, opinion: opinion('WORTH_REVIEW', 3) } }),
    );
    renderPage({ dock: true });
    const area = await screen.findByTestId('detail-opinion');
    expect(within(area).getByTestId('opinion-worth-review-button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(area).getByTestId('opinion-box')).not.toHaveAttribute('data-nudge');
  });

  it('Given 보기 전용 When 상세를 열면 Then 의견 단추가 잠기고 주황 알림 없이 안내가 보인다', async () => {
    mockedGet.mockResolvedValue(reply());
    renderPage({ dock: true, canRecord: false });
    const area = await screen.findByTestId('detail-opinion');
    for (const button of within(within(area).getByTestId('opinion-box')).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    expect(within(area).queryByTestId('opinion-nudge')).not.toBeInTheDocument();
    expect(within(area).getByTestId('opinion-pick-staff-text')).toBeInTheDocument();
  });
});

describe('기업 상세 새 구성 — 이름을 모를 때의 제목 (#996)', () => {
  it('Given 불러오는 중 When 화면 Then 제목(h1)은 "기업 검토 상세"이고, 다 불러오면 회사 이름 하나로 바뀐다', async () => {
    let resolve: (value: Envelope<OpportunityDetail>) => void = () => {};
    mockedGet.mockReturnValue(
      new Promise<Envelope<OpportunityDetail>>((done) => {
        resolve = done;
      }),
    );
    renderPage({ dock: true });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(frameTexts.pageTitleDetail);
    resolve(reply());
    await screen.findByTestId('opportunity-detail');
    const titles = screen.getAllByRole('heading', { level: 1 });
    expect(titles).toHaveLength(1);
    expect(titles[0]).toHaveTextContent(/^A정밀$/);
  });

  it('Given 없는 회사(404) When 화면 Then 제목(h1) "기업 검토 상세" 아래에 못 찾았다는 안내가 보인다', async () => {
    mockedGet.mockRejectedValue(
      new ApiError(404, { message: '없음', nextAction: '목록으로', ref: 'r' }),
    );
    renderPage({ dock: true });
    expect(await screen.findByTestId('not-found-back-button')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(frameTexts.pageTitleDetail);
  });
});
