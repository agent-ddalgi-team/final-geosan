// 1. 추천 이유와 다음 할 일 + 확인 질문(3개까지 보이고 나머지는 펼치기). interaction-spec 2.7.
// [거산 확인 요청]·질문 직접 추가는 뒤 단위(P1)라 만들지 않는다.
import { useState } from 'react';
import { Button } from 'antd';
import type { Reasons, ScoreItemView } from '../../api/types';
import StatusTag from '../common/StatusTag';
import DetailSection from './DetailSection';
import {
  cardRows,
  detailSections,
  itemShortLabels,
  labelFor,
  questionRows,
  questionStatusLabels,
  questionStatusTone,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

/** 처음부터 보이는 질문 수. */
export const VISIBLE_QUESTIONS = 3;

/** 요약이 있는 항목만, 점수 표와 같은 순서로. 추정 항목(강한·약한)은 이름 뒤에 "(추정)"을 붙인다. */
function summaryLines(items: ScoreItemView[] | undefined): { key: string; text: string }[] {
  return (items ?? [])
    .filter((item) => item.summary)
    .map((item) => {
      const estimate = item.state === 'STRONG' || item.state === 'WEAK';
      return {
        key: item.itemCode,
        text: `${itemShortLabels[item.itemCode] ?? item.label}${estimate ? detailSections.estimateMark : ''}: ${item.summary}`,
      };
    });
}

export default function ReasonsSection({
  reasons,
  scoreItems,
}: {
  reasons: Reasons;
  scoreItems?: ScoreItemView[];
}) {
  const [expanded, setExpanded] = useState(false);
  const { questions } = reasons;
  const hidden = Math.max(0, questions.length - VISIBLE_QUESTIONS);
  const shown = expanded ? questions : questions.slice(0, VISIBLE_QUESTIONS);
  const lines = summaryLines(scoreItems);

  return (
    <DetailSection id="detail-reasons" title={detailSections.reasons}>
      <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
        {lines.length > 0 ? (
          <li data-testid="detail-reason">
            {cardRows.reason}
            <ul
              data-testid="detail-reason-lines"
              style={{ margin: '4px 0 0', paddingLeft: 20, display: 'grid', gap: 4 }}
            >
              {lines.map((line) => (
                <li key={line.key} data-testid="detail-reason-line">
                  {line.text}
                </li>
              ))}
            </ul>
          </li>
        ) : (
          <li data-testid="detail-reason">
            {cardRows.reason}: {reasons.reason}
          </li>
        )}
        <li data-testid="detail-next-action">
          {cardRows.nextAction}: {reasons.nextAction}
        </li>
      </ul>
      {questions.length > 0 ? (
        <div data-testid="detail-questions">
          <h3 style={{ margin: '0 0 4px', fontSize: typography.fontSize, fontWeight: 600 }}>
            {detailSections.questionsHeading}
          </h3>
          <p
            data-testid="detail-questions-hint"
            style={{
              margin: '0 0 8px',
              color: colors.textSecondary,
              fontSize: typography.fontSizeSecondary,
            }}
          >
            {detailSections.questionsHint}
          </p>
          <ul
            id="detail-questions-list"
            style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}
          >
            {shown.map((question) => (
              <li key={question.questionId} data-testid="detail-question">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span>{question.text}</span>
                  <StatusTag tone={questionStatusTone[question.status] ?? 'neutral'}>
                    {labelFor(questionStatusLabels, question.status)}
                  </StatusTag>
                </div>
                <div
                  style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
                >
                  {questionRows.effectPrefix}: {question.effectIfAnswered}
                </div>
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <Button
              type="link"
              aria-expanded={expanded}
              aria-controls="detail-questions-list"
              onClick={() => setExpanded((open) => !open)}
              style={{ paddingLeft: 0 }}
              data-testid="detail-questions-toggle"
            >
              {expanded ? detailSections.collapseQuestions : detailSections.expandQuestions(hidden)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </DetailSection>
  );
}
