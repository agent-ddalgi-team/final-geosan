// 대시보드 맨 위 "오늘 확인할 것"(#679, PM 결정 2026-11-13). 서버가 저장된 값으로 센 줄 목록을 그대로 보인다(AI 없음).
// #766(PM 결정 2026-11-16): 읽기 쉽게 주제별 묶음으로 나눠 제목·아이콘·회사별 한 줄로 보인다(예전에는 "앞 2건 + 외 n").
//   🔴 지난 일정 — 했나요?  회사 · 날짜 · 일정 한 줄 + [완료] [날짜 바꾸기] [필요 없어요]
//   📅 오늘 일정            회사 · 일정 한 줄
//   📬 나에게 온 전달 사항   회사 · 보낸 사람 · 날짜, 그 아래 전달 글 앞부분(#794), 오른쪽 [확인](#854)
//   🔍 확인할 것이 남은 관심 기업  회사 이름(누르면 상세), 묶음 끝 [모두 보기]는 걸러진 목록
//   📤 내가 보낸 전달 사항 · 확인 전  회사 · 받는 사람 · 날짜, 그 아래 글 앞부분(#854, 보낸 사람 본인에게만)
// #854(PM 결정 2026-11-17): 전달 사항 [확인]은 그 회사에서 나에게 온 확인 전 전달 사항을 모두 확인하고
//   (기존 확인 저장을 번호마다), 대시보드와 왼쪽 메뉴 숫자를 다시 읽는다. 보기 전용에게는 단추가 없다.
// #799: 맨 앞에 운영 알림 줄(⛔ 한도 도달 — 모든 담당자 / ⚠ AI 사용 n% · 📂 자료 갱신 — 운영 담당)과 [운영 관리 →].
// 지난 일정 단추는 기록 담당자에게만 보이고, 누르면 서버가 일정만 바꾼 새 기록과 변경 기록 한 줄을 남긴다
// (/schedule/resolve). 어느 단추든 끝나면 대시보드를 다시 읽어 그 줄이 빠진다.
// 묶음이 길면 앞 5곳만 보이고 [더 보기]로 편다. 0건인 묶음은 서버가 보내지 않는다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'antd';
import { SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import { ApiError, confirmHandoff, resolveSchedule } from '../../api/client';
import type { TodayCheckItem, TodayCheckKind, TodayCheckRow } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import { LIST_PATH } from '../../paths';
import { colors, radius, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

const SHOWN = 5;
/** 묶음 순서: 지난 일정(정리할 것)이 맨 위. */
const ORDER: TodayCheckKind[] = [
  'SCHEDULE_OVERDUE',
  'HANDOFF_FOR_ME',
  'SCHEDULE_TODAY',
  'CHECK_LEFT',
  'HANDOFF_FROM_ME',
];
const WEEKDAYS = '일월화수목금토';

function isKnownKind(kind: string): kind is TodayCheckKind {
  return kind in dashboardTexts.todayRowNames;
}

/** "11/13(목)". 날짜 글이 아니면 그대로. */
export function dayLabel(value: string | null): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${day.getMonth() + 1}/${day.getDate()}(${WEEKDAYS[day.getDay()]})`;
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

function itemKey(item: TodayCheckItem): string {
  return `${item.oppId}-${item.dueAt ?? ''}-${item.note ?? ''}`;
}

/** 지난 일정 한 줄: 회사·날짜·일정 + 세 단추. */
function OverdueItem({ item, onChanged }: { item: TodayCheckItem; onChanged: () => void }) {
  const { staffKey, canRecord } = useFrame();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const version = item.outcomeVersion;
  const usable = canRecord && staffKey !== null && typeof version === 'number';

  async function send(action: 'DONE' | 'DROPPED' | 'MOVED') {
    if (!usable || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await resolveSchedule(
        item.oppId,
        {
          action,
          expectedVersion: version,
          ...(action === 'MOVED' ? { nextScheduleAt: date } : {}),
        },
        staffKey,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? `${error.body.message} ${error.body.nextAction}`
          : dashboardTexts.todayResolveFailed,
      );
      setBusy(false);
    }
  }

  return (
    <li data-testid="dashboard-today-item" style={{ display: 'grid', gap: 6, padding: '6px 0' }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <Link to={`/opportunities/${encodeURIComponent(item.oppId)}`}>{item.customerName}</Link>
        <span style={secondary}>
          {[dayLabel(item.dueAt), item.note].filter(Boolean).join(' · ')}
        </span>
      </span>
      {usable ? (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void send('DONE')}
            data-testid="dashboard-today-done"
          >
            {dashboardTexts.todayResolveDone}
          </Button>
          <Button
            size="small"
            disabled={busy}
            aria-expanded={moving}
            onClick={() => setMoving((open) => !open)}
            data-testid="dashboard-today-move"
          >
            {dashboardTexts.todayResolveMove}
          </Button>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void send('DROPPED')}
            data-testid="dashboard-today-drop"
          >
            {dashboardTexts.todayResolveDrop}
          </Button>
        </span>
      ) : null}
      {usable && moving ? (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <label htmlFor={`today-move-${item.oppId}`} style={secondary}>
            {dashboardTexts.todayResolveNewDate}
          </label>
          <input
            id={`today-move-${item.oppId}`}
            type="date"
            min={todayIso()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            data-testid="dashboard-today-move-date"
          />
          <Button
            size="small"
            type="primary"
            disabled={busy || !date || date < todayIso()}
            onClick={() => void send('MOVED')}
            data-testid="dashboard-today-move-save"
          >
            {dashboardTexts.todayResolveMoveSave}
          </Button>
        </span>
      ) : null}
      {message ? (
        <span role="alert" style={{ color: colors.error, fontSize: typography.fontSizeSecondary }}>
          {message}
        </span>
      ) : null}
    </li>
  );
}

function PlainItem({ item, action = null }: { item: TodayCheckItem; action?: ReactNode }) {
  return (
    <li data-testid="dashboard-today-item" style={{ padding: '4px 0' }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <Link to={`/opportunities/${encodeURIComponent(item.oppId)}`}>{item.customerName}</Link>
        {item.note || item.dueAt ? (
          <span style={secondary}>{[item.note].filter(Boolean).join(' · ')}</span>
        ) : null}
        {action}
      </span>
      {item.text ? (
        // #794: 전달 사항 글 앞부분. 받는 사람(#854: 보낸 것 줄은 보낸 사람) 본인 화면에만 온다.
        <span
          data-testid="dashboard-today-text"
          style={{ display: 'block', fontSize: typography.fontSizeSecondary, marginTop: 2 }}
        >
          {item.text}
        </span>
      ) : null}
    </li>
  );
}

/** #854 나에게 온 전달 사항 한 줄: 회사·보낸 사람·날짜·글 앞부분 + 오른쪽 [확인]. */
function HandoffItem({ item }: { item: TodayCheckItem }) {
  const { staffKey, canRecord } = useFrame();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const ids = item.noteIds ?? [];
  const usable = canRecord && staffKey !== null && ids.length > 0;

  async function confirm() {
    if (!usable || busy || staffKey === null) return;
    setBusy(true);
    setMessage('');
    try {
      // 확인은 두 번 눌러도 같은 값이라, 중간에 실패해도 다시 누르면 남은 것만 바뀐다.
      for (const noteId of ids) await confirmHandoff(noteId, staffKey);
      // 대시보드(줄이 빠짐)와 왼쪽 메뉴 숫자를 함께 다시 읽는다.
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: item.oppId }));
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? `${error.body.message} ${error.body.nextAction}`
          : dashboardTexts.todayHandoffConfirmFailed,
      );
      setBusy(false);
    }
  }

  return (
    <>
      <PlainItem
        item={item}
        action={
          usable ? (
            <Button
              size="small"
              disabled={busy}
              onClick={() => void confirm()}
              aria-label={dashboardTexts.todayHandoffConfirmLabel(item.customerName)}
              data-testid="dashboard-today-handoff-confirm"
              style={{ marginLeft: 'auto' }}
            >
              {dashboardTexts.todayHandoffConfirm}
            </Button>
          ) : null
        }
      />
      {message ? (
        <li
          role="alert"
          style={{ color: colors.error, fontSize: typography.fontSizeSecondary }}
          data-testid="dashboard-today-handoff-error"
        >
          {message}
        </li>
      ) : null}
    </>
  );
}

function Group({
  row,
  kind,
  onChanged,
}: {
  row: TodayCheckRow;
  kind: TodayCheckKind;
  onChanged: () => void;
}) {
  const [all, setAll] = useState(false);
  const items = all ? row.items : row.items.slice(0, SHOWN);
  const hidden = row.items.length - items.length;
  return (
    <li
      data-testid="dashboard-today-row"
      style={{ borderTop: `1px solid ${colors.borderSecondary}`, padding: '10px 0' }}
    >
      <h3
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 8,
          margin: 0,
          fontSize: typography.fontSize,
        }}
      >
        <span aria-hidden="true">{dashboardTexts.todayRowIcons[kind]}</span>
        <strong data-testid={`dashboard-today-count-${kind}`}>
          {dashboardTexts.todayGroupTitles[kind]} {row.count}
          {dashboardTexts.todayRowUnits[kind]}
        </strong>
        {row.listFilter ? (
          <Link
            to={`${LIST_PATH}?filter=${encodeURIComponent(row.listFilter)}`}
            data-testid={`dashboard-today-link-${kind}`}
            style={{ fontSize: typography.fontSizeSecondary, fontWeight: 400 }}
          >
            {dashboardTexts.todaySeeAll}
          </Link>
        ) : null}
      </h3>
      <ul
        data-testid={`dashboard-today-items-${kind}`}
        style={{ listStyle: 'none', margin: '4px 0 0', padding: '0 0 0 28px' }}
      >
        {items.map((item) =>
          kind === 'SCHEDULE_OVERDUE' ? (
            <OverdueItem key={itemKey(item)} item={item} onChanged={onChanged} />
          ) : kind === 'HANDOFF_FOR_ME' ? (
            <HandoffItem key={itemKey(item)} item={item} />
          ) : (
            <PlainItem key={itemKey(item)} item={item} />
          ),
        )}
      </ul>
      {hidden > 0 ? (
        <Button
          type="link"
          size="small"
          onClick={() => setAll(true)}
          data-testid={`dashboard-today-more-${kind}`}
          style={{ paddingLeft: 28 }}
        >
          {dashboardTexts.todayMoreButton(hidden)}
        </Button>
      ) : null}
    </li>
  );
}

export interface TodayChecksProps {
  /** 서버의 줄 목록. 옛 서버라 칸이 없으면(undefined) 구역을 그리지 않는다. */
  rows: TodayCheckRow[] | undefined;
  /**
   * 영업 비서의 오늘 정리(#743) 자리: 제목 바로 아래, 줄 목록 위. 대시보드는 스위치가 켜져 있고 담당자를
   * 골랐을 때만 넘긴다. 넘기지 않으면 아무것도 보이지 않는다(빈 상자·안내 문구 없음).
   */
  assistantSummary?: ReactNode;
  /** 지난 일정 단추로 정리한 뒤 대시보드를 다시 읽는다(#766). */
  onChanged?: () => void;
}

/** #799 운영 알림 줄. 회사 줄이 아니라 한 줄 문장과 [운영 관리 →]. */
const ALERT_KINDS = ['AI_LIMIT_REACHED', 'AI_USAGE_ALERT', 'DATA_REFRESH_DUE'] as const;

function alertText(row: TodayCheckRow): string | null {
  const alert = row.alert;
  if (row.kind === 'AI_LIMIT_REACHED') return dashboardTexts.alertAiLimit;
  if (!alert) return null;
  if (row.kind === 'AI_USAGE_ALERT' && alert.percent !== null) {
    const money = (value: number | null) => (value === null ? '?' : `$${value.toFixed(2)}`);
    return dashboardTexts.alertAiUsage(alert.percent, money(alert.usedUsd), money(alert.limitUsd));
  }
  if (row.kind === 'DATA_REFRESH_DUE' && alert.asOf) {
    return dashboardTexts.alertDataRefresh(alert.asOf);
  }
  return null;
}

function AlertLine({ row }: { row: TodayCheckRow }) {
  const { config, staffKey } = useFrame();
  const text = alertText(row);
  if (!text) return null;
  const operations = Boolean(staffKey && config?.operationsStaffKeys?.includes(staffKey));
  const icon =
    row.kind === 'DATA_REFRESH_DUE' ? '📂' : row.kind === 'AI_LIMIT_REACHED' ? '⛔' : '⚠';
  return (
    <li
      data-testid={`dashboard-today-alert-${row.kind}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'baseline',
        padding: '6px 0',
        color: row.kind === 'AI_LIMIT_REACHED' ? colors.error : colors.text,
        fontWeight: 600,
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{text}</span>
      {operations ? (
        <Link
          to="/operations"
          data-testid={`dashboard-today-alert-link-${row.kind}`}
          style={{ fontWeight: 400, fontSize: typography.fontSizeSecondary }}
        >
          {dashboardTexts.alertOperationsLink}
        </Link>
      ) : null}
    </li>
  );
}

export default function TodayChecks({
  rows,
  assistantSummary = null,
  onChanged = () => {},
}: TodayChecksProps) {
  if (rows === undefined) return null;
  const known = rows.filter((row) => isKnownKind(row.kind) && row.count > 0);
  const ordered = ORDER.flatMap((kind) => known.filter((row) => row.kind === kind));
  const alerts = ALERT_KINDS.flatMap((kind) => rows.filter((row) => row.kind === kind));
  return (
    <section
      aria-labelledby="dashboard-today-title"
      data-testid="dashboard-today"
      style={{
        display: 'grid',
        gap: 8,
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: radius.lg,
        padding: '16px 20px',
      }}
    >
      <h2 id="dashboard-today-title" style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}>
        {dashboardTexts.todayTitle}
      </h2>
      {assistantSummary ? (
        <div data-testid="dashboard-today-assistant">{assistantSummary}</div>
      ) : null}
      {alerts.length > 0 ? (
        <ul
          data-testid="dashboard-today-alerts"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {alerts.map((row) => (
            <AlertLine key={row.kind} row={row} />
          ))}
        </ul>
      ) : null}
      {ordered.length === 0 && alerts.length === 0 ? (
        <p data-testid="dashboard-today-empty" style={{ margin: 0, color: colors.textSecondary }}>
          {dashboardTexts.todayEmpty}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ordered.map((row) => (
            <Group
              key={row.kind}
              row={row}
              kind={row.kind as TodayCheckKind}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
