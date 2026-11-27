// 하나만 고르는 선택 단추 묶음(#972 새 시안): 종류(전화·메일·대면·메모), 발신/수신, 결과(연결됨·부재·거절), 꼬리 질문 답.
// 고른 단추는 강조 연한 바탕 + 강조 테두리 + 강조 글자 굵게, 안 고른 단추는 흰 바탕 + 얇은 테두리 + 보조 글자
// (색은 theme/tokens.ts의 choiceChip). 색으로만 구분하지 않게 고른 단추는 글자가 굵고 aria-checked로도 알린다.
// 키보드: Tab으로 묶음에 들어가 화살표로 옮기며 고른다(라디오 묶음과 같다). 창·서랍을 띄우지 않는다.
import type { KeyboardEvent } from 'react';
import { choiceChip, radius, typography } from '../../theme/tokens';

/** 선택 단추 하나의 모양. 활동 이력 거르기·날짜 빠른 고르기처럼 같은 모양을 쓰는 곳에서도 가져다 쓴다. */
export function choiceChipStyle(selected: boolean, disabled = false) {
  const palette = selected ? choiceChip.selected : choiceChip.idle;
  return {
    minHeight: 32,
    padding: '0 12px',
    borderRadius: radius.controlSm,
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: palette.fg,
    font: 'inherit',
    fontSize: typography.fontSizeSecondary,
    fontWeight: selected ? choiceChip.selected.fontWeight : 400,
    whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  } as const;
}

export interface ChoiceChipOption {
  value: string;
  label: string;
}

export interface ChoiceChipsProps {
  /** 묶음을 읽어 주는 이름. 화면에 보이는 질문 글이 따로 있으면 labelledBy로 그 글을 가리킨다. */
  label?: string;
  labelledBy?: string;
  /** 고른 값. 아직 안 골랐으면 null. */
  value: string | null;
  options: ChoiceChipOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  /** 바깥에서 초점을 옮길 때 쓰는 id. 고른 단추(없으면 첫 단추)에 붙는다. */
  focusId?: string;
}

export default function ChoiceChips({
  label,
  labelledBy,
  value,
  options,
  onChange,
  disabled = false,
  testId,
  focusId,
}: ChoiceChipsProps) {
  // Tab으로 들어올 때 초점을 받는 단추: 고른 단추, 없으면 첫 단추.
  const tabStop = options.some((option) => option.value === value) ? value : options[0]?.value;

  function onKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || disabled || options.length === 0) return;
    const chips = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    );
    const from = chips.findIndex((chip) => chip === document.activeElement);
    if (from < 0) return;
    event.preventDefault();
    const next = (from + step + chips.length) % chips.length;
    chips[next].focus();
    if (options[next].value !== value) onChange(options[next].value);
  }

  return (
    <fieldset
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      data-testid={testId}
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        margin: 0,
        padding: 0,
        border: 0,
        minWidth: 0,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            // 묶음 안에서 글자로도 찾을 수 있게 이름을 그대로 붙인다(화면에 보이는 글자와 같다).
            aria-label={option.label}
            id={focusId && option.value === tabStop ? focusId : undefined}
            tabIndex={option.value === tabStop ? 0 : -1}
            data-value={option.value}
            data-selected={selected ? 'true' : undefined}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            style={choiceChipStyle(selected, disabled)}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
