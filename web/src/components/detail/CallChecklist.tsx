// "2. 통화에서 확인할 것"(#674, PM 결정 2026-11-13): 전의 검토사항을 읽기만 하는 목록으로 바꿨다.
// 확인이 필요한 것만 통화 때 물을 말로 한 줄씩 적는다. 꼬리 질문 파일(GET /sales-questions)에 같은 질문이 있으면 그 문구를 쓴다
// (공정 → "어떤 공정을 맡길 수 있나요?", 지금 세부 단계에서 아직 답이 없는 꼬리 질문). 없으면 서버가 준 문장 그대로다.
// 줄마다 있던 [붙여넣고 조사]·[메모 적기]·체크·[답 적기]와 AI 공정 제안 줄·[확정]은 화면에서 뺐다(서버 창구는 그대로 있다).
// 적는 것은 아래 "기록 남기기"의 꼬리 질문과 한 줄 메모에서 한다. 이미 저장돼 있는 답·메모·확인 표시는 그 줄 아래에 읽기 전용으로 보인다.
// "근거 없음" 줄은 접어 두고, 그 가운데 공고(SIG_BID)·채용(SIG_HIRE)은 연결하지 않는 자료라 보이지 않는다(기록이 달린 줄은 보인다).
// AI 점수 입력 제안의 [확정]·[고치기]는 "3. 점수 자세히 보기" 안으로 옮겼다.
import { useState } from 'react';
import { Button, Checkbox } from 'antd';
import type {
  CallPrepNote,
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
import { choiceMarksOf, confirmedLabels } from '../records/ChoiceQuestion';
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
  const marks = choiceMarksOf(detail);
  for (const id of detail.salesStep?.openQuestions ?? []) {
    const question = questions?.questions.find((row) => row.questionId === id);
    // 모든 단계 질문과 접촉 자체에 대한 질문(누가 먼저 연락했나 #691)은 통화에서 물을 말이 아니다.
    if (!question || question.step === 'ALL' || seen.has(question.text)) continue;
    // #730: 공정·산업 확인 질문은 꼬리 질문에 답이 없어도(사례 파일·상세 칩·AI 제안 확정으로 정해진 경우)
    // 이미 확정된 값이 있으면 묻지 않는다. 기록 남기기의 꼬리 질문이 "공정: 아연도금" 줄을 보이는 것과 같은 판단이다.
    if (question.choices && confirmedLabels(question, marks).length > 0) continue;
    seen.add(question.text);
    lines.push({ key: `open:${id}`, text: question.text });
  }
  return lines;
}

/**
 * 확인사항에 보이는 줄 수(접힌 "근거 없음" 줄은 빼고). "한눈에 › 확인할 것"이 같은 기준을 쓰게 한다(#691):
 * 목록에 줄이 있는데 위에서 "지금 확인할 것 없음"이라고 하지 않는다. #847부터 주제별 확인사항(checkRowsOf)과 같은 줄을 센다.
 */
export function callCheckCountOf(
  detail: Parameters<typeof callLinesOf>[0],
  questions: SalesQuestions | null,
  prep: CallPrepNote | null = null,
): number {
  return checkRowsOf(detail, questions, prep).length;
}

/** #847 확인사항의 주제 묶음. */
export type CheckGroup = 'prep' | 'company' | 'demand' | 'geosan';
export const CHECK_GROUP_ORDER: CheckGroup[] = ['prep', 'company', 'demand', 'geosan'];

/** #847 확인사항 한 줄: 짧은 요약 + 처음 체크 상태(이미 확인 표시가 저장된 검토 줄만 체크된 채로 시작). */
export interface CheckRow {
  key: string;
  group: CheckGroup;
  label: string;
  item?: ReviewItem;
  checked: boolean;
}

/** 후속 조치 문장 조각 끝의 "확인"을 떼어 요약으로("도금을 외주하는지 확인" → "도금을 외주하는지"). */
function shortAction(part: string): string {
  const trimmed = part.trim();
  const cut = trimmed.replace(/\s*확인$/, '').trim();
  return cut === '' ? trimmed : cut;
}

/**
 * #847(PM 결정 2026-11-17): 확인사항을 주제 4묶음으로. 규칙으로만 나눈다(AI 아님).
 * 지난 통화에서 이어서 = 코치가 지난 통화 뒤 정리한 물어볼 것 / 회사 확인 = 후속 조치·공정·소재·산업·상대 회사 질문 /
 * 수요·진행 = 지금 단계에서 아직 답이 없는 꼬리 질문(질문 파일의 짧은 말) / 거산 쪽 확인 = 거산에 대한 질문.
 */
export function checkRowsOf(
  detail: Parameters<typeof callLinesOf>[0],
  questions: SalesQuestions | null,
  prep: CallPrepNote | null | undefined,
): CheckRow[] {
  const rows: CheckRow[] = [];
  (prep?.lines ?? []).forEach((line, index) =>
    rows.push({ key: `prep:${index}`, group: 'prep', label: line, checked: false }),
  );
  const keywordOf = (choices: 'PROCESS' | 'INDUSTRY') =>
    questions?.questions.find((question) => question.choices === choices)?.coach?.keyword ?? null;
  for (const line of callLinesOf(detail, questions)) {
    if (line.key === 'next-action') {
      // 한 문장에 여러 가지가 들어 있으면(" · "나 ", "로 이어짐) 하나씩 체크하게 나눈다.
      line.text
        .split(' · ')
        .flatMap((part) => part.split(', '))
        .forEach((part, index) =>
          rows.push({
            key: `next-action:${index}`,
            group: 'company',
            label: shortAction(part),
            checked: false,
          }),
        );
    } else if (line.key === 'process') {
      rows.push({
        key: 'process',
        group: 'company',
        label: keywordOf('PROCESS') ?? texts.short.process,
        checked: false,
      });
    } else if (line.key === 'material') {
      rows.push({ key: 'material', group: 'company', label: texts.short.material, checked: false });
    } else if (line.key === 'industry') {
      rows.push({
        key: 'industry',
        group: 'company',
        label: keywordOf('INDUSTRY') ?? texts.short.industry,
        checked: false,
      });
    } else {
      const id = line.key.replace(/^open:/, '');
      const question = questions?.questions.find((q) => q.questionId === id);
      // 공정·산업을 고르는 꼬리 질문은 회사 값을 확인하는 것이라 "회사 확인"에 둔다.
      rows.push({
        key: line.key,
        group: question?.choices ? 'company' : 'demand',
        label: question?.coach?.keyword ?? line.text,
        checked: false,
      });
    }
  }
  for (const item of detail.reviewItems) {
    if (isProposal(item) || reviewGroupOf(item) !== 'ask') continue;
    rows.push({
      key: item.itemId,
      group: item.targetLabel === '거산' ? 'geosan' : 'company',
      label: item.text,
      item,
      checked: item.checked,
    });
  }
  return rows;
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
  /** #803: 오른쪽 영업 코치 판의 "① 통화 전 — 물어볼 것"으로 놓일 때의 제목·안내. 없으면 전과 같다. */
  title?: string;
  /** null이면 안내 줄을 보이지 않는다(#847, 영업 코치 칸). */
  hint?: string | null;
  /** #847 영업 코치 칸의 "확인사항": 주제별 묶음 + 통화 중 체크칸. 없으면 전과 같은 읽기 전용 목록. */
  grouped?: boolean;
  /** #847 지난 통화 뒤 코치가 정리한 물어볼 것("지난 통화에서 이어서" 묶음). */
  prep?: CallPrepNote | null;
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
  title,
  hint,
  grouped = false,
  prep = null,
}: CallChecklistProps) {
  const { config } = useFrame();
  const [gapOpen, setGapOpen] = useState(false);
  // #847: 통화 중 체크는 화면에서만 바꾼다(저장 안 함). 처음 값은 줄마다 checkRowsOf가 정한다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
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

  /** 검토 줄 아래에 읽기 전용으로 붙는 것: 근거 없음 요약 · 저장된 답 · 메모 · 확인 표시. */
  function renderReviewExtras(item: ReviewItem) {
    const who = personName(item.checkedBy);
    const when = formatMonthDay(item.checkedAt);
    const summary = summaryOf(item);
    return (
      <>
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
      </>
    );
  }

  function renderReviewRow(item: ReviewItem) {
    return (
      <li key={item.itemId} data-testid="review-item">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
          <StatusTag tone={isGapLine(item) ? 'wait' : 'ask'} data-testid="review-tag">
            {reviewArea.tag(item.kind, item.targetLabel)}
          </StatusTag>
          <span data-testid="review-text">{item.text}</span>
        </div>
        {renderReviewExtras(item)}
      </li>
    );
  }

  const listStyle = { margin: 0, paddingLeft: 20, display: 'grid', gap: 8 } as const;

  if (grouped) {
    const rows = checkRowsOf(
      { header, reasons, processLinks, reviewItems, requirements, salesStep },
      questions,
      prep,
    );
    const isChecked = (row: CheckRow) => toggled[row.key] ?? row.checked;
    const remaining = rows.filter((row) => !isChecked(row)).length;
    const prepDate = prep ? (formatMonthDay(prep.at) ?? prep.at) : '';
    return (
      <DetailSection id="detail-review" title={title ?? texts.groups.company} count={remaining}>
        {rows.length === 0 ? (
          <p data-testid="call-empty" style={{ margin: 0 }}>
            {texts.empty}
          </p>
        ) : (
          CHECK_GROUP_ORDER.map((group) => {
            const inGroup = rows.filter((row) => row.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div
                key={group}
                data-testid={`check-group-${group}`}
                style={{ display: 'grid', gap: 4 }}
              >
                <span style={{ fontWeight: 600 }} data-testid="check-group-title">
                  {group === 'prep' && prepDate ? texts.prepGroup(prepDate) : texts.groups[group]}
                </span>
                <ul
                  aria-label={texts.groups[group]}
                  style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}
                >
                  {inGroup.map((row) => {
                    const on = isChecked(row);
                    return (
                      <li
                        key={row.key}
                        // 검토 줄은 전처럼 review-item(저장된 답·확인 표시가 아래에 붙는다), 나머지는 check-row.
                        data-testid={row.item ? 'review-item' : 'check-row'}
                        data-line={row.key}
                      >
                        <Checkbox
                          checked={on}
                          aria-label={texts.checkLabel(row.label)}
                          onChange={(event) =>
                            setToggled((previous) => ({
                              ...previous,
                              [row.key]: event.target.checked,
                            }))
                          }
                        >
                          <span
                            style={
                              on
                                ? { color: colors.textSecondary, textDecoration: 'line-through' }
                                : undefined
                            }
                          >
                            {row.label}
                          </span>
                        </Checkbox>
                        {row.item ? (
                          <div style={{ marginLeft: 12 }}>{renderReviewExtras(row.item)}</div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
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

  const empty = lines.length === 0 && askRows.length === 0;

  return (
    <DetailSection
      id="detail-review"
      title={title ?? detailSections.callChecklist}
      count={lines.length + askRows.length}
    >
      {hint === null ? null : (
        <span style={secondary} data-testid="call-hint">
          {hint ?? texts.hint}
        </span>
      )}
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
