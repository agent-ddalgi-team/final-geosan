// 3. 점수 자세히 보기: 기본 접힘. 전문 용어(E/P/S/R/C)와 항목별 점수는 여기서만 보인다(BR10.9).
// 펼침/접힘은 aria-expanded와 글자로 함께 알린다(S2-8).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Statistic } from 'antd';
import type { Scores } from '../../api/types';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  datasetKindLabels,
  detailReport,
  detailSections,
  labelFor,
  scoreDetails,
  scoreStateLabels,
} from '../../labels/ko';
import { formatMonthDayTime } from '../../utils/time';

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '--' : `${Math.round(value * 100)}%`;
}

const cell = {
  padding: '6px 10px',
  textAlign: 'left',
  borderBottom: `1px solid ${colors.borderSecondary}`,
} as const;

// 숫자·상태 칸은 짧아서 칸이 좁아지면 "미확보"가 세로로 꺾인다. 한 줄로 둔다.
const shortCell = { ...cell, whiteSpace: 'nowrap' } as const;

function Details({ scores }: { scores: Scores }) {
  const columns = scoreDetails.itemColumns;
  const evaluated = formatMonthDayTime(scores.evaluatedAt);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32 }}>
        <Statistic title={scoreDetails.E} value={scores.E} data-testid="score-e" />
        <Statistic title={scoreDetails.P} value={scores.P} data-testid="score-p" />
        <Statistic
          title={scoreDetails.S}
          value={scores.S ?? '--'}
          precision={scores.S === null ? undefined : 1}
          data-testid="score-s"
        />
        <Statistic title={scoreDetails.R} value={scores.R} data-testid="score-r" />
        <Statistic title={scoreDetails.C} value={scores.C} suffix="%" data-testid="score-c" />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table
          data-testid="score-items-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: typography.fontSizeSecondary,
          }}
        >
          <thead>
            <tr>
              {Object.values(columns).map((name) => (
                <th
                  key={name}
                  scope="col"
                  style={{ ...cell, background: colors.bgLayout, whiteSpace: 'nowrap' }}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scores.items.map((item) => (
              <tr key={item.itemCode} data-testid="score-item-row">
                <th scope="row" style={{ ...cell, fontWeight: 400 }}>
                  {item.label}
                  {item.factJudged ? (
                    <div style={{ color: colors.textSecondary }}>{item.factJudged}</div>
                  ) : null}
                </th>
                <td style={shortCell}>{item.weight}</td>
                <td style={shortCell}>{percent(item.matchRate)}</td>
                <td style={shortCell}>{percent(item.certainty)}</td>
                <td style={shortCell}>{percent(item.decay)}</td>
                <td style={shortCell}>{item.score ?? '--'}</td>
                <td style={shortCell}>{labelFor(scoreStateLabels, item.state)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div data-testid="score-footer" style={{ color: colors.textSecondary }}>
        {scoreDetails.ruleVersionPrefix} {scores.ruleVersion} · {scoreDetails.datasetPrefix}:{' '}
        {labelFor(datasetKindLabels, scores.datasetKind)}
        {evaluated ? ` · ${scoreDetails.evaluatedPrefix} ${evaluated}` : ''}
      </div>
    </div>
  );
}

export interface ScoresCollapseProps {
  scores: Scores | null;
  /** 머리의 점수 글자(서버 scoreDisplay, 예: "참고 72점 · 5/8"). 제목 줄 요약에 점수 부분만 쓴다. */
  scoreDisplay?: string;
  /** 접힌 안쪽 맨 위에 넣을 것(#674: AI 점수 입력 제안의 [확정]·[고치기]). 있으면 점수가 없어도 펼칠 수 있다. */
  children?: ReactNode;
  /** 펼침 상태를 바깥에서 쥘 때(제안을 확정해 상세를 다시 불러와도 펼친 채로 두려고). 안 주면 스스로 쥔다. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** 근거가 없다는 뜻의 항목 상태(자료 미확보·신호 없음). */
const NO_EVIDENCE_STATES = new Set(['UNAVAILABLE', 'NO_SIGNAL']);

/** 제목 줄 요약: "참고 72점 · 8항목 중 5항목 근거 있음". 점수가 없으면 "점수 전". */
export function scoreSummaryText(scores: Scores | null, scoreDisplay?: string): string {
  if (!scores) return detailReport.scores.before;
  // 서버 글자 "참고 72점 · 5/8"에서 점수 부분만 쓴다. 모양이 다르면 평가점수 E로 적는다.
  const head = scoreDisplay?.split(' · ')[0]?.trim();
  const scoreText = head && /점$/.test(head) ? head : `${scores.E}점`;
  const withEvidence = scores.items.filter((item) => !NO_EVIDENCE_STATES.has(item.state)).length;
  return detailReport.scores.summary(scoreText, scores.items.length, withEvidence);
}

export default function ScoresCollapse({
  scores,
  scoreDisplay,
  children,
  open: openProp,
  onOpenChange,
}: ScoresCollapseProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const toggle = () => {
    setOwnOpen(!open);
    onOpenChange?.(!open);
  };
  const hasBody = scores !== null || Boolean(children);
  const summary = scoreSummaryText(scores, scoreDisplay);
  const sectionStyle = {
    background: colors.bgContainer,
    border: `1px solid ${colors.borderSecondary}`,
    borderRadius: 8,
    padding: spacing.cardPadding,
    display: 'grid',
    gap: 12,
  } as const;
  const headingStyle = {
    margin: 0,
    fontSize: typography.fontSizeCardTitle,
    fontWeight: 600,
  } as const;
  const summaryStyle = {
    fontWeight: 400,
    fontSize: typography.fontSize,
    color: colors.textSecondary,
  } as const;
  if (!hasBody) {
    // 점수도 제안도 없으면 펼칠 것이 없다. 제목과 "점수 전"만 보인다.
    return (
      <section
        aria-labelledby="detail-scores-heading"
        data-testid="detail-scores"
        style={sectionStyle}
      >
        <h2
          id="detail-scores-heading"
          style={{ ...headingStyle, display: 'flex', flexWrap: 'wrap', gap: 12 }}
        >
          <span>{detailSections.scores}</span>
          <span style={summaryStyle} data-testid="detail-scores-summary">
            {summary}
          </span>
        </h2>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="detail-scores-heading"
      data-testid="detail-scores"
      style={sectionStyle}
    >
      <h2 id="detail-scores-heading" style={headingStyle}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="detail-scores-body"
          onClick={toggle}
          data-testid="detail-scores-toggle"
          style={{
            // 초점선(:focus-visible)을 지우지 않도록 all: inherit를 쓰지 않고 필요한 것만 맞춘다.
            background: 'none',
            border: 0,
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            flexWrap: 'wrap',
            width: '100%',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}
          >
            <span>{detailSections.scores}</span>
            <span style={summaryStyle} data-testid="detail-scores-summary">
              {summary}
            </span>
          </span>
          <span style={{ fontWeight: 400, color: colors.textSecondary }}>
            {open ? scoreDetails.collapse : scoreDetails.expand}{' '}
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </span>
        </button>
      </h2>
      <div id="detail-scores-body" hidden={!open} data-testid="detail-scores-body">
        {open ? (
          <div style={{ display: 'grid', gap: 16 }}>
            {children}
            {scores ? <Details scores={scores} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
