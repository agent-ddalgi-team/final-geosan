// 알림 띠(BR10.4): 내부용 항상 / 가상 데이터 / 거산 확인 전(BROCHURE) / demoLabel / 갱신 시각.
import { render, screen } from '@testing-library/react';
import StatusBanner from '../StatusBanner';
import { banner } from '../../../labels/ko';

describe('StatusBanner', () => {
  it('아무 조건이 없어도 내부용 띠는 항상 보이고, 띠는 닫기 없이 role=status 하나다', () => {
    render(<StatusBanner />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(banner.internalOnly);
    expect(screen.queryByTestId('banner-virtual-data')).not.toBeInTheDocument();
    expect(screen.queryByTestId('banner-brochure')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('가상 데이터가 섞이면 "가상 데이터 표시 중"이 같은 띠에 함께 보인다', () => {
    render(<StatusBanner hasVirtualData />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(banner.internalOnly);
    expect(status).toHaveTextContent(banner.virtualData);
  });

  it('거산 확인 전(BROCHURE) 묶음이면 참고 추천 안내가 보이고, 다른 묶음에는 없다', () => {
    const { rerender } = render(<StatusBanner datasetKind="BROCHURE" />);
    expect(screen.getByTestId('banner-brochure')).toHaveTextContent(banner.brochure);
    rerender(<StatusBanner datasetKind="VIRTUAL_REVIEWED" />);
    expect(screen.queryByTestId('banner-brochure')).not.toBeInTheDocument();
  });

  it('앱 설정 demoLabel이 있으면 같은 띠에 그 문구가 함께 보인다', () => {
    render(<StatusBanner demoLabel="부분 시연·거산 확인 전" />);
    expect(screen.getByRole('status')).toHaveTextContent('부분 시연·거산 확인 전');
    expect(screen.getByRole('status')).toHaveTextContent(banner.internalOnly);
  });

  it('갱신 시각은 한국 시각 "월/일 시:분"으로 보이고, 읽을 수 없는 값이면 보이지 않는다', () => {
    const { rerender } = render(<StatusBanner updatedAt="2026-10-20T00:00:00Z" />);
    expect(screen.getByTestId('banner-updated-at')).toHaveTextContent('갱신 10/20 09:00');
    rerender(<StatusBanner updatedAt="not-a-date" />);
    expect(screen.queryByTestId('banner-updated-at')).not.toBeInTheDocument();
  });
});
