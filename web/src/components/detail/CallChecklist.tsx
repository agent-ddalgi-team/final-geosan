// "2. 통화에서 확인할 것"(#674, PM 결정 2026-11-13): 전의 검토사항을 읽기만 하는 목록으로 바꿨다.
// 확인이 필요한 것만 통화 때 물을 말로 한 줄씩 적는다. 꼬리 질문 파일(GET /sales-questions)에 같은 질문이 있으면 그 문구를 쓴다
// (공정 → "어떤 공정을 맡길 수 있나요?", 지금 세부 단계에서 아직 답이 없는 꼬리 질문). 없으면 서버가 준 문장 그대로다.
// 줄마다 있던 [붙여넣고 조사]·[메모 적기]·체크·[답 적기]와 AI 공정 제안 줄·[확정]은 화면에서 뺐다(서버 창구는 그대로 있다).
// 적는 것은 아래 "기록 남기기"의 꼬리 질문과 한 줄 메모에서 한다. 이미 저장돼 있는 답·메모·확인 표시는 그 줄 아래에 읽기 전용으로 보인다.
// "근거 없음" 줄은 접어 두고, 그 가운데 공고(SIG_BID)·채용(SIG_HIRE)은 연결하지 않는 자료라 보이지 않는다(기록이 달린 줄은 보인다).
// AI 점수 입력 제안의 [확정]·[고치기]는 "3. 점수 자세히 보기" 안으로 옮겼다.
import { useState } from 'react';
import { Button } from 'antd';
import type {
  DetailHeader,
  ProcessLinkView,
  Reasons,
  RequirementCheckView,
  ReviewItem,
  SalesQuestions,
  SalesStepView,
  ScoreItemView,
} from '../../api/types';
import { detailReport, detailSections, reviewArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { useFrame } from '../frame/FrameContext';
import { linkifyMemo } from '../review/GapMemoEditor';
import { isGapLine, isProposal, reviewGroupOf } from '../review/ReviewArea';
import DetailSection from './DetailSection';
import { detailCheckWordsOf } from './DetailGlance';

const texts = detailReport.call;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

/** 연결하지 않는 자료(나라장터 공고·채용 공고)의 "근거 없음" 줄. 기록이 없으면 화면에 보이지 않는다. */
const HIDDEN_GAP_IDS = new Set(['GAP:ITEM:SIG_BID', 'GAP:ITEM:SIG_HIRE']);
/** 평가 규칙이 후속 조치 문장 끝에 붙이는 "자료 미확보: 소재·납품실적·…" 조각의 머리말. 접힌 "근거 없음" 묶음이 같은 내용이다. */
const MISSING_PREFIX = '자료 미확보:';

export interface CallLine {
  key: string;
  /** 줄 앞 낱말(공정·소재·산업·후속 조치). 꼬리 질문·검토 줄에는 없다. */
  topic?: string;
  text: string;
}

/** 후속 조치 문장에서 "자료 미확보: …" 조각을 뺀 나머지. 남는 말이 없으면 null. */
export function nextActionWithoutMissing(nextAction: string): string | null {
  const rest = nextAction
    .split(' · ')
    .filter((part) => !part.trim().startsWith(MISSING_PREFIX))
    .join(' · ')
    .trim();
  return rest === '' ? null : rest;
}

/** 검토 줄이 아닌, 회사 값에서 만든 "물을 말" 줄(후속 조치 → 공정 → 소재 → 산업 → 아직 답이 없는 꼬리 질문). */
export function callLinesOf(
  detail: {
    header: DetailHeader;
    reasons: Reasons;
    processLinks: ProcessLinkView[];
    reviewItems: ReviewItem[];
    requirements: RequirementCheckView[];
    salesStep: SalesStepView | null | undefined;
  },
  questions: SalesQuestions | null,
): CallLine[] {
  const lines: CallLine[] = [];
  const nextAction = nextActionWithoutMissing(detail.reasons.nextAction);
  if (nextAction) lines.push({ key: 'next-action', topic: texts.nextAction, text: nextAction });
  const check = detailCheckWordsOf(
    detail.header,
    detail.processLinks,
    detail.reviewItems,
    detail.requirements,
  );
  const choiceText = (choices: 'PROCESS' | 'INDUSTRY', fallback: string) =>
    questions?.questions.find((question) => question.choices === choices)?.text ?? fallback;
  if (check.process) {
    lines.push({
      key: 'process',
      topic: texts.topic.process,
      text: choiceText('PROCESS', texts.processFallback),
    });
  }
  if (check.material) {
    lines.push({ key: 'material', topic: texts.topic.material, text: texts.materialQuestion });
  }
  const industrySource = detail.header.industriesSource;
  if (industrySource !== 'CASE_FILE' && industrySource !== 'STAFF') {
    lines.push({
      key: 'industry',
      topic: texts.topic.industry,
      text: choiceText('INDUSTRY', texts.industryFallback),
    });
  }
  const seen = new Set(lines.map((row) => row.text));
  for (const id of detail.salesStep?.openQuestions ?? []) {
    const question = questions?.questions.find((row) => row.questionId === id);
    // 모든 단계 질문과 접촉 자체에 대한 질문(누가 먼저 연락했나 #691)은 통화에서 물을 말이 아니다.
    if (!question || question.step === 'ALL' || seen.has(question.text)) continue;
    seen.add(question.text);
    lines.push({ key: `open:${id}`, text: question.text });
  }
  return lines;
}

/**
 * "2. 통화에서 확인할 것"에 보이는 줄 수(접힌 "근거 없음" 줄은 빼고). "한눈에 › 확인할 것"이 같은 기준을 쓰게 한다(#691):
 * 아래 목록에 줄이 있는데 위에서 "지금 확인할 것 없음"이라고 하지 않는다.
 */
export function callCheckCountOf(
  detail: Parameters<typeof callLinesOf>[0],
  questions: SalesQuestions | null,
): number {
  const askRows = detail.reviewItems.filter(
    (item) => !isProposal(item) && reviewGroupOf(item) === 'ask',
  );
  return callLinesOf(detail, questions).length + askRows.length;
}

export interface CallChecklistProps {
  header: DetailHeader;
  reasons: Reasons;
  processLinks: ProcessLinkView[];
  reviewItems: ReviewItem[];
  requirements: RequirementCheckView[];
  salesStep: SalesStepView | null | undefined;
  scoreItems?: ScoreItemView[];
  /** 서버 질문 파일. 못 받았으면 null(화면 문구로 대신한다). */
  questions: SalesQuestions | null;
}

export default function CallChecklist({
  header,
  reasons,
  processLinks,
  reviewItems,
  requirements,
  salesStep,
  scoreItems = [],
  questions,
}: CallChecklistProps) {
  const { config } = useFrame();
  const [gapOpen, setGapOpen] = useState(false);
  const lines = callLinesOf(
    { header, reasons, processLinks, reviewItems, requirements, salesStep },
    questions,
  );
  // AI 제안 줄은 여기서 보이지 않는다: 점수 입력 제안은 "3. 점수 자세히 보기" 안, 공정 제안은 "한눈에"의 공정 줄.
  const rows = reviewItems.filter((item) => !isProposal(item));
  const askRows = rows.filter((item) => reviewGroupOf(item) === 'ask');
  const gapRows = rows.filter(
    (item) => reviewGroupOf(item) === 'gap' && !HIDDEN_GAP_IDS.has(item.itemId),
  );
  const summaryOf = (item: ReviewItem) =>
    item.itemId.startsWith('GAP:ITEM:')
      ? (scoreItems.find((row) => `GAP:ITEM:${row.itemCode}` === item.itemId)?.summary ?? null)
      : null;

  function personName(key: string | null | undefined): string {
    if (!key) return '';
    return config?.staff.find((entry) => entry.key === key)?.displayName ?? key;
  }

  function renderReviewRow(item: ReviewItem) {
    const who = personName(item.checkedBy);
    const when = formatMonthDay(item.checkedAt);
    const summary = summaryOf(item);
    return (
      <li key={item.itemId} data-testid="review-item">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
          <StatusTag tone={isGapLine(item) ? 'wait' : 'ask'} data-testid="review-tag">
            {reviewArea.tag(item.kind, item.targetLabel)}
          </StatusTag>
          <span data-testid="review-text">{item.text}</span>
        </div>
        {summary ? (
          <div data-testid="review-gap-summary" style={{ ...secondary, marginLeft: 12 }}>
            {summary}
          </div>
        ) : null}
        {item.replyText ? (
          <div data-testid="review-reply" style={{ marginLeft: 12 }}>
            <span>
              {reviewArea.replyPrefix} {item.replyText}
            </span>
            {personName(item.repliedBy) && formatMonthDay(item.repliedAt) ? (
              <span data-testid="review-replied-by" style={secondary}>
                {' — '}
                {reviewArea.repliedBy(
                  personName(item.repliedBy),
                  formatMonthDay(item.repliedAt) ?? '',
                )}
              </span>
            ) : null}
          </div>
        ) : null}
        {item.note ? (
          <div data-testid="review-memo" style={{ marginLeft: 12 }}>
            <span>
              {reviewArea.memoPrefix} {linkifyMemo(item.note.text)}
            </span>
            {personName(item.note.by) && formatMonthDay(item.note.at) ? (
              <span data-testid="review-memo-by" style={secondary}>
                {' — '}
                {reviewArea.repliedBy(personName(item.note.by), formatMonthDay(item.note.at) ?? '')}
              </span>
            ) : null}
          </div>
        ) : null}
        {item.checked ? (
          <div data-testid="review-checked-by" style={{ ...secondary, marginLeft: 12 }}>
            {who && when ? texts.checked(who, when) : texts.checkedPlain}
          </div>
        ) : null}
      </li>
    );
  }

  const empty = lines.length === 0 && askRows.length === 0;
  const listStyle = { margin: 0, paddingLeft: 20, display: 'grid', gap: 8 } as const;

  return (
    <DetailSection id="detail-review" title={detailSections.callChecklist}>
      <span style={secondary} data-testid="call-hint">
        {texts.hint}
      </span>
      {empty ? (
        <p data-testid="call-empty" style={{ margin: 0 }}>
          {texts.empty}
        </p>
      ) : (
        <ul aria-label={texts.listLabel} data-testid="call-list" style={listStyle}>
          {lines.map((row) => (
            <li key={row.key} data-testid="call-line" data-line={row.key}>
              {row.topic ? <strong>{row.topic} — </strong> : null}
              {row.text}
            </li>
          ))}
          {askRows.map(renderReviewRow)}
        </ul>
      )}
      {gapRows.length > 0 ? (
        <div data-testid="review-fold-gap" style={{ display: 'grid', gap: 8 }}>
          <div>
            <Button
              size="small"
              aria-expanded={gapOpen}
              aria-controls="call-gap-list"
              onClick={() => setGapOpen((open) => !open)}
              data-testid="review-fold-toggle-gap"
            >
              {texts.gapHead(gapRows.length, gapOpen)}
            </Button>
          </div>
          {gapOpen ? (
            <ul id="call-gap-list" aria-label={texts.gapListLabel} style={listStyle}>
              {gapRows.map(renderReviewRow)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </DetailSection>
  );
}
