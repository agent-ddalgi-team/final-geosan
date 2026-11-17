// #691: 목록 카드에서 회사 이름을 눌러도 상세로 간다("자세히 보기 →"는 그대로).
// 서버 호출 없이 화면 이동만 본다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityCard from '../OpportunityCard';
import type { OpportunityCard as CardData } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import listFixture from '../../../test/fixtures/opportunities-apjeong.json';

const apjeong = listFixture.data[0] as unknown as CardData;

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderCard() {
  render(
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
        <OpportunityCard card={apjeong} />
        <LocationProbe />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('OpportunityCard 회사 이름 (#691)', () => {
  const detailPath = `/opportunities/${encodeURIComponent(apjeong.oppId)}`;

  it('회사 이름은 상세로 가는 링크이고, 누르면 그 회사 상세로 간다', async () => {
    const user = userEvent.setup();
    renderCard();
    const link = screen.getByTestId('card-title-link');
    expect(link).toHaveTextContent(apjeong.title);
    expect(link).toHaveAttribute('href', detailPath);
    // 제목(머리글)은 그대로 회사 이름이다.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(apjeong.title);
    await user.click(link);
    expect(screen.getByTestId('location')).toHaveTextContent(detailPath);
  });

  it('[자세히 보기 →]도 그대로 상세로 간다', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId('card-view-detail-link'));
    expect(screen.getByTestId('location')).toHaveTextContent(detailPath);
  });
});
