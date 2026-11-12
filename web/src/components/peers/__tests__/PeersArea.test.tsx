// 비슷한 회사 참고(#269): 회사 줄 순서·거절 이유·메모(없음·120자)·0곳 문구·요약 줄·회사명 이동·실패 뒤 다시 불러오기,
// 보기 전용도 보임, 영업 전략 영역용 "참고한 이력" 상자. 서버 호출(getPeers)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PeersArea from '../PeersArea';
import PeersReferenceBox from '../PeersReferenceBox';
import { peersSummaryText, truncateNote } from '../peersText';
import { ApiError, getPeers } from '../../../api/client';
import type {
  ConfigUi,
  Envelope,
  PeerCompany,
  PeersResponse,
  PeersSummary,
} from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { peersArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getPeers: vi.fn(),
}));

const mockedPeers = vi.mocked(getPeers);

const config = {
  staff: [{ key: 'park-lee', displayName: '박 이사' }],
  ingestOptions: {
    processes: [
      { code: 'ZINC_PLATING', name: '전기아연도금' },
      { code: 'ANODIZING', name: '아노다이징' },
    ],
    regions: [],
    industries: [],
  },
} as unknown as ConfigUi;

const summary: PeersSummary = {
  processCount: 4,
  industryCount: 2,
  stageCounts: { IN_PROGRESS: 1, LOST: 1 },
  topLostReasons: [{ code: 'PRICE', count: 1 }],
  contactReach: { CALL: { reached: 3, tried: 5 }, EMAIL: { reached: 0, tried: 0 } },
};

function company(overrides: Partial<PeerCompany> = {}): PeerCompany {
  return {
    oppId: 'opp-peer-1',
    name: '코파스',
    processCodes: ['ZINC_PLATING'],
    industries: ['자동차 부품'],
    outcomeStatus: 'IN_PROGRESS',
    lostReasonCode: null,
    lastContactAt: '2026-11-06T14:20:00+09:00',
    lastContactMethod: 'CALL',
    lastNote: {
      text: '납기 걱정, 샘플 먼저 요청',
      by: 'park-lee',
      at: '2026-11-06T15:00:00+09:00',
    },
    sameProcess: true,
    sameIndustry: true,
    ...overrides,
  };
}

function reply(data: PeersResponse): Envelope<PeersResponse> {
  return { data, meta: { updatedAt: '2026-11-12T09:00:00+09:00' } };
}

function frame(children: ReactNode, staffKey: string | null = 'park-lee') {
  return (
    <MemoryRouter initialEntries={['/opportunities/opp-1']}>
      <FrameContext.Provider
        value={{
          config,
          staffKey,
          setStaffKey: () => {},
          canRecord: staffKey !== null && staffKey !== 'viewer',
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <Routes>
          <Route path="/opportunities/opp-1" element={children} />
          {/* 다른 회사 상세로 이동하면 이 자리가 열린다. */}
          <Route path="/opportunities/:oppId" element={<p data-testid="moved">이동함</p>} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>
  );
}

describe('PeersArea', () => {
  beforeEach(() => {
    mockedPeers.mockReset();
  });

  it('요약 줄 하나와 회사 줄이 서버가 준 순서대로 보인다', async () => {
    mockedPeers.mockResolvedValueOnce(
      reply({
        summary,
        companies: [
          company(),
          company({
            oppId: 'opp-peer-2',
            name: '명화금속',
            outcomeStatus: 'LOST',
            lostReasonCode: 'PRICE',
          }),
          company({ oppId: 'opp-peer-3', name: '삼진정공' }),
        ],
      }),
    );
    render(frame(<PeersArea oppId="opp-1" />));
    const rows = await screen.findAllByTestId('peer-company');
    expect(rows.map((row) => within(row).getByTestId('peer-company-name').textContent)).toEqual([
      '코파스',
      '명화금속',
      '삼진정공',
    ]);
    expect(mockedPeers).toHaveBeenCalledWith('opp-1', expect.any(AbortSignal));
    expect(screen.getAllByTestId('peers-summary')).toHaveLength(1);
  });

  it('한 줄에 공정 이름·산업군·단계·마지막 접촉·메모와 담당자 이름이 보인다', async () => {
    mockedPeers.mockResolvedValueOnce(reply({ summary, companies: [company()] }));
    render(frame(<PeersArea oppId="opp-1" />));
    const row = await screen.findByTestId('peer-company');
    expect(within(row).getByTestId('peer-processes')).toHaveTextContent('전기아연도금');
    expect(within(row).getByTestId('peer-industries')).toHaveTextContent('자동차 부품');
    expect(within(row).getByTestId('peer-stage')).toHaveTextContent('접촉');
    expect(within(row).getByTestId('peer-last-contact')).toHaveTextContent('11/06 전화');
    expect(within(row).getByTestId('peer-note')).toHaveTextContent(
      '메모: 납기 걱정, 샘플 먼저 요청 — 박 이사',
    );
    expect(within(row).getByTestId('peer-same-process')).toHaveTextContent('같은 공정');
    expect(within(row).getByTestId('peer-same-industry')).toHaveTextContent('같은 산업군');
  });

  it('설정에 없는 공정 코드는 코드 그대로 보인다', async () => {
    mockedPeers.mockResolvedValueOnce(
      reply({ summary, companies: [company({ processCodes: ['UNKNOWN_CODE'] })] }),
    );
    render(frame(<PeersArea oppId="opp-1" />));
    expect(await screen.findByTestId('peer-processes')).toHaveTextContent('UNKNOWN_CODE');
  });

  it('거절이면 "거절 · 가격"으로 이유까지 보이고, 단계 기록이 없으면 "영업 기록 없음"이다', async () => {
    mockedPeers.mockResolvedValueOnce(
      reply({
        summary,
        companies: [
          company({ outcomeStatus: 'LOST', lostReasonCode: 'PRICE' }),
          company({
            oppId: 'opp-peer-2',
            outcomeStatus: null,
            lostReasonCode: null,
            lastContactAt: null,
            lastContactMethod: null,
          }),
        ],
      }),
    );
    render(frame(<PeersArea oppId="opp-1" />));
    const rows = await screen.findAllByTestId('peer-company');
    expect(within(rows[0]).getByTestId('peer-stage')).toHaveTextContent('거절 · 가격');
    expect(within(rows[1]).getByTestId('peer-stage')).toHaveTextContent(peersArea.noStage);
    expect(within(rows[1]).getByTestId('peer-last-contact')).toHaveTextContent(peersArea.noContact);
  });

  it('메모가 없으면 메모 칸을 보이지 않고, 120자를 넘으면 120자에서 자르고 "…"를 붙인다', async () => {
    const long = '가'.repeat(150);
    mockedPeers.mockResolvedValueOnce(
      reply({
        summary,
        companies: [
          company({ lastNote: null }),
          company({
            oppId: 'opp-peer-2',
            lastNote: { text: long, by: 'park-lee', at: '2026-11-06T15:00:00+09:00' },
          }),
        ],
      }),
    );
    render(frame(<PeersArea oppId="opp-1" />));
    const rows = await screen.findAllByTestId('peer-company');
    expect(within(rows[0]).queryByTestId('peer-note')).not.toBeInTheDocument();
    const note = within(rows[1]).getByTestId('peer-note').textContent ?? '';
    expect(note).toContain(`${'가'.repeat(120)}…`);
    expect(note).not.toContain('가'.repeat(121));
  });

  it('비슷한 회사가 0곳이면 안내 문구만 보이고 요약 줄은 없다', async () => {
    mockedPeers.mockResolvedValueOnce(
      reply({
        summary: {
          processCount: 0,
          industryCount: 0,
          stageCounts: {},
          topLostReasons: [],
          contactReach: {},
        },
        companies: [],
      }),
    );
    render(frame(<PeersArea oppId="opp-1" />));
    expect(await screen.findByTestId('peers-empty')).toHaveTextContent(peersArea.empty);
    expect(screen.queryByTestId('peers-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('peer-company')).not.toBeInTheDocument();
  });

  it('요약 줄: 같은 공정·산업군 곳 수 | 단계별 건수(거절 이유) | 방법별 연결', async () => {
    mockedPeers.mockResolvedValueOnce(reply({ summary, companies: [company()] }));
    render(frame(<PeersArea oppId="opp-1" />));
    expect(await screen.findByTestId('peers-summary')).toHaveTextContent(
      '같은 공정 4곳 · 산업군 2곳 | 접촉 1 · 거절 1(가격) | 전화 연결 3/5',
    );
  });

  it('회사 이름을 누르면 그 회사 상세로 이동한다', async () => {
    mockedPeers.mockResolvedValueOnce(
      reply({ summary, companies: [company({ oppId: 'opp-peer-9', name: '코파스' })] }),
    );
    render(frame(<PeersArea oppId="opp-1" />));
    const link = await screen.findByRole('link', { name: peersArea.openCompanyLabel('코파스') });
    expect(link).toHaveAttribute('href', '/opportunities/opp-peer-9');
    fireEvent.click(link);
    expect(await screen.findByTestId('moved')).toBeInTheDocument();
    expect(screen.queryByTestId('peers-area')).not.toBeInTheDocument();
  });

  it('"내부 참고 · 밖으로 안 나감"이 항상 보인다', async () => {
    mockedPeers.mockResolvedValueOnce(reply({ summary, companies: [] }));
    render(frame(<PeersArea oppId="opp-1" />));
    expect(await screen.findByTestId('peers-internal-note')).toHaveTextContent(
      peersArea.internalNote,
    );
  });

  it('담당자를 고르지 않았거나 보기 전용이어도 비슷한 회사를 볼 수 있다(읽기)', async () => {
    mockedPeers.mockResolvedValue(reply({ summary, companies: [company()] }));
    const { unmount } = render(frame(<PeersArea oppId="opp-1" />, null));
    expect(await screen.findByTestId('peer-company')).toBeInTheDocument();
    unmount();
    render(frame(<PeersArea oppId="opp-1" />, 'viewer'));
    expect(await screen.findByTestId('peer-company')).toBeInTheDocument();
  });

  it('불러오지 못하면 쉬운 말 오류와 [다시 불러오기]가 보이고 누르면 다시 불러온다', async () => {
    mockedPeers.mockRejectedValueOnce(
      new ApiError(500, { message: '서버 오류', nextAction: '잠시 뒤', ref: 'r-1' }),
    );
    mockedPeers.mockResolvedValueOnce(reply({ summary, companies: [company()] }));
    render(frame(<PeersArea oppId="opp-1" />));
    const alert = await screen.findByTestId('peers-error');
    expect(alert).toHaveTextContent(peersArea.loadFailed);
    expect(alert).not.toHaveTextContent('500');
    fireEvent.click(screen.getByRole('button', { name: peersArea.retry }));
    expect(await screen.findByTestId('peer-company')).toBeInTheDocument();
    expect(screen.queryByTestId('peers-error')).not.toBeInTheDocument();
  });
});

describe('PeersReferenceBox (영업 전략 영역용)', () => {
  const peers: PeersResponse = {
    summary,
    companies: [
      company(),
      company({ oppId: 'opp-peer-2', name: '명화금속' }),
      company({ oppId: 'opp-peer-3', name: '삼진정공' }),
    ],
  };

  it('"참고한 이력" 제목과 "내부 참고 · 밖으로 안 나감" 표시, 요약 줄, 비슷한 회사 2곳만 보인다', () => {
    render(frame(<PeersReferenceBox peers={peers} />));
    const box = screen.getByTestId('peers-reference-box');
    expect(within(box).getByText(peersArea.referenceTitle)).toBeInTheDocument();
    expect(within(box).getByTestId('peers-reference-internal-note')).toHaveTextContent(
      peersArea.internalNote,
    );
    expect(within(box).getByTestId('peers-reference-summary')).toHaveTextContent(
      '같은 공정 4곳 · 산업군 2곳 | 접촉 1 · 거절 1(가격) | 전화 연결 3/5',
    );
    const names = within(box)
      .getAllByTestId('peer-company-name')
      .map((el) => el.textContent);
    expect(names).toEqual(['코파스', '명화금속']);
  });

  it('비슷한 회사가 없으면 안내 문구를 보인다', () => {
    render(
      frame(
        <PeersReferenceBox
          peers={{
            summary: { ...summary, processCount: 0, industryCount: 0, stageCounts: {} },
            companies: [],
          }}
        />,
      ),
    );
    expect(screen.getByTestId('peers-reference-empty')).toHaveTextContent(peersArea.empty);
  });
});

describe('peersText', () => {
  it('0건 묶음은 요약 줄에서 빼고, 거절 이유가 여럿이면 많은 순으로 붙인다', () => {
    expect(
      peersSummaryText({
        processCount: 3,
        industryCount: 0,
        stageCounts: { LOST: 3, WON: 0, IN_PROGRESS: 0 },
        topLostReasons: [
          { code: 'PRICE', count: 2 },
          { code: 'LEAD_TIME', count: 1 },
        ],
        contactReach: { VISIT: { reached: 1, tried: 2 } },
      }),
    ).toBe('같은 공정 3곳 · 산업군 0곳 | 거절 3(가격 2 · 납기 1) | 방문 연결 1/2');
  });

  it('거절 이유가 하나뿐이어도 그 건수가 거절 전체와 다르면 건수를 붙인다', () => {
    expect(
      peersSummaryText({
        processCount: 1,
        industryCount: 1,
        stageCounts: { LOST: 3 },
        topLostReasons: [{ code: 'PRICE', count: 2 }],
        contactReach: {},
      }),
    ).toBe('같은 공정 1곳 · 산업군 1곳 | 거절 3(가격 2)');
  });

  it('보일 것이 하나도 없으면 빈 글이다. 모르는 단계 코드는 코드 그대로 맨 뒤에 붙는다', () => {
    expect(
      peersSummaryText({
        processCount: 0,
        industryCount: 0,
        stageCounts: {},
        topLostReasons: [],
        contactReach: {},
      }),
    ).toBe('');
    expect(
      peersSummaryText({
        processCount: 1,
        industryCount: 0,
        stageCounts: { FUTURE_STAGE: 2, IN_PROGRESS: 1 },
        topLostReasons: [],
        contactReach: {},
      }),
    ).toBe('같은 공정 1곳 · 산업군 0곳 | 접촉 1 · FUTURE_STAGE 2');
  });

  it('메모 자르기: 120자 이하는 그대로, 넘으면 120자 + "…"', () => {
    expect(truncateNote('가'.repeat(120))).toBe('가'.repeat(120));
    expect(truncateNote('가'.repeat(121))).toBe(`${'가'.repeat(120)}…`);
  });
});
