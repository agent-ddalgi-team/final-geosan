// #691: 목록 카드에서 회사 이름을 눌러 상세로 간다.
// #981(PM 결정 2026-11-28): 거래처 후보 줄에는 [자세히 보기]가 따로 없고 회사 이름이 상세로 가는 길이다.
// 관심 기업 줄에는 [자세히 보기]가 그대로 있다. 서버 호출 없이 화면 이동만 본다.
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

function renderCard(layout: 'table' | 'bookmark' = 'table') {
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
        <OpportunityCard card={apjeong} layout={layout} />
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
    // 링크 글은 회사 이름만이다(#981). 품목은 그 아래 따로 놓인다.
    expect(link.textContent).toBe('A정밀');
    expect(link).toHaveAttribute('href', detailPath);
    // 제목(머리글)은 그대로 서버 글 "회사 · 품목"이다.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(apjeong.title);
    await user.click(link);
    expect(screen.getByTestId('location')).toHaveTextContent(detailPath);
  });

  it('거래처 후보 줄에는 [자세히 보기 →]가 없다: 상세로 가는 링크는 회사 이름 하나다(#981)', () => {
    renderCard();
    expect(screen.queryByTestId('card-view-detail-link')).not.toBeInTheDocument();
    const detailLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === detailPath);
    expect(detailLinks).toEqual([screen.getByTestId('card-title-link')]);
  });

  it('관심 기업 줄의 [자세히 보기 →]는 그대로 상세로 간다', async () => {
    const user = userEvent.setup();
    renderCard('bookmark');
    await user.click(screen.getByTestId('card-view-detail-link'));
    expect(screen.getByTestId('location')).toHaveTextContent(detailPath);
  });

  it('관심 기업 줄에서도 회사 이름을 누르면 상세로 간다', async () => {
    const user = userEvent.setup();
    renderCard('bookmark');
    const link = screen.getByTestId('card-title-link');
    expect(link.textContent).toBe('A정밀');
    await user.click(link);
    expect(screen.getByTestId('location')).toHaveTextContent(detailPath);
  });
});
