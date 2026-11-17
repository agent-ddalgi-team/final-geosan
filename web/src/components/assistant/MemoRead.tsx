// 메모 읽기(#720, PM 결정 2026-11-14): 방금 저장한 메모 줄 아래의 [AI가 메모 읽기 💰] 단추.
// 누르면 그 아래에 "AI가 메모에서 읽은 것 · 확인 전" + 한 줄 요약 + 제안 줄이 펴진다.
// 예: "공정: 아연도금 → 니켈도금 (메모: '니켈도금으로 바꾸고 싶다고 함') [반영]"
// 서버는 이름·전화를 지운 메모 사본만 AI에 보내고 아무 값도 바꾸지 않는다. 비용이 드는 일이라 저절로 부르지 않는다.
// [반영]은 새 창구가 아니라 기존 저장 창구를 그대로 부른다: 공정·다음 일정 = 영업 기록 저장, 산업 = 산업군 저장.
// 제안은 서버에 저장되지 않는다. 화면을 새로 고치면 사라지고, 다시 누르면 다시 받는다. 모달·서랍 없음.
import { useState } from 'react';
import { Button } from 'antd';
import { assistantConfigOf, postMemoRead } from '../../api/assistant';
import type { MemoProposal, MemoReadAnswer } from '../../api/assistant';
import { ApiError, getActivity, postIndustries, postOutcome } from '../../api/client';
import type { OutcomeRecord, OutcomeRequest } from '../../api/types';
import { errorTexts, memoReadTexts as texts } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

/** 방금 저장한 메모. 접촉 기록은 저장 응답에 기록 번호가 없어 저장 시각으로 활동 이력에서 찾는다. */
export type MemoTarget =
  { recordKind: 'NOTE'; recordId: string } | { recordKind: 'OUTCOME'; savedAt: string };

export interface MemoReadProps {
  oppId: string;
  target: MemoTarget | null;
  /** 지금 영업 단계·거절 이유(기존 저장 창구가 요구하는 값). */
  outcome: OutcomeRecord | null;
  /** 꼬리 질문 파일의 공정 확인 질문 id. 없으면 공정 제안은 반영할 수 없다. */
  processQuestionId: string | null;
  /** 반영이 끝나면 알린다. 영업 기록을 저장했으면 그 저장본을 함께 준다. */
  onApplied: (kind: MemoProposal['kind'], saved: OutcomeRecord | null) => void;
}

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

async function resolveRecordId(oppId: string, target: MemoTarget): Promise<string | null> {
  if (target.recordKind === 'NOTE') return target.recordId;
  const items = (await getActivity(oppId)).data.filter(
    (item) => item.recordKind === 'OUTCOME' && item.recordId && !item.cancelled,
  );
  const exact = items.find(
    (item) => new Date(item.at).getTime() === new Date(target.savedAt).getTime(),
  );
  return exact?.recordId ?? null;
}

function lineText(proposal: MemoProposal): string {
  const after =
    proposal.kind === 'NEXT_SCHEDULE'
      ? `${formatMonthDay(proposal.date) ?? proposal.date ?? ''} ${proposal.after.join(', ')}`.trim()
      : proposal.after.join(', ');
  return `${texts.kindLabel[proposal.kind]}: ${texts.change(proposal.before.join(', '), after)}`;
}

export default function MemoRead({
  oppId,
  target,
  outcome,
  processQuestionId,
  onApplied,
}: MemoReadProps) {
  const { config, staffKey, canRecord } = useFrame();
  const settings = assistantConfigOf(config);
  const [reading, setReading] = useState(false);
  const [answer, setAnswer] = useState<MemoReadAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<MemoProposal['kind'] | null>(null);
  const [applied, setApplied] = useState<MemoProposal['kind'][]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);

  if (!settings?.enabled || !target) return null;

  const read = async () => {
    if (!staffKey || !canRecord || reading) return;
    setReading(true);
    setError(null);
    setAnswer(null);
    setApplied([]);
    setApplyError(null);
    try {
      const recordId = await resolveRecordId(oppId, target);
      if (!recordId) {
        setError(texts.notFound);
        return;
      }
      const envelope = await postMemoRead(oppId, target.recordKind, recordId, staffKey);
      setAnswer(envelope.data);
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.failed} (${detail})`);
    } finally {
      setReading(false);
    }
  };

  /** 기존 저장 창구가 요구하는 지금 단계(거절이면 거절 이유 코드도)를 그대로 싣는다. */
  const keepStage = (): OutcomeRequest => ({
    status: outcome?.status ?? 'NOT_EXECUTED',
    ...(outcome?.status === 'LOST' && outcome.lostReasonCode
      ? { lostReasonCode: outcome.lostReasonCode }
      : {}),
  });

  const apply = async (proposal: MemoProposal) => {
    if (!staffKey || !canRecord || applying) return;
    setApplying(proposal.kind);
    setApplyError(null);
    try {
      let saved: OutcomeRecord | null = null;
      if (proposal.kind === 'INDUSTRY') {
        await postIndustries(oppId, proposal.values, staffKey);
      } else {
        const body: OutcomeRequest =
          proposal.kind === 'PROCESS'
            ? {
                ...keepStage(),
                answers: proposal.values.map((answerId) => ({
                  questionId: processQuestionId ?? '',
                  answerId,
                })),
              }
            : {
                ...keepStage(),
                nextScheduleAt: proposal.date ?? '',
                nextScheduleNote: proposal.after[0] ?? '',
              };
        const envelope = await postOutcome(oppId, body, staffKey);
        saved = {
          version: envelope.data.version,
          updatedBy: envelope.data.updatedBy,
          updatedAt: envelope.data.updatedAt,
          status: envelope.data.status ?? body.status,
          lostReasonCode: body.lostReasonCode ?? null,
          nextScheduleAt:
            envelope.data.nextScheduleAt ?? body.nextScheduleAt ?? outcome?.nextScheduleAt ?? null,
          nextScheduleNote:
            envelope.data.nextScheduleNote ??
            body.nextScheduleNote ??
            outcome?.nextScheduleNote ??
            null,
        };
      }
      setApplied((done) => [...done, proposal.kind]);
      onApplied(proposal.kind, saved);
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setApplyError(`${texts.applyFailed} (${detail})`);
    } finally {
      setApplying(null);
    }
  };

  return (
    <div data-testid="memo-read" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button
          data-testid="memo-read-button"
          onClick={() => void read()}
          loading={reading}
          disabled={!canRecord}
        >
          {texts.button}
        </Button>
        <span data-testid="memo-read-hint" style={secondary}>
          {reading ? texts.reading : texts.buttonHint}
        </span>
      </div>
      {error ? (
        <p data-testid="memo-read-error" role="alert" style={{ margin: 0, color: colors.error }}>
          {error}
        </p>
      ) : null}
      {answer ? (
        <div
          data-testid="memo-read-answer"
          aria-live="polite"
          style={{
            display: 'grid',
            gap: 8,
            padding: 12,
            border: `1px solid ${colors.borderSecondary}`,
            borderRadius: 8,
            background: colors.bgLayout,
          }}
        >
          <span
            data-testid="memo-read-title"
            style={{
              justifySelf: 'start',
              padding: '2px 8px',
              borderRadius: 4,
              background: statusPalette.wait.bg,
              color: statusPalette.wait.fg,
              fontSize: typography.fontSizeSecondary,
            }}
          >
            {texts.title}
          </span>
          {answer.summary ? (
            <p data-testid="memo-read-summary" style={{ margin: 0 }}>
              {answer.summary}
            </p>
          ) : null}
          {answer.proposals.length === 0 ? (
            <span data-testid="memo-read-empty" style={secondary}>
              {texts.noProposals}
            </span>
          ) : (
            answer.proposals.map((proposal) => {
              const done = applied.includes(proposal.kind);
              const blocked = proposal.kind === 'PROCESS' && !processQuestionId;
              return (
                <div
                  key={proposal.kind}
                  data-testid={`memo-read-proposal-${proposal.kind}`}
                  style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
                >
                  <span>{lineText(proposal)}</span>
                  <span style={secondary}>{texts.quote(proposal.quote)}</span>
                  {done ? (
                    <span data-testid={`memo-read-applied-${proposal.kind}`}>{texts.applied}</span>
                  ) : blocked ? (
                    <span style={secondary}>{texts.cannotApply}</span>
                  ) : (
                    <Button
                      size="small"
                      data-testid={`memo-read-apply-${proposal.kind}`}
                      onClick={() => void apply(proposal)}
                      loading={applying === proposal.kind}
                      disabled={!canRecord || applying !== null}
                    >
                      {texts.apply}
                    </Button>
                  )}
                </div>
              );
            })
          )}
          {applyError ? (
            <span data-testid="memo-read-apply-error" role="alert" style={{ color: colors.error }}>
              {applyError}
            </span>
          ) : null}
          {answer.removedNames + answer.removedContacts > 0 ? (
            <span data-testid="memo-read-removed" style={secondary}>
              {texts.removed(answer.removedNames, answer.removedContacts)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
