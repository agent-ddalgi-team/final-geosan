// #926 화면 맨 위 줄의 [글자 크기: 작게 · 보통 · 크게 · 더 크게]. 누르면 바로 바뀌고 이 브라우저에 기억한다.
import { useState } from 'react';
import { Segmented } from 'antd';
import { frame } from '../../labels/ko';
import { FONT_SCALE_KEYS, chooseFontScale, readFontScale } from './fontScale';
import type { FontScaleKey } from './fontScale';

export default function FontScaleControl() {
  const [value, setValue] = useState<FontScaleKey>(() => readFontScale());
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span id="font-scale-label">{frame.fontScaleLabel}</span>
      {/* 고른 칸 표시가 미끄러지는 동안 화면 비율이 함께 바뀌면 표시가 옛 자리에 남는다.
          값마다 새로 그려(key) 미끄럼 없이 바로 그 칸에 표시한다. */}
      <Segmented
        key={value}
        size="small"
        aria-labelledby="font-scale-label"
        data-testid="font-scale"
        value={value}
        onChange={(next) => {
          const key = next as FontScaleKey;
          setValue(key);
          chooseFontScale(key);
        }}
        options={FONT_SCALE_KEYS.map((key) => ({
          value: key,
          label: <span data-testid={`font-scale-${key}`}>{frame.fontScaleOptions[key]}</span>,
        }))}
      />
    </div>
  );
}
