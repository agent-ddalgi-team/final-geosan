// 공정별 묶음 보기에서 한 공정이 50곳까지만 실릴 때(#719): 묶음 제목의 곳 수는 그 공정 전체 숫자라서,
// 실린 카드가 그보다 적으면 "몇 곳만 보임"과 안 보인 묶음·곳 수를 알려 준다.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 가상 이름만 쓴다.
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type { ContactBucket, Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

const TABS = [
  { processCode: 'ZINC_PLATING', processName: '아연도금(전기아연도금)', count: 150 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 64 },
  { processCode: 'CHROMATE', processName: '크로메이트', count: 3 },
];

function cards(prefix: string, bucket: ContactBucket, count: number): OpportunityCard[] {
  return Array.from({ length: count }, (_, index) => ({
    ...apjeong,
    oppId: `opp-${prefix}-${bucket}-${index}`,
    evalId: `eval-${prefix}-${bucket}-${index}`,
    title: `가상 ${prefix} ${bucket} ${index}`,
    rank: index + 1,
    bucket,
    bucketBasis: 'EVIDENCE_ENOUGH' as const,
    rankAdjust: null,
  }));
}

/** 실제 DB 사본에서 본 숫자 그대로: 공정마다 50곳만 실리고 묶음별 곳 수는 그 공정 전체다. */
const GROUPS: Record<string, Envelope<OpportunityCard[]>> = {
  ZINC_PLATING: {
    data: [...cards('z', 'EVIDENCE_READY', 28), ...cards('z', 'EVIDENCE_SOME', 22)],
    meta: {
      total: 150,
      processCounts: TABS,
      bucketCounts: {
        EVIDENCE_READY: 28,
        EVIDENCE_SOME: 22,
        NO_HOMEPAGE: 99,
        NOT_RESEARCHED: 0,
        CLOSED: 1,
      },
    },
  },
  ANODIZING: {
    data: [
      ...cards('a', 'EVIDENCE_READY', 20),
      ...cards('a', 'EVIDENCE_SOME', 8),
      ...cards('a', 'NO_HOMEPAGE', 22),
    ],
    meta: {
      total: 64,
      processCounts: TABS,
      bucketCounts: {
        EVIDENCE_READY: 20,
        EVIDENCE_SOME: 8,
        NO_HOMEPAGE: 35,
        NOT_RESEARCHED: 0,
        CLOSED: 1,
      },
    },
  },
  CHROMATE: {
    data: [...cards('c', 'EVIDENCE_READY', 2), ...cards('c', 'CLOSED', 1)],
    meta: {
      total: 3,
      processCounts: TABS,
      bucketCounts: {
        EVIDENCE_READY: 2,
        EVIDENCE_SOME: 0,
        NO_HOMEPAGE: 0,
        NOT_RESEARCHED: 0,
        CLOSED: 1,
      },
    },
  },
};

function serve() {
  mockedGet.mockImplementation((_page, _size, _signal, filters) => {
    const code = filters?.process;
    if (!code) {
      return Promise.resolve({ data: [apjeong], meta: { total: 217, processCounts: TABS } });
    }
    return Promise.resolve(GROUPS[code]);
  });
}

function renderPage(initial = '/opportunities') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
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
        <OpportunityListPage />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

const titles = (scope: HTMLElement) =>
  within(scope)
    .queryAllByTestId('bucket-title')
    .map((title) => title.textContent);

async function group(code: string) {
  await waitFor(() => expect(screen.getAllByTestId('process-group-title')).toHaveLength(3));
  const section = screen.getByTestId(`process-group-${code}`);
  await waitFor(() =>
    expect(within(section).queryAllByTestId('opportunity-card').length).toBeGreaterThan(0),
  );
  return section;
}

// 카드를 100장 넘게 그려서 느린 PC에서는 기본 5초를 넘길 수 있어 이 묶음만 넉넉히 둔다.
describe('공정별 묶음 보기 · 50곳만 실린 공정 (#719)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
    serve();
  });

  it('제목이 안 나온 묶음이 있으면 "150곳 가운데 50곳만 보입니다. 나머지: …"와 "이 공정만 보기"를 보인다', async () => {
    renderPage();
    const zinc = await group('ZINC_PLATING');
    expect(within(zinc).getAllByTestId('opportunity-card')).toHaveLength(50);
    // 다 실린 묶음의 제목은 그대로다.
    expect(titles(zinc)).toEqual(['근거 있음 28곳', '근거 조금 22곳']);
    const note = within(zinc).getByTestId('process-group-truncated');
    expect(note).toHaveTextContent(
      '이 공정은 150곳 가운데 50곳만 보입니다. 나머지: 홈페이지 없음 99곳 · 끝난 회사 1곳 — 이 공정만 보기',
    );
    const more = within(note).getByTestId('process-group-more');
    expect(more).toHaveTextContent(/^이 공정만 보기$/);
    expect(more).toHaveAttribute('href', '/opportunities?process=ZINC_PLATING');
  });

  it('카드가 일부만 실린 묶음의 제목에는 "(22곳만 보임)"을 덧붙이고, 나머지 곳 수는 안 보인 만큼만 센다', async () => {
    renderPage();
    const anodizing = await group('ANODIZING');
    expect(titles(anodizing)).toEqual([
      '근거 있음 20곳',
      '근거 조금 8곳',
      '홈페이지 없음 35곳 (22곳만 보임)',
    ]);
    expect(within(anodizing).getByTestId('process-group-truncated')).toHaveTextContent(
      '이 공정은 64곳 가운데 50곳만 보입니다. 나머지: 홈페이지 없음 13곳 · 끝난 회사 1곳 — 이 공정만 보기',
    );
  });

  it('다 실린 공정에는 안내도 "곳만 보임"도 없다', async () => {
    renderPage();
    const chromate = await group('CHROMATE');
    expect(titles(chromate)).toEqual(['근거 있음 2곳', '끝난 회사 1곳']);
    expect(within(chromate).queryByTestId('process-group-truncated')).not.toBeInTheDocument();
    expect(within(chromate).queryByTestId('process-group-more')).not.toBeInTheDocument();
  });

  it('"최근 들어온 순"처럼 묶음 제목이 없는 정렬에서는 곳 수만 알리고 "나머지"는 적지 않는다', async () => {
    renderPage('/opportunities?sort=recent');
    const zinc = await group('ZINC_PLATING');
    expect(titles(zinc)).toEqual([]);
    const note = within(zinc).getByTestId('process-group-truncated');
    expect(note).toHaveTextContent(/^이 공정은 150곳 가운데 50곳만 보입니다\. — 이 공정만 보기$/);
    expect(within(note).getByTestId('process-group-more')).toHaveAttribute(
      'href',
      '/opportunities?process=ZINC_PLATING&sort=recent',
    );
  });

  it('공정 하나를 고른 목록(20건씩 쪽 넘김)의 묶음 제목에는 "곳만 보임"을 붙이지 않는다', async () => {
    mockedGet.mockResolvedValue({
      ...GROUPS.ANODIZING,
      data: GROUPS.ANODIZING.data.slice(0, 20),
    });
    renderPage('/opportunities?process=ANODIZING');
    await screen.findAllByTestId('opportunity-card');
    expect(titles(document.body)).toEqual(['근거 있음 20곳']);
    expect(screen.queryByTestId('process-group-truncated')).not.toBeInTheDocument();
  });
});
