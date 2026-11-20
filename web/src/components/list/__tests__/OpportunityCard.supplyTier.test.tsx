// #860: 카드 꼬리표 "2·3차 가공 · AI 추정" / "1차 완성품·조립 · AI 추정". 모름·판단 전이면 붙지 않는다.
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
        <OpportunityCard card={{ ...apjeong, ...changes }} />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('OpportunityCard 공급망 위치 꼬리표 (#860)', () => {
  it('2·3차 가공이면 "2·3차 가공 · AI 추정", 근거는 마우스를 올리면', () => {
    renderCard({ supplyTier: 'TIER2_3', supplyTierBasis: '볼트·너트를 직접 가공' });
    const tag = screen.getByTestId('card-supply-tier-tag');
    expect(tag).toHaveTextContent('2·3차 가공 · AI 추정');
    expect(tag).toHaveAttribute('title', '볼트·너트를 직접 가공');
  });

  it('1차면 "1차 완성품·조립 · AI 추정"', () => {
    renderCard({ supplyTier: 'TIER1', supplyTierBasis: '철도차량 완성품 조립 납품' });
    expect(screen.getByTestId('card-supply-tier-tag')).toHaveTextContent(
      '1차 완성품·조립 · AI 추정',
    );
  });

  it.each([['UNKNOWN' as const], [null], [undefined]])('%s이면 꼬리표가 없다', (supplyTier) => {
    renderCard({ supplyTier });
    expect(screen.queryByTestId('card-supply-tier-tag')).not.toBeInTheDocument();
  });
});
