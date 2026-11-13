// 꼬리 질문의 공정·산업 확인(#652, PM 결정 2026-11-13): 여러 개를 고르는 질문 한 칸.
// 보기는 서버가 거산 공정 목록·설정 산업군으로 채워 준다. 이 회사에 AI가 제안했거나 확정된 값은
// 먼저 보이고 표시만 붙인다(AI 제안을 미리 골라 두지 않는다). "아직 모름"은 화면 전용이라 답을 보내지 않는다.
import { Checkbox, Tag, Typography } from 'antd';
import type { OpportunityDetail, SalesQuestion } from '../../api/types';
import { salesChoiceTexts as texts } from '../../labels/ko';
import { typography } from '../../theme/tokens';

/** "아직 모름"을 고른 상태. 서버로는 보내지 않는다. */
export const UNKNOWN_CHOICE = '__UNKNOWN__';
/** "지금 확정된 것이 맞음"을 고른 상태. 서버로는 이미 확정된 값들을 답으로 보낸다. */
export const KEEP_CHOICE = '__KEEP__';
const SPECIAL = [UNKNOWN_CHOICE, KEEP_CHOICE];
/** 회사 산업군은 3개까지(약속 C6). 서버도 같은 수로 거부한다. */
export const MAX_INDUSTRIES = 3;

/** 이 회사에 지금 붙어 있는 공정·산업군과 그 출처(상세 응답에서 뽑는다). */
export interface ChoiceMarks {
  /** 공정 코드 → AI 제안인지, 이미 확정됐는지(사례 파일·담당자). */
  process: Record<string, 'AI' | 'CONFIRMED'>;
  industries: string[];
  industriesSource: 'AI' | 'STAFF' | 'CASE_FILE' | null;
}

/** 상세 응답에서 표시를 뽑는다. AI 공정 제안은 검토사항의 "PL:<공정 코드>" 줄이다. */
export function choiceMarksOf(
  detail: Pick<OpportunityDetail, 'processLinks' | 'reviewItems' | 'header'>,
): ChoiceMarks {
  const proposed = (detail.reviewItems ?? [])
    .filter((item) => item.kind === 'PROCESS_LINK_PROPOSAL')
    .map((item) => item.itemId.replace(/^PL:/, ''));
  const process: ChoiceMarks['process'] = {};
  for (const link of detail.processLinks) process[link.processCode] = 'CONFIRMED';
  for (const code of proposed) process[code] = 'AI';
  return {
    process,
    industries: detail.header.industries ?? [],
    industriesSource: detail.header.industriesSource ?? null,
  };
}

/** 이미 확정돼 꼬리 질문에서 뺄 수 없는 값(공정만). */
function lockedValues(question: SalesQuestion, marks: ChoiceMarks | null): string[] {
  if (question.choices !== 'PROCESS' || !marks) return [];
  return question.answers
    .map((option) => option.answerId)
    .filter((id) => marks.process[id] === 'CONFIRMED');
}

/** 이미 확정된 값: 공정은 확정된 연결, 산업은 사례 파일·담당자 확정 값. */
function confirmedValues(question: SalesQuestion, marks: ChoiceMarks | null): string[] {
  if (!marks) return [];
  if (question.choices === 'PROCESS') return lockedValues(question, marks);
  if (marks.industriesSource !== 'CASE_FILE' && marks.industriesSource !== 'STAFF') return [];
  return question.answers
    .map((option) => option.answerId)
    .filter((id) => marks.industries.includes(id));
}

/** 고른 값으로 저장하면 빠질 AI 공정 제안 수. */
function droppedProposals(ids: string[], marks: ChoiceMarks | null): number {
  return Object.entries(marks?.process ?? {}).filter(
    ([code, mark]) => mark === 'AI' && !ids.includes(code),
  ).length;
}

function tagOf(question: SalesQuestion, id: string, marks: ChoiceMarks | null): string | null {
  if (!marks) return null;
  if (question.choices === 'PROCESS') {
    if (marks.process[id] === 'AI') return texts.aiTag;
    return marks.process[id] === 'CONFIRMED' ? texts.confirmedTag : null;
  }
  if (!marks.industries.includes(id)) return null;
  if (marks.industriesSource === 'AI') return texts.aiTag;
  return marks.industriesSource === 'CASE_FILE' ? texts.caseFileTag : texts.staffTag;
}

/**
 * 서버로 보낼 값. 담당자가 새로 고른 것이 없거나 "아직 모름"이면 빈 배열(답을 보내지 않는다).
 * "지금 확정된 것이 맞음"이면 이미 확정된 값들만 보낸다(아무 조작 없이 저장하면 보내지 않는다).
 * 공정은 이미 확정된 값도 같이 실어 "알아낸 것"에 함께 남긴다(서버는 확정된 연결을 그대로 둔다).
 */
export function choiceAnswerIds(
  question: SalesQuestion,
  picked: string[],
  marks: ChoiceMarks | null,
): string[] {
  if (picked.includes(KEEP_CHOICE)) return confirmedValues(question, marks);
  const chosen = picked.filter((id) => !SPECIAL.includes(id));
  if (chosen.length === 0) return [];
  const all = new Set([...lockedValues(question, marks), ...chosen]);
  return question.answers.map((option) => option.answerId).filter((id) => all.has(id));
}

/** 저장 전에 한 줄로 미리 알린다. 고른 것이 없으면 null. */
export function choicePreview(
  question: SalesQuestion,
  picked: string[],
  marks: ChoiceMarks | null,
): string | null {
  if (picked.includes(UNKNOWN_CHOICE)) return texts.unknownPreview;
  const ids = choiceAnswerIds(question, picked, marks);
  if (ids.length === 0) return null;
  const names = question.answers
    .filter((option) => ids.includes(option.answerId))
    .map((option) => option.label)
    .join(', ');
  const keep = picked.includes(KEEP_CHOICE);
  if (question.choices === 'INDUSTRY') {
    return keep ? texts.keepIndustryPreview(names) : texts.industryPreview(names);
  }
  const dropped = droppedProposals(ids, marks);
  return keep ? texts.keepProcessPreview(names, dropped) : texts.processPreview(names, dropped);
}

export interface ChoiceQuestionFieldProps {
  question: SalesQuestion;
  picked: string[];
  marks: ChoiceMarks | null;
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

export function ChoiceQuestionField({
  question,
  picked,
  marks,
  onChange,
  disabled,
}: ChoiceQuestionFieldProps) {
  const locked = lockedValues(question, marks);
  const unknown = picked.includes(UNKNOWN_CHOICE);
  const confirmed = confirmedValues(question, marks);
  // 이 회사에 붙어 있는 값(AI 제안·확정)을 먼저, 나머지는 목록 순서대로.
  const options = [
    ...question.answers.filter((option) => tagOf(question, option.answerId, marks)),
    ...question.answers.filter((option) => !tagOf(question, option.answerId, marks)),
  ];
  const full =
    question.choices === 'INDUSTRY' &&
    picked.filter((id) => !SPECIAL.includes(id)).length >= MAX_INDUSTRIES;
  const preview = choicePreview(question, picked, marks);
  const hint = { fontSize: typography.fontSizeSecondary } as const;

  function toggle(id: string, checked: boolean) {
    const rest = picked.filter((item) => item !== id && !SPECIAL.includes(item));
    onChange(checked ? [...rest, id] : rest);
  }

  return (
    <div
      role="group"
      aria-labelledby={`sales-question-label-${question.questionId}`}
      style={{ display: 'grid', gap: 4 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
        {options.map((option) => {
          const isLocked = locked.includes(option.answerId);
          const checked = isLocked || picked.includes(option.answerId);
          const tag = tagOf(question, option.answerId, marks);
          return (
            <Checkbox
              key={option.answerId}
              checked={checked}
              disabled={disabled || isLocked || (full && !checked)}
              onChange={(event) => toggle(option.answerId, event.target.checked)}
              data-testid={`sales-choice-${question.questionId}-${option.answerId}`}
            >
              {option.label}
              {tag ? (
                <Tag style={{ marginInlineStart: 4, marginInlineEnd: 0 }} bordered={false}>
                  {tag}
                </Tag>
              ) : null}
            </Checkbox>
          );
        })}
        {confirmed.length > 0 ? (
          <Checkbox
            checked={picked.includes(KEEP_CHOICE)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? [KEEP_CHOICE] : [])}
            data-testid={`sales-choice-${question.questionId}-keep`}
          >
            {texts.keep}
          </Checkbox>
        ) : null}
        <Checkbox
          checked={unknown}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? [UNKNOWN_CHOICE] : [])}
          data-testid={`sales-choice-${question.questionId}-unknown`}
        >
          {texts.unknown}
        </Checkbox>
      </div>
      <Typography.Text type="secondary" style={hint}>
        {texts.hint}
        {locked.length > 0 ? ` ${texts.lockedHint}` : ''}
        {confirmed.length > 0
          ? ` ${
              question.choices === 'PROCESS'
                ? texts.keepProcessHint(droppedProposals(confirmed, marks))
                : texts.keepIndustryHint
            }`
          : ''}
        {question.choices === 'INDUSTRY' ? ` ${texts.industryMax(MAX_INDUSTRIES)}` : ''}
      </Typography.Text>
      {preview ? (
        <span
          role="status"
          style={hint}
          data-testid={`sales-choice-preview-${question.questionId}`}
        >
          {preview}
        </span>
      ) : null}
    </div>
  );
}
