// 돈이 드는 단추의 글 뒤에 붙는 작은 "유료" 꼬리표(#981, PM 결정 2026-11-28: 💰 이모지 대신).
// 누르면 AI 비용이 드는 단추에만 붙인다. 창만 여는 단추·예시 질문·[넣기]처럼 돈이 안 드는 단추에는 붙이지 않는다.
// 단추 글과 띄어 읽히도록 쓰는 쪽이 `{글} <PaidTag />`처럼 사이에 빈칸을 둔다(화면 낭독: "묻기 유료").
import { paidTexts } from '../../labels/ko';
import { paidTag } from '../../theme/tokens';

export default function PaidTag({
  onPrimary = false,
}: {
  /** 보라 주 단추 위면 true(흰 바탕 + 보라 글자), 흰 단추 위면 false(연보라 바탕 + 보라 글자). */
  onPrimary?: boolean;
}) {
  const tone = onPrimary ? paidTag.onPrimary : paidTag.plain;
  return (
    <span
      data-testid="paid-tag"
      style={{
        display: 'inline-block',
        marginLeft: 4,
        padding: '0 6px',
        borderRadius: paidTag.radius,
        background: tone.bg,
        color: tone.fg,
        fontSize: paidTag.fontSize,
        fontWeight: 600,
        lineHeight: 1.6,
        verticalAlign: 1,
      }}
    >
      {paidTexts.tag}
    </span>
  );
}
