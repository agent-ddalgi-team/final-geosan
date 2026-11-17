// 카드 "공장 정보" 줄(#573): 팩토리온 공장조회에서 붙인 원자재·공장 규모. 종업원 수는 보이지 않는다(#635).
// #798(PM 지시 2026-11-16): 카드를 3줄로 줄이며 공장 정보 줄은 카드에서 빼고 상세 "한눈에"에서만 본다.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { factoryProfileLabels } from '../../labels/ko';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

function card(oppId: string, rank: number, extra: Partial<OpportunityCard> = {}): OpportunityCard {
  return { ...apjeong, oppId, rank, title: `시험 회사 ${oppId}`, ...extra };
}

function reply(items: OpportunityCard[]): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length } };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/opportunities']}>
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

describe('카드 · 공장 정보 줄 (#573)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('원자재·규모가 있어도 카드에는 공장 정보 줄이 없다(#798 — 상세 "한눈에"에서 본다)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        card('a', 1, {
          factoryProfile: {
            rawMaterials: '강판, SUS',
            employeeCount: 12,
            scale: '소기업',
            fileDate: '2026-11-11',
          },
        }),
      ]),
    );
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.queryByText(factoryProfileLabels.row)).not.toBeInTheDocument();
    expect(view.queryByTestId('card-factory-profile')).not.toBeInTheDocument();
    expect(view.queryByText(/원자재 강판, SUS/)).not.toBeInTheDocument();
  });

  it('종업원 수만 있는 공장은 보일 값이 없어 줄을 그리지 않는다(#635)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        card('a', 1, {
          factoryProfile: {
            rawMaterials: null,
            employeeCount: 4,
            scale: null,
            fileDate: '2026-11-11',
          },
        }),
      ]),
    );
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.queryByTestId('card-factory-profile')).not.toBeInTheDocument();
  });

  it('붙은 공장이 없거나 값이 하나도 없으면 줄을 그리지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        card('a', 1),
        card('b', 2, {
          factoryProfile: {
            rawMaterials: ' ',
            employeeCount: null,
            scale: null,
            fileDate: '2026-11-11',
          },
        }),
      ]),
    );
    renderPage();
    const cards = await screen.findAllByTestId('opportunity-card');
    for (const item of cards) {
      expect(within(item).queryByTestId('card-factory-profile')).not.toBeInTheDocument();
      expect(within(item).queryByText(factoryProfileLabels.row)).not.toBeInTheDocument();
    }
  });
});
