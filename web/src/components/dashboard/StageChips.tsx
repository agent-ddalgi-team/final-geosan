// 영업 홈 "진행 중인 회사" 제목 옆 작은 영업 단계 칸 묶음(#921 작은 칩 → #972 큰 카드 5칸 → #983 카드 안 작은 칸 → #992).
//   [영업 단계  미접촉 1 → 접촉 4 [+2][멈춤 1] → 견적·샘플 5 [+2] → 성사 3 [+1] ┊ 보류 1 [+1]]
// #992(PM이 고른 수정안 3, 2026-11-29): 제목 아래 한 줄을 통째로 쓰던 두 줄짜리 칸을, 제목 바로 옆의 한 줄짜리
//   더 작은 칸 묶음으로 줄였다. 연보라 묶음 맨 앞에 작은 글 "영업 단계", 칸마다 이름 · 굵은 숫자 · 작은 꼬리표.
//   보는 중인(고른) 칸은 진한 보라 바탕 + 흰 글자 + 이름 굵기 한 단계 위, 나머지는 흰 바탕 + 연보라 테두리.
//   칸에 "곳"은 보이지 않고(숫자만), 단추 이름(화면 낭독)에는 "접촉 4곳"으로 그대로 읽힌다.
//   설명 줄("영업 단계 칸을 누르면 …")은 묶음 아래에 표 카드(ProgressTable)가 그린다.
// 숫자는 서버 집계(counts)를 그대로 쓰고, 서버가 주지 않은 칸은 0으로 지어내지 않고 뺀다.
// 칸을 누르면 아래 표가 그 단계로 걸러진다(다시 누르면 풀림).
//   - 순서가 있는 네 칸 사이에만 화살표를 둔다. 보류는 순서 밖이라 세로 줄로 띄우고 점선 테두리.
//   - 보류도 서버가 숫자를 주면 0곳이어도 칸으로 보인다(#972).
//   - "멈춤 n" = 같은 응답의 단계별 회사 목록(progressCompanies)에서 센 멈춘 회사 수. 1곳 이상일 때만 붙이고,
//     목록이 없으면(옛 서버) 붙이지 않는다. 단추 이름(화면 낭독)에는 "멈춘 회사 n곳"으로 풀어 읽힌다.
//   - "+n"(#976, #992에서 "+n 이번 주"를 줄임) = 이번 주(월요일~오늘)에 그 칸으로 들어온 관심 기업 수. 서버가 준
//     값(enteredThisWeek)이 1 이상일 때만 붙인다. 0이거나 값이 없으면(옛 서버·미접촉 칸) 붙이지 않는다.
//     단추 이름에는 "이번 주에 이 단계로 들어온 회사 n곳"으로 줄이지 않고 읽힌다.
import { Fragment } from 'react';
import type { Dashboard, DashboardCounts, ProgressBandKey } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { stageCell } from '../../theme/tokens';

export const CHIP_ORDER = ['NOT_CONTACTED', 'IN_CONTACT', 'QUOTE_SAMPLE', 'WON'] as const;

export function stageName(band: ProgressBandKey): string {
  return band === 'ON_HOLD' ? t.progressOnHoldName : t.progressBandNames[band];
}

/** 그 단계에서 멈춘 회사 수. 회사 목록이 없으면(옛 서버) null. */
export function stalledCount(
  companies: Dashboard['progressCompanies'],
  band: ProgressBandKey,
): number | null {
  const rows = companies?.[band];
  return rows ? rows.filter((row) => row.stalled).length : null;
}

/** 그 칸에 이번 주 들어온 회사 수. 서버가 준 값이 1 이상일 때만, 아니면(0 · 옛 서버 · 미접촉 칸) 0. */
export function enteredCount(entered: Dashboard['enteredThisWeek'], band: ProgressBandKey): number {
  const raw = entered?.[band];
  return typeof raw === 'number' && raw > 0 ? raw : 0;
}

/** 화면에 보이는 칸(서버가 숫자를 준 칸) 가운데 "+n" 꼬리표가 하나라도 붙는가. 설명 줄의 풀이를 보일지 정한다. */
export function hasEnteredTag(
  counts: DashboardCounts,
  entered: Dashboard['enteredThisWeek'],
): boolean {
  return [...CHIP_ORDER, 'ON_HOLD' as const].some(
    (band) => typeof counts[band] === 'number' && enteredCount(entered, band) > 0,
  );
}

const LEAD_ID = 'dashboard-stage-chips-lead';

const tagStyle = {
  padding: '0 5px',
  borderRadius: stageCell.tagRadius,
  fontSize: stageCell.tagSize,
  fontWeight: 600,
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
} as const;

export default function StageChips({
  counts,
  selected,
  onSelect,
  companies,
  entered,
}: {
  counts: DashboardCounts;
  selected: ProgressBandKey | null;
  onSelect: (band: ProgressBandKey | null) => void;
  /** 단계별 회사 목록(같은 응답). "멈춤 n" 꼬리표에만 쓴다. */
  companies?: Dashboard['progressCompanies'];
  /** 칸별 이번 주 진입 수(같은 응답, #976). 없으면(옛 서버) 꼬리표를 붙이지 않는다. */
  entered?: Dashboard['enteredThisWeek'];
}) {
  // 서버가 준 칸만.
  const bands = [...CHIP_ORDER, 'ON_HOLD' as const].filter(
    (band) => typeof counts[band] === 'number',
  );
  if (bands.length === 0) return null;
  const ordered = bands.filter((band) => band !== 'ON_HOLD');
  return (
    <div
      role="group"
      aria-labelledby={LEAD_ID}
      title={t.stageChipsHint}
      data-testid="dashboard-stage-chips"
      // 넓으면 제목 옆 한 줄에 모두, 좁으면 묶음 안에서 다음 줄로 내려간다.
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: stageCell.gap,
        minWidth: 0,
        padding: stageCell.group.padding,
        borderRadius: stageCell.group.radius,
        background: stageCell.group.bg,
        border: `1px solid ${stageCell.group.border}`,
      }}
    >
      <span
        id={LEAD_ID}
        data-testid="dashboard-stage-lead"
        style={{
          fontSize: stageCell.lead.size,
          fontWeight: 600,
          color: stageCell.lead.fg,
          padding: '0 4px',
          whiteSpace: 'nowrap',
        }}
      >
        {t.stageChipsLabel}
      </span>
      {bands.map((band) => {
        const on = selected === band;
        const hold = band === 'ON_HOLD';
        const value = counts[band] ?? 0;
        const stalled = stalledCount(companies, band) ?? 0;
        const entering = enteredCount(entered, band);
        const label =
          `${stageName(band)} ${value}${t.stageCellUnit}` +
          (entering > 0 ? ` · ${t.stageCardEnteredHint(entering)}` : '') +
          (stalled > 0 ? ` · ${t.stageCardStalled(stalled)}` : '');
        const hasNext = !hold && ordered.indexOf(band) < ordered.length - 1;
        const look = on ? stageCell.selected : stageCell.idle;
        const enteredTag = on ? stageCell.enteredTagOnSelected : stageCell.enteredTag;
        return (
          <Fragment key={band}>
            {/* 보류는 순서 밖이라 앞에 세로 줄을 두어 떨어뜨린다(순서 칸이 하나도 없으면 줄도 없다). */}
            {hold && ordered.length > 0 ? (
              <span
                aria-hidden="true"
                data-testid="dashboard-stage-divider"
                style={{
                  flex: 'none',
                  width: 1,
                  height: stageCell.dividerHeight,
                  margin: '0 1px',
                  background: stageCell.divider,
                }}
              />
            ) : null}
            <button
              type="button"
              aria-pressed={on}
              aria-label={label}
              onClick={() => onSelect(on ? null : band)}
              data-testid={`dashboard-stage-chip-${band}`}
              data-hold={hold ? 'true' : undefined}
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: stageCell.cellGap,
                boxSizing: 'border-box',
                height: stageCell.height,
                font: 'inherit',
                padding: stageCell.padding,
                borderRadius: stageCell.radius,
                whiteSpace: 'nowrap',
                // 보는 중인 칸은 진한 보라 바탕 + 흰 글자. 보류는 고르지 않았을 때 점선 테두리.
                border:
                  hold && !on ? `1px dashed ${stageCell.holdBorder}` : `1px solid ${look.border}`,
                background: look.bg,
                color: look.count,
              }}
            >
              <span
                data-testid={`dashboard-stage-name-${band}`}
                style={{
                  fontSize: stageCell.nameSize,
                  fontWeight: look.nameWeight,
                  color: look.name,
                }}
              >
                {stageName(band)}
              </span>
              <b
                style={{
                  fontSize: stageCell.countSize,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: look.count,
                }}
              >
                {value}
              </b>
              {entering > 0 ? (
                <span
                  title={t.stageCardEnteredHint(entering)}
                  data-testid={`dashboard-stage-entered-${band}`}
                  style={{ ...tagStyle, background: enteredTag.bg, color: enteredTag.fg }}
                >
                  {t.stageCardEntered(entering)}
                </span>
              ) : null}
              {stalled > 0 ? (
                <span
                  title={t.stageCardStalled(stalled)}
                  data-testid={`dashboard-stage-stalled-${band}`}
                  style={{
                    ...tagStyle,
                    background: stageCell.stalledTag.bg,
                    color: stageCell.stalledTag.fg,
                  }}
                >
                  {t.stageCellStalled(stalled)}
                </span>
              ) : null}
            </button>
            {hasNext ? (
              <span
                aria-hidden="true"
                data-testid="dashboard-stage-arrow"
                style={{ flex: 'none', color: stageCell.arrow, fontSize: stageCell.arrowSize }}
              >
                →
              </span>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
