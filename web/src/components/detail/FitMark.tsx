// "거산과 맞는 점"의 상태 표시(PM 지시 2026-11-13). 색으로만 구분하지 않게 모양과 글자를 함께 둔다.
// confirmed = 사람이 확인한 값(사례 파일·담당자 확정): 초록 ✓ + "확인됨"(소재는 "통과").
// ai = AI가 제안만 한 값: 회색 ○ + "AI 제안 · 확인 전". 초록을 쓰지 않는다.
// #996: 요약 줄(산업 · 공정 · 소재)이 쓰도록 "한눈에" 부품에서 떼어 냈다. 모양과 글은 그대로다.
import { detailReport } from '../../labels/ko';
import { radius, statusPalette, typography } from '../../theme/tokens';

const texts = detailReport.glance;

export default function FitMark({ kind, text }: { kind: 'confirmed' | 'ai'; text: string }) {
  const palette = kind === 'confirmed' ? statusPalette.ok : statusPalette.neutral;
  return (
    <span
      role="img"
      aria-label={kind === 'confirmed' ? texts.markConfirmedAria(text) : texts.markAiAria}
      data-testid="glance-fit-mark"
      data-mark={kind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 10px',
        borderRadius: radius.tag,
        background: palette.bg,
        color: palette.fg,
        fontSize: typography.fontSizeSecondary,
        fontWeight: kind === 'confirmed' ? 600 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{kind === 'confirmed' ? '✓' : '○'}</span>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
