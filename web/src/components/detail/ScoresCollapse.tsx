// 5. 점수 자세히 보기: 기본 접힘. 전문 용어(E/P/S/R/C)와 항목별 점수는 여기서만 보인다(BR10.9).
// 펼침/접힘은 aria-expanded와 글자로 함께 알린다(S2-8).
import { useState } from 'react';
import { Statistic } from 'antd';
import type { Scores } from '../../api/types';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  datasetKindLabels,
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
                <td style={cell}>{item.weight}</td>
                <td style={cell}>{percent(item.matchRate)}</td>
                <td style={cell}>{percent(item.certainty)}</td>
                <td style={cell}>{percent(item.decay)}</td>
                <td style={cell}>{item.score ?? '--'}</td>
                <td style={cell}>{labelFor(scoreStateLabels, item.state)}</td>
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

export default function ScoresCollapse({ scores }: { scores: Scores | null }) {
  const [open, setOpen] = useState(false);
  if (!scores) return null;
  return (
    <section
      aria-labelledby="detail-scores-heading"
      data-testid="detail-scores"
      style={{
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 8,
        padding: spacing.cardPadding,
        display: 'grid',
        gap: 12,
      }}
    >
      <h2
        id="detail-scores-heading"
        style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls="detail-scores-body"
          onClick={() => setOpen((value) => !value)}
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
            width: '100%',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>{detailSections.scores}</span>
          <span style={{ fontWeight: 400, color: colors.textSecondary }}>
            {open ? scoreDetails.collapse : scoreDetails.expand}{' '}
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </span>
        </button>
      </h2>
      <div id="detail-scores-body" hidden={!open} data-testid="detail-scores-body">
        {open ? <Details scores={scores} /> : null}
      </div>
    </section>
  );
}
