// #926 글자 크기 고르기: 기억한 값 읽기 · 화면 적용(<html data-font-scale>) · 맨 위 줄 단추.
// 실제 확대 비율(zoom)은 styles.css가 맡고, 여기서는 표시가 바뀌는지만 본다(jsdom은 zoom을 그리지 않음).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FontScaleControl from '../FontScaleControl';
import {
  FONT_SCALE_STORAGE_KEY,
  applyFontScale,
  chooseFontScale,
  readFontScale,
} from '../fontScale';
import { frame } from '../../../labels/ko';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.fontScale;
  vi.restoreAllMocks();
});

it('기억한 값이 없거나 모르는 값이면 보통으로 읽는다', () => {
  expect(readFontScale()).toBe('M');
  window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, 'HUGE');
  expect(readFontScale()).toBe('M');
  window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, 'XL');
  expect(readFontScale()).toBe('XL');
});

it('저장소를 읽지 못하면 오류 없이 보통으로 읽는다', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readFontScale()).toBe('M');
});

it('크게를 적용하면 html에 표시가 붙고, 보통으로 돌리면 표시가 사라진다', () => {
  applyFontScale('L');
  expect(document.documentElement.dataset.fontScale).toBe('L');
  applyFontScale('M');
  expect(document.documentElement.dataset.fontScale).toBeUndefined();
});

it('저장이 막혀도 고른 크기는 이번 화면에 적용된다', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  chooseFontScale('S');
  expect(document.documentElement.dataset.fontScale).toBe('S');
});

it('맨 위 줄에서 [더 크게]를 누르면 바로 적용되고 이 브라우저에 기억된다', async () => {
  render(<FontScaleControl />);
  expect(screen.getByText(frame.fontScaleLabel)).toBeInTheDocument();
  expect(screen.getByTestId('font-scale-M')).toHaveTextContent('보통');
  await userEvent.click(screen.getByTestId('font-scale-XL'));
  expect(document.documentElement.dataset.fontScale).toBe('XL');
  expect(window.localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBe('XL');
});

it('기억한 크기로 열리면 그 칸이 골라져 있다', () => {
  window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, 'L');
  render(<FontScaleControl />);
  const chosen = screen.getByTestId('font-scale-L').closest('.ant-segmented-item');
  expect(chosen).toHaveClass('ant-segmented-item-selected');
});
