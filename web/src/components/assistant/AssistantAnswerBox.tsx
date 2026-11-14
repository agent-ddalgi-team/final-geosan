// 영업 비서의 답 한 덩어리(#680): 답 글 + "AI가 쓴 답 · 확인 필요" 표시 + 근거 회사 링크.
// 모달 없이 그 자리 아래에 편다. 근거 회사는 서버가 고른 것만 보이고, 누르면 그 회사 상세로 간다.
// 질문에 답하기에서 회사 일부만 보았으면 "○곳 가운데 ○곳만 보았습니다"를 답 아래에 적는다.
import { Link } from 'react-router-dom';
import type { AssistantAnswer } from '../../api/assistant';
import { assistantTexts as texts } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export default function AssistantAnswerBox({ answer }: { answer: AssistantAnswer }) {
  const { companiesIncluded: included, companiesTotal: total } = answer;
  const partial = included !== undefined && total !== undefined && included < total;
  return (
    <div
      data-testid="assistant-answer"
      aria-live="polite"
      style={{
        display: 'grid',
        gap: 8,
        padding: 12,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 8,
        background: colors.bgLayout,
      }}
    >
      <span
        data-testid="assistant-ai-mark"
        style={{
          justifySelf: 'start',
          padding: '2px 8px',
          borderRadius: 4,
          background: statusPalette.wait.bg,
          color: statusPalette.wait.fg,
          fontSize: typography.fontSizeSecondary,
        }}
      >
        {texts.aiMark}
      </span>
      <p data-testid="assistant-answer-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {answer.answer}
      </p>
      {answer.sources.length > 0 ? (
        <p data-testid="assistant-sources" style={{ margin: 0, ...secondary }}>
          {texts.sourcesLabel}{' '}
          {answer.sources.map((source, index) => (
            <span key={source.oppId}>
              {index > 0 ? ' · ' : null}
              <Link to={`/opportunities/${encodeURIComponent(source.oppId)}`}>{source.name}</Link>
            </span>
          ))}
        </p>
      ) : (
        <p data-testid="assistant-sources-none" style={{ margin: 0, ...secondary }}>
          {texts.sourcesNone}
        </p>
      )}
      {partial ? (
        <p data-testid="assistant-partial" style={{ margin: 0, ...secondary }}>
          {texts.partial(total, included)}
        </p>
      ) : null}
    </div>
  );
}
