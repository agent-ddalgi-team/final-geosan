// 영업 홈 "먼저 볼 후보"(#972): 거래처 후보 목록 응답(추천 순 1쪽)의 맨 위 3곳을 카드로 보이고, 못 읽으면 이 칸만 숨는다.
// getOpportunities는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 회사는 모두 가상이다.
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopCandidates, { TOP_COUNT, splitTitle, topTag } from '../TopCandidates';
import { ApiError, getOpportunities } from '../../../api/client';
import type { OpportunityCard } from '../../../api/types';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getOpportunities: vi.fn(),
}));
const mockedList = vi.mocked(getOpportunities);

function card(extra: Partial<OpportunityCard> & { oppId: string; title: string }): OpportunityCard {
  return {
    rank: 1,
    reason: '',
    isVirtual: true,
    ...extra,
  } as OpportunityCard;
}

const PROCESS_COUNTS = [
  { processCode: 'ZINC_PLATING', processName: '아연도금', count: 2 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 1 },
];

function reply(items: OpportunityCard[]) {
  return {
    data: items,
    meta: { hasVirtualData: true, processCounts: PROCESS_COUNTS },
  } as unknown as Awaited<ReturnType<typeof getOpportunities>>;
}

function renderBox() {
  return render(
    <MemoryRouter>
      <TopCandidates />
    </MemoryRouter>,
  );
}

async function settled() {
  await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(1));
  await Promise.resolve();
}

beforeEach(() => {
  mockedList.mockReset();
});

it('목록 화면의 기본 조건(추천 순 · 관심 기업 빼기) 1쪽을 한 번만 부르고, 맨 위 3곳을 01·02·03 카드로 보인다', async () => {
  mockedList.mockResolvedValueOnce(
    reply([
      card({
        oppId: 'opp-a/1',
        title: 'AF기공(가상) · 철제 선반 부품',
        reason: '철제 선반 부품 아연도금 외주. 자료를 받아 보겠다고 했다',
        confirmedProcessCodes: ['ZINC_PLATING'],
        supplyTier: 'TIER2_3',
        distanceKm: 14,
      }),
      card({
        oppId: 'opp-b',
        title: 'V기공(가상) · 컨베이어 체결 부품',
        reason: '컨베이어 체결 부품 물량이 늘었다',
        // 확정되지 않은(AI 제안) 공정은 적지 않는다.
        processCodes: ['ANODIZING'],
        confirmedProcessCodes: [],
        distanceKm: 14,
      }),
      card({
        oppId: 'opp-c',
        title: 'AD산업(가상) · 로봇 암 커버',
        reason: '로봇 암 커버 아노다이징 외주 검토',
        confirmedProcessCodes: ['ANODIZING'],
        ingestedAt: '2026-11-24T10:00:00+09:00',
      }),
      // 서버가 더 많이 줘도 3곳까지만 보인다.
      card({ oppId: 'opp-d', title: '넷째(가상) · 부품' }),
    ]),
  );
  renderBox();
  const box = await screen.findByTestId('dashboard-top');
  expect(within(box).getByRole('heading', { level: 2 })).toHaveTextContent('먼저 볼 후보');
  expect(box).toHaveTextContent('거래처 후보 추천 순 맨 위 3곳');

  const cards = within(box).getAllByTestId('dashboard-top-card');
  expect(cards).toHaveLength(TOP_COUNT);
  expect(cards.map((el) => within(el).getByTestId('dashboard-top-number').textContent)).toEqual([
    '01',
    '02',
    '03',
  ]);
  // 회사 이름은 상세로 가는 링크(주소에 쓸 수 없는 글자는 바꿔 넣는다).
  const name = within(cards[0]).getByTestId('dashboard-top-name');
  expect(name).toHaveTextContent('AF기공(가상)');
  expect(name).toHaveAttribute('href', '/opportunities/opp-a%2F1');
  // 품목 · 확정된 공정, 추천 근거 한 줄, 꼬리표는 1개만(공급망 위치가 거리보다 먼저).
  expect(within(cards[0]).getByTestId('dashboard-top-sub')).toHaveTextContent(
    '철제 선반 부품 · 아연도금',
  );
  expect(within(cards[0]).getByTestId('dashboard-top-reason')).toHaveTextContent(
    '철제 선반 부품 아연도금 외주. 자료를 받아 보겠다고 했다',
  );
  expect(within(cards[0]).getAllByTestId('dashboard-top-tag')).toHaveLength(1);
  expect(within(cards[0]).getByTestId('dashboard-top-tag')).toHaveTextContent(
    '2·3차 가공 · AI 추정',
  );
  expect(within(cards[1]).getByTestId('dashboard-top-sub')).toHaveTextContent(
    /^컨베이어 체결 부품$/,
  );
  expect(within(cards[1]).getByTestId('dashboard-top-tag')).toHaveTextContent('거산에서 14km');
  expect(within(cards[2]).getByTestId('dashboard-top-tag')).toHaveTextContent('11/24 들어옴');
  // 가상 회사는 꼬리표와 별도로 "가상 사례" 표시가 붙는다.
  expect(within(cards[0]).getByTestId('dashboard-top-virtual')).toHaveTextContent('가상 사례');

  expect(within(box).getByTestId('dashboard-top-link')).toHaveAttribute('href', '/opportunities');
  expect(within(box).getByTestId('dashboard-top-link')).toHaveTextContent('후보 모두 보기');

  expect(mockedList).toHaveBeenCalledTimes(1);
  const [page, pageSize, , filters] = mockedList.mock.calls[0];
  expect(page).toBe(1);
  expect(pageSize).toBe(TOP_COUNT);
  expect(filters).toEqual({ sort: 'contact', hideBookmarked: 'true' });
});

it('후보가 3곳보다 적으면 있는 만큼만 보이고 곳 수도 그 수로 적는다', async () => {
  mockedList.mockResolvedValueOnce(
    reply([card({ oppId: 'opp-a', title: '하나(가상) · 부품', isVirtual: false })]),
  );
  renderBox();
  const box = await screen.findByTestId('dashboard-top');
  expect(within(box).getAllByTestId('dashboard-top-card')).toHaveLength(1);
  expect(box).toHaveTextContent('거래처 후보 추천 순 맨 위 1곳');
  // 근거 문장·꼬리표·가상 표시가 없으면 빈 칸을 그리지 않는다.
  expect(within(box).queryByTestId('dashboard-top-reason')).not.toBeInTheDocument();
  expect(within(box).queryByTestId('dashboard-top-tag')).not.toBeInTheDocument();
  expect(within(box).queryByTestId('dashboard-top-virtual')).not.toBeInTheDocument();
});

it('목록을 못 읽으면 오류를 띄우지 않고 이 칸만 그리지 않는다', async () => {
  mockedList.mockRejectedValueOnce(
    new ApiError(500, { message: '문제', nextAction: '다시', ref: 'r-1', kind: 'INTERNAL_ERROR' }),
  );
  const { container } = renderBox();
  await settled();
  expect(screen.queryByTestId('dashboard-top')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(container).toBeEmptyDOMElement();
});

it('후보가 0곳이면 빈 카드 대신 이 칸을 그리지 않는다', async () => {
  mockedList.mockResolvedValueOnce(reply([]));
  const { container } = renderBox();
  await settled();
  expect(container).toBeEmptyDOMElement();
});

it('splitTitle: "회사 · 품목"을 첫 구분에서 나누고, 구분이 없으면 전체가 회사 이름', () => {
  expect(splitTitle('A정밀 · 밸브 바디 아노다이징')).toEqual({
    company: 'A정밀',
    item: '밸브 바디 아노다이징',
  });
  expect(splitTitle('가상기공 · 볼트 · 너트')).toEqual({
    company: '가상기공',
    item: '볼트 · 너트',
  });
  expect(splitTitle('가상기공')).toEqual({ company: '가상기공', item: null });
});

it('topTag: 공급망 위치 → 거리 → 들어온 날 → 적합도 순으로 하나만 고르고, 모름·없음이면 건너뛴다', () => {
  const base = { oppId: 'o', title: 't' };
  expect(topTag(card({ ...base, supplyTier: 'TIER1', distanceKm: 3 }))).toBe(
    '1차 완성품·조립 · AI 추정',
  );
  expect(topTag(card({ ...base, supplyTier: 'UNKNOWN', distanceKm: 3 }))).toBe('거산에서 3km');
  expect(topTag(card({ ...base, distanceKm: null, ingestedAt: '2026-11-09T09:00:00+09:00' }))).toBe(
    '11/9 들어옴',
  );
  expect(topTag(card({ ...base, fitLevel: 'HIGH' }))).toBe('적합도 상');
  expect(topTag(card(base))).toBeNull();
});
