// 추천 목록 머리의 "보기" 줄(#357, 2026-11-06 PM 결정): 관심 기업만 보기와 대시보드 칸으로 걸러 본 목록의 이름.
//  - 평소: [관심 기업만 보기] 단추 하나.
//  - 관심 기업 보기: "관심 기업" + 검토 의견 거르기(전체 보기 / 검토 권고 / 추가 확인 필요 / 제외 기업 / 기타) + [전체 추천 목록 보기].
//  - 대시보드 칸을 누르고 왔으면: 무엇으로 걸렀는지 칸 이름(대시보드와 같은 말)과 [거르기 풀기].
// 고른 값은 부모가 주소(`?bookmarked=true&opinion=…&filter=…`)에 남기고, 이 부품은 고른 값을 알리기만 한다. 모달 없이 인라인이다.
import { Button } from 'antd';
import { bookmarkList, dashboardTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

/** 검토 의견 거르기 값(계약 C1 `opinion=`). NONE은 세 의견 중 아무것도 고르지 않은 회사("기타"). */
export const OPINION_FILTERS = ['WORTH_REVIEW', 'NEED_CHECK', 'NOT_TARGET', 'NONE'] as const;
export type OpinionFilter = (typeof OPINION_FILTERS)[number];

export function isOpinionFilter(value: string | null): value is OpinionFilter {
  return value !== null && (OPINION_FILTERS as readonly string[]).includes(value);
}

/** 주소의 `filter=` 값 → 대시보드 칸 이름. 표에 없는 값은 코드 이름을 보이지 않고 두루 쓰는 말로 보인다. */
export function filterName(filter: string): string {
  const names: Record<string, string> = dashboardTexts.countNames;
  return filter in names ? names[filter] : bookmarkList.filterUnknown;
}

export interface ListViewBarProps {
  /** 관심 기업 보기인가(주소 `bookmarked=true`). */
  bookmarked: boolean;
  /** 관심 기업 보기에서 고른 검토 의견 거르기. null이면 "전체 보기". */
  opinion: OpinionFilter | null;
  /** 주소의 `filter=` 값(대시보드 칸 이름표). 없으면 null. */
  filter: string | null;
  onBookmarked: (on: boolean) => void;
  onOpinion: (opinion: OpinionFilter | null) => void;
  onClearFilter: () => void;
}

const toggleStyle = (selected: boolean) =>
  ({
    minHeight: 36,
    padding: '0 14px',
    borderRadius: 8,
    border: `1px solid ${selected ? colors.text : colors.border}`,
    background: selected ? colors.text : colors.bgContainer,
    color: selected ? colors.bgContainer : colors.text,
    font: 'inherit',
    fontWeight: selected ? 700 : 400,
    cursor: 'pointer',
  }) as const;

const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 } as const;

export default function ListViewBar({
  bookmarked,
  opinion,
  filter,
  onBookmarked,
  onOpinion,
  onClearFilter,
}: ListViewBarProps) {
  const choices: { value: OpinionFilter | null; label: string; testId: string }[] = [
    { value: null, label: bookmarkList.opinionFilters.ALL, testId: 'list-opinion-ALL' },
    ...OPINION_FILTERS.map((value) => ({
      value,
      label: bookmarkList.opinionFilters[value],
      testId: `list-opinion-${value}`,
    })),
  ];
  return (
    <div data-testid="list-view-bar" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      {bookmarked ? (
        <div data-testid="list-bookmarked-view" style={rowStyle}>
          <strong
            data-testid="list-bookmarked-title"
            style={{ fontSize: typography.fontSizeCardTitle }}
          >
            {bookmarkList.title}
          </strong>
          <div
            role="group"
            aria-label={bookmarkList.opinionGroupLabel}
            data-testid="list-opinion-filter"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
          >
            {choices.map((choice) => {
              const selected = choice.value === opinion;
              return (
                <button
                  key={choice.testId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected) onOpinion(choice.value);
                  }}
                  style={toggleStyle(selected)}
                  data-testid={choice.testId}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          <Button onClick={() => onBookmarked(false)} data-testid="list-bookmarked-off">
            {bookmarkList.showAll}
          </Button>
        </div>
      ) : (
        <div style={rowStyle}>
          <Button onClick={() => onBookmarked(true)} data-testid="list-bookmarked-on">
            {bookmarkList.showOnly}
          </Button>
        </div>
      )}
      {filter ? (
        <div data-testid="list-filter-line" style={rowStyle}>
          <span>
            <span style={{ color: colors.textSecondary }}>{bookmarkList.filterPrefix}: </span>
            <strong data-testid="list-filter-name">{filterName(filter)}</strong>
          </span>
          <Button size="small" onClick={onClearFilter} data-testid="list-filter-clear">
            {bookmarkList.clearFilter}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
