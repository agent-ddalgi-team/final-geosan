// #793: 홈페이지로 다시 정한 적합도가 처음(생산품 기준)보다 오르거나 내리면 카드 꼬리표에 화살표가 붙는다.
// 서버 호출 없이 카드만 그린다(가상 값).
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpportunityCard from '../OpportunityCard';
import type { OpportunityCard as CardData } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import listFixture from '../../../test/fixtures/opportunities-apjeong.json';

const apjeong = listFixture.data[0] as unknown as CardData;

function renderCard(changes: Partial<CardData>) {
  render(
    <MemoryRouter>
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
        <OpportunityCard card={{ ...apjeong, bucket: 'EVIDENCE_SOME', ...changes }} />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
  return screen.getByTestId('card-fit-level').textContent;
}

describe('OpportunityCard 홈페이지 기준 적합도 화살표 (#793)', () => {
  it('중 → 상이면 "적합도 상 ↑"', () => {
    expect(renderCard({ fitLevel: 'HIGH', fitBasis: 'HOMEPAGE', previousFitLevel: 'MEDIUM' })).toBe(
      '적합도 상 ↑',
    );
  });

  it('상 → 하이면 "적합도 하 ↓"', () => {
    expect(renderCard({ fitLevel: 'LOW', fitBasis: 'HOMEPAGE', previousFitLevel: 'HIGH' })).toBe(
      '적합도 하 ↓',
    );
  });

  it('같으면 화살표 없이 "적합도 중"', () => {
    expect(
      renderCard({ fitLevel: 'MEDIUM', fitBasis: 'HOMEPAGE', previousFitLevel: 'MEDIUM' }),
    ).toBe('적합도 중');
  });

  it('생산품 기준이면 지금처럼 화살표가 없다', () => {
    expect(renderCard({ fitLevel: 'HIGH', fitBasis: 'PRODUCT', previousFitLevel: null })).toBe(
      '적합도 상',
    );
  });
});
