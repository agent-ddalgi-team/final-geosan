// 영업 분석 › 상대 반응(#985) 파이 한 칸: 왼쪽 파이(SVG, 그림 라이브러리 없음) + 오른쪽 범례 줄.
// 조각이 비슷하면 눈으로 견주기 어려워서 범례 줄에 이름 · 건수 · 비율을 늘 함께 적는다(색만으로 가르지 않는다).
// 조각 위에는 글자를 올리지 않는다. 조각은 손(마우스)으로, 범례 줄은 단추라 키보드로도 누를 수 있다.
// 숫자는 받은 값 그대로이고 여기서 새로 세지 않는다(각도·비율 계산은 reactionMath.ts).
import { reactionAnalysisTexts as texts } from '../../labels/ko';
import { chartTheme, colors, radius, reactionPalette, typography } from '../../theme/tokens';
import { chartSecondary } from '../common/ChartFrame';
import { percentOf, pieSlices } from './reactionMath';

export interface PiePart {
  key: string;
  name: string;
  value: number;
  color: string;
}

export interface ReactionPieProps {
  /** 시험·제목 연결에 쓰는 이름. 예: "reaction-pie-bad" */
  id: string;
  title: string;
  /** 제목 옆 작은 글. 예: "부정적 11건 가운데" */
  sub: string;
  /** 범례에 보일 줄(서버가 준 순서). 0건인 줄은 범례에는 남고 조각은 그리지 않는다. */
  parts: PiePart[];
  /** 표본이 기준보다 적으면 false: 비율(%) 없이 건수만 보인다. */
  showRatio: boolean;
  /** 지금 펼쳐 둔 조각의 열쇠. */
  pickedKey: string | null;
  /** 조각이나 범례 줄을 눌렀을 때. 같은 것을 다시 누르면 닫는 일은 부르는 쪽이 한다. */
  onPick: (key: string) => void;
}

export default function ReactionPie({
  id,
  title,
  sub,
  parts,
  showRatio,
  pickedKey,
  onPick,
}: ReactionPieProps) {
  const size = reactionPalette.pieSize;
  const total = parts.reduce((sum, part) => sum + Math.max(part.value, 0), 0);
  const slices = pieSlices(parts, size);
  const byKey = new Map(parts.map((part) => [part.key, part]));
  const percent = (value: number) => (showRatio ? percentOf(value, total) : null);
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={id}
      style={{
        flex: '1 1 300px',
        minWidth: 0,
        boxSizing: 'border-box',
        border: `1px solid ${chartTheme.cardBorder}`,
        borderRadius: radius.card,
        padding: 16,
        background: chartTheme.cardBg,
        display: 'grid',
        gap: 12,
        alignContent: 'start',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <h3
          id={`${id}-title`}
          style={{ margin: 0, fontSize: typography.fontSize, fontWeight: 600 }}
        >
          {title}
        </h3>
        <span data-testid={`${id}-sub`} style={chartSecondary}>
          {sub}
        </span>
      </div>
      {total <= 0 ? (
        <p data-testid={`${id}-empty`} style={{ margin: 0, ...chartSecondary }}>
          {texts.pieEmpty}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={parts.map((part) => texts.sliceSpoken(part.name, part.value)).join(', ')}
            data-testid={`${id}-svg`}
            style={{ flex: 'none' }}
          >
            {slices.map((slice) => {
              const part = byKey.get(slice.key);
              if (!part) return null;
              return (
                <path
                  key={slice.key}
                  d={slice.path}
                  fill={part.color}
                  stroke={reactionPalette.gap}
                  strokeWidth={reactionPalette.gapWidth}
                  strokeLinejoin="round"
                  data-testid={`${id}-slice`}
                  data-key={slice.key}
                  onClick={() => onPick(slice.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{texts.sliceTitle(part.name, part.value, percent(part.value))}</title>
                </path>
              );
            })}
          </svg>
          <ul
            aria-label={texts.legendLabel(title)}
            data-testid={`${id}-legend`}
            style={{
              flex: '1 1 170px',
              minWidth: 0,
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 1,
            }}
          >
            {parts.map((part) => {
              const picked = part.key === pickedKey;
              const ratio = percent(part.value);
              return (
                <li key={part.key}>
                  <button
                    type="button"
                    aria-pressed={picked}
                    disabled={part.value <= 0}
                    onClick={() => onPick(part.key)}
                    data-testid={`${id}-legend-row`}
                    data-key={part.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      padding: '5px 6px',
                      borderRadius: radius.controlSm,
                      border: `1px solid ${picked ? reactionPalette.picked.border : 'transparent'}`,
                      background: picked ? reactionPalette.picked.bg : 'none',
                      color: colors.text,
                      fontFamily: 'inherit',
                      fontSize: typography.fontSizeSecondary,
                      textAlign: 'left',
                      cursor: part.value > 0 ? 'pointer' : 'default',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        flex: 'none',
                        width: reactionPalette.swatch,
                        height: reactionPalette.swatch,
                        borderRadius: reactionPalette.swatchRadius,
                        background: part.color,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        // 한글 이름이 글자 중간에서 끊기지 않게 낱말 단위로만 줄을 바꾼다.
                        wordBreak: 'keep-all',
                        fontWeight: picked ? 600 : 400,
                      }}
                    >
                      {part.name}
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {texts.count(part.value)}
                    </span>
                    {ratio === null ? null : (
                      <span
                        data-testid={`${id}-legend-percent`}
                        style={{
                          width: 34,
                          textAlign: 'right',
                          color: chartTheme.textSecondary,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {texts.percent(ratio)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
