// #981: 영업 홈 "오늘 할 일" 아래의 "의견 전" 알림 한 줄.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NoOpinionNotice from '../NoOpinionNotice';

const renderNotice = (count: number | undefined) =>
  render(
    <MemoryRouter>
      <NoOpinionNotice count={count} />
    </MemoryRouter>,
  );

it('Given 의견 전인 관심 기업 3곳 When 영업 홈 Then 곳 수와 [고르러 가기] 링크가 보이고 링크는 관심 기업의 "의견 전" 보기(같은 기준 filter=NO_OPINION)로 간다', () => {
  renderNotice(3);
  expect(screen.getByTestId('dashboard-no-opinion-notice')).toHaveTextContent(
    '관심에 담고 의견을 안 고른 회사 3곳',
  );
  expect(screen.getByTestId('dashboard-no-opinion-link')).toHaveAttribute(
    'href',
    '/bookmarks?filter=NO_OPINION',
  );
  expect(screen.getByRole('link', { name: /고르러 가기/ })).toBeInTheDocument();
});

it.each([[0], [undefined]])(
  'Given 의견 전인 회사가 없거나 서버가 값을 안 줌(%s) When 영업 홈 Then 줄을 그리지 않는다(숫자를 지어내지 않는다)',
  (count) => {
    renderNotice(count);
    expect(screen.queryByTestId('dashboard-no-opinion-notice')).toBeNull();
  },
);
