// 상세 구역 틀(#759): 제목 옆 숫자 꼬리표는 숫자를 줄 때만 보이고, 제목 글에 붙지 않는다.
import { render, screen } from '@testing-library/react';
import DetailSection from '../DetailSection';

describe('DetailSection', () => {
  it('숫자를 주면 제목 옆에 꼬리표가 보이고 제목 글은 그대로다(0도 보인다)', () => {
    const { unmount } = render(
      <DetailSection id="detail-x" title="통화에서 확인할 것" count={3}>
        <p>본문</p>
      </DetailSection>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^통화에서 확인할 것$/);
    expect(screen.getByTestId('detail-x-count')).toHaveTextContent('3');
    expect(screen.getByRole('region', { name: '통화에서 확인할 것' })).toHaveTextContent('본문');
    unmount();
    render(
      <DetailSection id="detail-x" title="기록" count={0}>
        <p>본문</p>
      </DetailSection>,
    );
    expect(screen.getByTestId('detail-x-count')).toHaveTextContent('0');
  });

  it('숫자를 주지 않거나 null이면 꼬리표가 없다', () => {
    render(
      <DetailSection id="detail-y" title="비슷한 회사" count={null}>
        <p>본문</p>
      </DetailSection>,
    );
    expect(screen.queryByTestId('detail-y-count')).not.toBeInTheDocument();
  });
});
