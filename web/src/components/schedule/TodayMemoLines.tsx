// 영업 홈 "오늘 할 일"의 달력 메모 줄(#984, PM이 고른 시안 2026-11-28).
// 오늘 날짜에 붙인 달력 메모를 일정 줄과 같은 모양으로 한 줄씩 보인다:
//   [메모] 메모 글 / 아랫줄 "달력 메모 · 영업 담당이 11/26에 적음"
// 받은 메모를 그리기만 한다(읽는 것은 영업 홈이 `GET /day-memos?from=오늘&to=오늘`로 따로 한다).
// 오늘 할 일 건수("n건")에는 넣지 않는다(건수는 서버가 준 줄 수 그대로).
// 못 읽었으면 짧은 안내와 [다시 읽기]를 보인다(메모가 없는 것처럼 보이지 않게).
import type { DayMemo } from '../../api/dayMemos';
import { dayMemo as t } from '../../labels/ko';
import { accent, colors, radius, tagPalette, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';

interface Props {
  /** 오늘 날짜의 메모(쓴 순서). */
  memos: DayMemo[];
  /** 메모를 못 읽었다(마지막 읽기 실패). */
  failed?: boolean;
  onReload?: () => void;
}

export default function TodayMemoLines({ memos, failed = false, onReload }: Props) {
  if (memos.length === 0 && !failed) return null;
  return (
    <>
      {memos.length > 0 ? (
        <ul
          aria-label={t.todayListLabel}
          data-testid="dashboard-today-memos"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {memos.map((memo) => (
            <li
              key={memo.memoId}
              data-testid="dashboard-today-memo"
              style={{
                display: 'grid',
                gridTemplateColumns: '76px minmax(0, 1fr)',
                alignItems: 'center',
                columnGap: 12,
                padding: '10px 0',
                borderTop: `1px solid ${colors.borderSecondary}`,
              }}
            >
              <span
                data-testid="dashboard-today-tag-memo"
                style={{
                  textAlign: 'center',
                  fontSize: typography.fontSizeSecondary - 1,
                  fontWeight: 600,
                  borderRadius: radius.tag,
                  padding: '2px 6px',
                  background: tagPalette.neutral.bg,
                  color: tagPalette.neutral.fg,
                }}
              >
                {t.todayTag}
              </span>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <span data-testid="dashboard-today-memo-text" style={{ whiteSpace: 'pre-wrap' }}>
                  {memo.text}
                </span>
                <span
                  data-testid="dashboard-today-memo-meta"
                  style={{
                    display: 'block',
                    color: colors.textSecondary,
                    fontSize: typography.fontSizeSecondary,
                  }}
                >
                  {t.todayMeta(memo.staffName ?? memo.staffKey, formatMonthDay(memo.createdAt))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? (
        <p
          role="alert"
          data-testid="dashboard-today-memos-error"
          style={{
            margin: 0,
            padding: '8px 0',
            borderTop: `1px solid ${colors.borderSecondary}`,
            color: colors.textSecondary,
            fontSize: typography.fontSizeSecondary,
          }}
        >
          {memos.length > 0 ? t.stale : t.todayLoadError}
          {onReload ? (
            <>
              {' '}
              <button
                type="button"
                onClick={onReload}
                data-testid="dashboard-today-memos-retry"
                style={{
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  color: accent.text,
                  font: 'inherit',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t.retry}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
