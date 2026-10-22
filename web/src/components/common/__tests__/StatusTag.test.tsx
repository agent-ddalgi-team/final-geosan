// 색+글자 태그: 6가지 조합(statusPalette)만 쓰고 글자가 항상 함께 있다.
import { render, screen } from '@testing-library/react';
import StatusTag from '../StatusTag';
import { statusPalette } from '../../../theme/tokens';

describe('StatusTag', () => {
  it('조합의 글자색·배경색을 토큰에서 가져오고 글자를 함께 보인다', () => {
    render(<StatusTag tone="wait">확인 대기</StatusTag>);
    const tag = screen.getByText('확인 대기');
    expect(tag).toHaveStyle({ color: statusPalette.wait.fg, background: statusPalette.wait.bg });
  });

  it('아이콘 글자는 낭독기에서 숨기고 본 글자만 읽힌다', () => {
    render(
      <StatusTag tone="ok" icon="✔">
        통과
      </StatusTag>,
    );
    expect(screen.getByText('✔')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/통과/)).toBeInTheDocument();
  });
});
