// 영업 분석 맨 위 기간 선택(#760, PM 요청 2026-11-15): 둥근 칸 "📅 2026년 9월 1일 ~ 11월 15일 ⌄"를 누르면
// 바로 아래 작은 창이 열려 [전체]·[최근 30일]·[최근 3개월]·[이번 달]·[올해]를 고르거나 시작일·끝일을 직접 넣는다.
// 새 라이브러리 없이 브라우저 날짜 칸(input type=date)을 쓴다. 날짜는 한국 날짜(YYYY-MM-DD) 글자로만 다룬다.
// 고르면 바로 알리고 창을 닫는다. 직접 넣은 날짜는 [적용]을 눌러야 알린다(시작일 > 끝일이면 막는다).
import { useEffect, useRef, useState } from 'react';
import type { AnalysisPeriod } from '../../api/salesAnalysis';
import { analysisCharts as texts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { todayKst } from '../../utils/time';

export type PresetKey = keyof typeof texts.presets;
const PRESETS: PresetKey[] = ['ALL', 'DAYS_30', 'MONTHS_3', 'THIS_MONTH', 'THIS_YEAR'];

function shift(iso: string, days: number, months = 0): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d + days));
  return date.toISOString().slice(0, 10);
}

/** 미리 정한 기간 → 양끝. 오늘(한국 날짜)을 받아 계산한다(시험에서 날짜를 고정할 수 있게). */
export function presetPeriod(key: PresetKey, today: string): AnalysisPeriod {
  switch (key) {
    case 'ALL':
      return { from: null, to: null };
    case 'DAYS_30':
      return { from: shift(today, -29), to: today };
    case 'MONTHS_3':
      return { from: shift(today, 1, -3), to: today };
    case 'THIS_MONTH':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'THIS_YEAR':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

export interface PeriodPickerProps {
  value: AnalysisPeriod;
  onChange: (next: AnalysisPeriod) => void;
  /** 오늘(한국 날짜). 비우면 지금 시각으로 구한다. */
  today?: string;
}

export default function PeriodPicker({ value, onChange, today }: PeriodPickerProps) {
  const now = today ?? todayKst();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AnalysisPeriod>(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const pick = (next: AnalysisPeriod) => {
    onChange(next);
    setOpen(false);
  };
  const activePreset = PRESETS.find((key) => {
    const p = presetPeriod(key, now);
    return p.from === value.from && p.to === value.to;
  });

  const chip = (active: boolean) =>
    ({
      border: `1px solid ${active ? colors.text : colors.borderSecondary}`,
      background: active ? colors.text : colors.bgContainer,
      color: active ? colors.bgContainer : colors.text,
      borderRadius: 999,
      padding: '4px 12px',
      fontSize: typography.fontSizeSecondary,
      cursor: 'pointer',
    }) as const;
  const dateInput = {
    font: 'inherit',
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    padding: '6px 10px',
    color: colors.text,
    background: colors.bgContainer,
  } as const;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} data-testid="period-picker">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${texts.periodLabel}: ${texts.periodRange(value.from, value.to)}`}
        data-testid="period-picker-button"
        onClick={() => {
          setDraft(value);
          setOpen((v) => !v);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          border: `1px solid ${colors.borderSecondary}`,
          background: colors.bgContainer,
          color: colors.text,
          borderRadius: 999,
          padding: '8px 18px',
          font: 'inherit',
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
        }}
      >
        {/* 달력 모양 그림(글자 없음). */}
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="3"
            y="5"
            width="18"
            height="16"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M3 10h18M8 3v4M16 3v4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span data-testid="period-picker-text">{texts.periodRange(value.from, value.to)}</span>
        <span aria-hidden="true" style={{ color: colors.textSecondary }}>
          ⌄
        </span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={texts.periodLabel}
          data-testid="period-picker-panel"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            zIndex: 20,
            width: 'min(340px, 92vw)',
            boxSizing: 'border-box',
            background: colors.bgContainer,
            border: `1px solid ${colors.borderSecondary}`,
            borderRadius: 14,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
            padding: 14,
            display: 'grid',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`period-preset-${key}`}
                aria-pressed={activePreset === key}
                onClick={() => pick(presetPeriod(key, now))}
                style={chip(activePreset === key)}
              >
                {texts.presets[key]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: typography.fontSizeSecondary }}>
              {texts.periodFrom}
              <input
                type="date"
                data-testid="period-from"
                value={draft.from ?? ''}
                max={now}
                onChange={(event) => setDraft({ ...draft, from: event.target.value || null })}
                style={dateInput}
              />
            </label>
            <span aria-hidden="true" style={{ paddingBottom: 8 }}>
              ~
            </span>
            <label style={{ display: 'grid', gap: 4, fontSize: typography.fontSizeSecondary }}>
              {texts.periodTo}
              <input
                type="date"
                data-testid="period-to"
                value={draft.to ?? ''}
                max={now}
                onChange={(event) => setDraft({ ...draft, to: event.target.value || null })}
                style={dateInput}
              />
            </label>
          </div>
          {invalid ? (
            <p role="alert" data-testid="period-invalid" style={{ margin: 0, color: colors.error }}>
              {texts.periodInvalid}
            </p>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ ...chip(false), border: 0 }}
            >
              {texts.periodClose}
            </button>
            <button
              type="button"
              data-testid="period-apply"
              disabled={invalid}
              onClick={() => pick(draft)}
              style={{
                ...chip(true),
                opacity: invalid ? 0.4 : 1,
                cursor: invalid ? 'not-allowed' : 'pointer',
              }}
            >
              {texts.periodApply}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
