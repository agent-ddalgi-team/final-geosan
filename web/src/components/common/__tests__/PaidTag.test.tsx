// #981: 돈이 드는 단추의 "유료" 꼬리표. 💰 이모지를 대신한다.
import { render, screen } from '@testing-library/react';
import PaidTag from '../PaidTag';
import * as labels from '../../../labels/ko';
import { accent, paidTag } from '../../../theme/tokens';

it('Given 흰 단추 위 When 꼬리표 Then "유료" 글자가 연보라 바탕 + 보라 글자로 보인다', () => {
  render(<PaidTag />);
  const tag = screen.getByTestId('paid-tag');
  expect(tag).toHaveTextContent('유료');
  expect(tag).toHaveStyle({ background: paidTag.plain.bg, color: accent.text });
});

it('Given 보라 주 단추 위 When 꼬리표 Then 흰 바탕 + 보라 글자로 보인다', () => {
  render(<PaidTag onPrimary />);
  expect(screen.getByTestId('paid-tag')).toHaveStyle({
    background: paidTag.onPrimary.bg,
    color: accent.text,
  });
});

it('Given 단추 안 When 글 뒤에 꼬리표 Then 단추 이름이 "묻기 유료"로 읽힌다(화면 낭독)', () => {
  render(
    <button type="button">
      묻기 <PaidTag onPrimary />
    </button>,
  );
  expect(screen.getByRole('button', { name: '묻기 유료' })).toBeInTheDocument();
});

it('화면 글 어디에도 💰 · 💬 이모지가 남아 있지 않다', () => {
  // 글 대응표 전체를 훑는다: 문자열과, 숫자·글을 넣어 만드는 함수의 결과까지는 보지 않고 문자열만 본다.
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (/💰|💬/u.test(value)) found.push(path);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    }
  };
  walk(labels, 'labels');
  expect(found).toEqual([]);
});
