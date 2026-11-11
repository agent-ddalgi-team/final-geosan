// 카드 "공장 정보" 줄(#573): 팩토리온 공장조회에서 붙인 원자재·종업원 수(추정)·공장 규모.
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

  it('원자재·종업원 수·규모를 한 줄로 보이고 종업원 수에는 언제나 "(추정)"을 붙인다', async () => {
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
    expect(view.getByText(factoryProfileLabels.row)).toBeInTheDocument();
    expect(view.getByTestId('card-factory-profile')).toHaveTextContent(
      '원자재 강판, SUS · 종업원 약 12명(추정) · 소기업',
    );
  });

  it('빈 값은 빼고 남은 것만 보인다', async () => {
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
    expect(view.getByTestId('card-factory-profile')).toHaveTextContent(/^종업원 약 4명\(추정\)$/);
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
