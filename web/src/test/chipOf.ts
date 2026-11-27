// 시험 도우미(#972): 선택 단추 묶음(ChoiceChips)에서 단추 하나를 찾는다.
// 기록 칸의 종류·결과가 고르기 상자에서 선택 단추로 바뀌어, 값(예: 'MEMO')이나 보이는 글자(예: '메모')로 찾는다.
import { screen, within } from '@testing-library/react';

/** 묶음(testId) 안에서 값이나 글자가 같은 선택 단추. 없으면 시험이 실패한다. */
export function chipOf(testId: string, valueOrLabel: string): HTMLElement {
  const group = screen.getByTestId(testId);
  const chips = within(group).getAllByRole('radio');
  const found = chips.find(
    (chip) => chip.getAttribute('data-value') === valueOrLabel || chip.textContent === valueOrLabel,
  );
  if (!found) {
    throw new Error(
      `"${testId}" 묶음에 "${valueOrLabel}" 단추가 없습니다. 있는 단추: ${chips
        .map((chip) => chip.textContent)
        .join(', ')}`,
    );
  }
  return found;
}

/** 묶음(testId)에서 지금 골라진 단추의 값. 아무것도 안 골랐으면 null. */
export function chipValueOf(testId: string): string | null {
  const group = screen.getByTestId(testId);
  const checked = within(group)
    .getAllByRole('radio')
    .find((chip) => chip.getAttribute('aria-checked') === 'true');
  return checked?.getAttribute('data-value') ?? null;
}
