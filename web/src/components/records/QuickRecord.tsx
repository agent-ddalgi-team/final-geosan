// 기록 남기기의 작은 조각들(#985, PM 결정 2026-11-29 시안 "기록 남기기 — 만들 흐름").
//   RecordExamples   가. 메모 칸 아래 "이렇게 적어 보세요" + 종류별 예시 글(누르는 단추가 아니라 글)
//   ContactAlert     마. 메모에 전화번호 · 이메일이 있을 때 누르기 전에 먼저 알리는 상자
//   AbsentSavedBox   나. "부재" 낱말만 적어 AI 없이 저장한 뒤: 초록 상자 + 다음 일정 칸 + [안 잡고 닫기]
//   MemoKindAsk      사. [영업 코치에게 보내기] 뒤 "어떻게 있었던 일인가요?" 통화 · 메일 · 대면 한 번 고르기
//   NoteSavedBox     사. [메모로만 저장] 뒤 "메모를 저장했습니다" + [일정 잡기] + (자식으로) [AI가 메모 읽기 유료]
// 모두 그리기만 한다. 저장 · AI 요청은 부모(RecordsArea)와 공용 일정 칸(ScheduleQuickEdit)이 한다.
// 일정 칸은 영업 홈 표 · 상세 "다음 일정"과 같은 부품이다(같은 저장 길 POST /outcomes, AI 없음).
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ContactMethod, OutcomeResponse } from '../../api/types';
import { quickRecordTexts as texts } from '../../labels/ko';
import { accent, colors, ok, radius, typography, warn } from '../../theme/tokens';
import ScheduleQuickEdit from '../schedule/ScheduleQuickEdit';
import { choiceChipStyle } from './ChoiceChips';

export type QuickKind = ContactMethod | 'MEMO';

const small = { color: colors.textDimmed, fontSize: typography.fontSizeSecondary - 1.5 } as const;
const linkStyle: CSSProperties = {
  border: 0,
  padding: 0,
  background: 'none',
  color: accent.text,
  font: 'inherit',
  fontSize: typography.fontSizeSecondary - 1,
  textDecoration: 'underline',
  cursor: 'pointer',
};

/** "이렇게 적어 보세요" + 예시 글. 종류를 바꾸면 예시도 바뀐다. */
export function RecordExamples({ kind }: { kind: QuickKind }) {
  return (
    <div data-testid="quick-examples" style={{ ...small, display: 'grid', gap: 4 }}>
      <span>{texts.examplesTitle}</span>
      <ul
        aria-label={texts.examplesTitle}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {texts.examples[kind].map((example) => (
          <li
            key={example}
            data-testid="quick-example"
            style={{
              padding: '2px 8px',
              borderRadius: radius.tag,
              background: colors.bgLayout,
              color: colors.textSecondary,
            }}
          >
            {example}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 전화번호 · 이메일이 있을 때의 알림 상자. 단추를 누르기 전에 보인다. */
export function ContactAlert() {
  return (
    <div
      role="alert"
      data-testid="quick-contact-alert"
      style={{
        padding: '10px 12px',
        border: `1px solid ${warn.border}`,
        borderRadius: radius.control,
        background: warn.bg,
        color: warn.text,
        fontSize: typography.fontSizeSecondary,
        lineHeight: 1.55,
      }}
    >
      <strong>{texts.contactAlertTitle}</strong>
      <br />
      {texts.contactAlertBody}
    </div>
  );
}

export interface AbsentSavedBoxProps {
  oppId: string;
  method: ContactMethod;
  /** "통화 · 발신 · 연결 안 됨 · 11/29" */
  line: string;
  currentScheduleAt: string | null;
  currentScheduleNote: string | null;
  /** 일정을 저장했을 때(상자를 닫고 화면 값을 다시 맞춘다). */
  onScheduleSaved: (saved: OutcomeResponse) => void;
  /** 그 사이 다른 기록이 저장돼 막혔을 때 [다시 읽기]. */
  onReload?: () => void;
  onClose: () => void;
}

export function AbsentSavedBox({
  oppId,
  method,
  line,
  currentScheduleAt,
  currentScheduleNote,
  onScheduleSaved,
  onReload,
  onClose,
}: AbsentSavedBoxProps) {
  return (
    <div
      data-testid="quick-absent-saved"
      style={{
        display: 'grid',
        gap: 6,
        padding: 12,
        border: `1px solid ${ok.border}`,
        borderRadius: radius.control,
        background: ok.bg,
      }}
    >
      <strong role="status" style={{ color: ok.text }}>
        {texts.absentSavedTitle}
      </strong>
      <span data-testid="quick-absent-line">{line}</span>
      <span style={{ ...small, color: colors.textSecondary }}>
        {texts.absentAskSchedule[method]}
      </span>
      <ScheduleQuickEdit
        oppId={oppId}
        currentScheduleAt={currentScheduleAt}
        currentScheduleNote={currentScheduleNote}
        onSaved={onScheduleSaved}
        onReload={onReload}
      />
      <button
        type="button"
        onClick={onClose}
        data-testid="quick-absent-close"
        style={{ ...linkStyle, justifySelf: 'start' }}
      >
        {texts.absentClose}
      </button>
    </div>
  );
}

export interface MemoKindAskProps {
  /** 고른 종류. 아직 안 골랐으면 null. */
  value: ContactMethod | null;
  onPick: (method: ContactMethod) => void;
  disabled?: boolean;
}

const MEMO_AS_ORDER: ContactMethod[] = ['CALL', 'EMAIL', 'VISIT'];

/** [영업 코치에게 보내기] 뒤: 통화 · 메일 · 대면 가운데 하나만 고르면 바로 보낸다. */
export function MemoKindAsk({ value, onPick, disabled = false }: MemoKindAskProps) {
  return (
    <div
      data-testid="quick-memo-kind-ask"
      style={{
        display: 'grid',
        gap: 6,
        padding: '10px 12px',
        border: `1px solid ${accent.border}`,
        borderRadius: radius.control,
        background: colors.bgContainer,
      }}
    >
      <span id="quick-memo-kind-ask-label">
        {texts.kindAsk} <span style={small}>{texts.kindAskHint}</span>
      </span>
      {/* 고르는 즉시 그 종류로 보낸다. 보내기가 실패했으면 같은 단추를 다시 눌러 다시 보낼 수 있다. */}
      <div
        role="group"
        aria-labelledby="quick-memo-kind-ask-label"
        data-testid="quick-memo-kind"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
      >
        {MEMO_AS_ORDER.map((method) => (
          <button
            key={method}
            type="button"
            aria-pressed={value === method}
            disabled={disabled}
            data-value={method}
            onClick={() => onPick(method)}
            style={choiceChipStyle(value === method, disabled)}
          >
            {texts.kindLabels[method]}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface NoteSavedBoxProps {
  oppId: string;
  currentScheduleAt: string | null;
  currentScheduleNote: string | null;
  onScheduleSaved: (saved: OutcomeResponse) => void;
  onReload?: () => void;
  onClose: () => void;
  disabled?: boolean;
  /** 저장 바로 아래에 이어 보일 것([AI가 메모 읽기 유료]). */
  children?: ReactNode;
}

export function NoteSavedBox({
  oppId,
  currentScheduleAt,
  currentScheduleNote,
  onScheduleSaved,
  onReload,
  onClose,
  disabled = false,
  children,
}: NoteSavedBoxProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  return (
    <div
      data-testid="quick-note-saved"
      style={{
        display: 'grid',
        gap: 8,
        padding: 12,
        border: `1px solid ${ok.border}`,
        borderRadius: radius.control,
        background: ok.bg,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <strong role="status" style={{ color: ok.text }}>
          {texts.noteSaved}
        </strong>
        {scheduleOpen ? null : (
          <button
            type="button"
            disabled={disabled}
            aria-expanded={false}
            onClick={() => setScheduleOpen(true)}
            data-testid="quick-note-schedule"
            style={{
              padding: '4px 10px',
              borderRadius: radius.controlSm,
              border: `1px solid ${colors.border}`,
              background: colors.bgContainer,
              color: colors.text,
              font: 'inherit',
              fontSize: typography.fontSizeSecondary,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {texts.noteSchedule}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          data-testid="quick-note-saved-close"
          style={{ ...linkStyle, marginLeft: 'auto' }}
        >
          {texts.close}
        </button>
      </div>
      {scheduleOpen ? (
        <ScheduleQuickEdit
          oppId={oppId}
          currentScheduleAt={currentScheduleAt}
          currentScheduleNote={currentScheduleNote}
          onSaved={(saved) => {
            setScheduleOpen(false);
            onScheduleSaved(saved);
          }}
          onCancel={() => setScheduleOpen(false)}
          onReload={onReload}
        />
      ) : null}
      {children}
    </div>
  );
}
