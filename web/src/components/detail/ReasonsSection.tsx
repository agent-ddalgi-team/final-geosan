// 1. 추천 이유와 다음 할 일 + 확인 질문(3개까지 보이고 나머지는 펼치기). interaction-spec 2.7.
// [거산 확인 요청]·질문 직접 추가는 뒤 단위(P1)라 만들지 않는다.
import { useState } from 'react';
import { Button } from 'antd';
import type { EvidenceView, Reasons, ScoreItemView } from '../../api/types';
import StatusTag from '../common/StatusTag';
import { splitSourceRef } from '../common/sourceUrl';
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

interface SummaryLine {
  key: string;
  text: string;
  /** 줄 끝 괄호 안 글자를 누르면 열 원문 주소. 괄호가 없거나 주소 있는 근거가 없으면 없다. */
  link?: { before: string; label: string; after: string; href: string };
}

// 줄 끝의 "(홈페이지 ABOUT·PRODUCT)"에서 괄호 앞 / 괄호 안 / 괄호 뒤를 나눈다.
const TRAILING_PAREN = /^([\s\S]*\()([^()]*)(\)\s*)$/;

/** 그 항목의 evidenceIds 순서대로 근거를 찾아 주소가 있는 첫 번째 근거의 첫 주소. */
function firstSourceUrl(item: ScoreItemView, evidence: EvidenceView[]): string | undefined {
  for (const id of item.evidenceIds ?? []) {
    const found = evidence.find((entry) => entry.evidenceId === id);
    const href = found && splitSourceRef(found.sourceRef).find((part) => part.href)?.href;
    if (href) return href;
  }
  return undefined;
}

/** 요약이 있는 항목만, 점수 표와 같은 순서로. 추정 항목(강한·약한)은 이름 뒤에 "(추정)"을 붙인다. */
function summaryLines(items: ScoreItemView[] | undefined, evidence: EvidenceView[]): SummaryLine[] {
  return (items ?? [])
    .filter((item) => item.summary)
    .map((item) => {
      const estimate = item.state === 'STRONG' || item.state === 'WEAK';
      const text = `${itemShortLabels[item.itemCode] ?? item.label}${estimate ? detailSections.estimateMark : ''}: ${item.summary}`;
      const href = firstSourceUrl(item, evidence);
      const paren = href ? TRAILING_PAREN.exec(text) : null;
      return {
        key: item.itemCode,
        text,
        link:
          href && paren ? { before: paren[1], label: paren[2], after: paren[3], href } : undefined,
      };
    });
}

export default function ReasonsSection({
  reasons,
  scoreItems,
  evidence = [],
  hideQuestions = false,
}: {
  reasons: Reasons;
  scoreItems?: ScoreItemView[];
  evidence?: EvidenceView[];
  /** 확인 질문이 "검토사항" 영역으로 옮겨 갔으면 true(서버가 reviewItems를 줄 때). */
  hideQuestions?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { questions } = reasons;
  const hidden = Math.max(0, questions.length - VISIBLE_QUESTIONS);
  const shown = expanded ? questions : questions.slice(0, VISIBLE_QUESTIONS);
  const lines = summaryLines(scoreItems, evidence);

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
                  {line.link ? (
                    <>
                      {line.link.before}
                      <a
                        href={line.link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'underline' }}
                      >
                        {line.link.label}
                      </a>
                      {line.link.after}
                    </>
                  ) : (
                    line.text
                  )}
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
      {!hideQuestions && questions.length > 0 ? (
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
