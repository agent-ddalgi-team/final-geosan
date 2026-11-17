// 전달 사항(#771, PM 결정 2026-11-15·16, #756 하위): 담당자가 아닌 직원도 회사 건으로 받는 사람 한 명에게 남긴다.
// 상세 "기록 남기기" 맨 위에 포스트잇처럼 붙는다: 확인 전은 노랑, 확인한 것은 옅게. 받는 사람에게만 [확인했어요],
// 다른 사람에게는 "박 이사 확인 전"(#794).
// [전달 사항 남기기]를 누르면 글 칸과 받는 사람(기본: 그 회사에 마지막으로 기록을 남긴 사람)이 펴진다.
// 전달 사항 글은 회사 보고서에 바로 싣지 않는다. 영업 코치가 "동료 전달"로 읽고 짚어 준다.
// #847(PM 결정 2026-11-17): 영업 코치 칸에서는 listOnly로 확인사항 맨 위에 "확인 전" 전달 사항만 보인다.
// 남기는 것은 대화 기록의 메모 "받는 사람"으로 한다([전달 사항 남기기] 단추 없음).
import { useState } from 'react';
import { Button, Input, Select } from 'antd';
import { ApiError, confirmHandoff, postNote } from '../../api/client';
import type { HandoffNote } from '../../api/types';
import { handoffTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { useFrame, VIEWER_KEY } from '../frame/FrameContext';

const POSTIT = '#FFF3B0';
const POSTIT_DONE = '#F6F6F2';

export interface HandoffBoxProps {
  oppId: string;
  evalId?: string | null;
  handoffs: HandoffNote[];
  /** 기본 받는 사람(그 회사에 마지막으로 기록을 남긴 사람). 나이거나 없으면 첫 다른 담당자. */
  lastActor?: string | null;
  /** 저장·확인 뒤 상세를 다시 읽는다. */
  onChanged: () => void;
  /** #847: 남기는 단추·칸 없이 확인 전 전달 사항만 보인다(없으면 아무것도 그리지 않음). */
  listOnly?: boolean;
}

export default function HandoffBox({
  oppId,
  evalId = null,
  handoffs,
  lastActor = null,
  onChanged,
  listOnly = false,
}: HandoffBoxProps) {
  const { config, staffKey, canRecord } = useFrame();
  const staff = config?.staff ?? [];
  const nameOf = (key: string) => staff.find((entry) => entry.key === key)?.displayName ?? key;
  // #853: 역할 묶음으로 보낸 전달 사항은 묶음 이름(예: 영업)으로 보이고, 묶음 안 누구나(보낸 사람 빼고) 확인한다.
  const teams = config?.handoffTeams ?? [];
  const toName = (row: HandoffNote) =>
    row.toTeam
      ? (teams.find((team) => team.key === row.toTeam)?.label ?? row.toTeam)
      : nameOf(row.to);
  const isMine = (row: HandoffNote) =>
    row.to === staffKey ||
    (Boolean(row.toTeam) &&
      row.from !== staffKey &&
      (teams.find((team) => team.key === row.toTeam)?.staffKeys ?? []).includes(staffKey ?? ''));
  const others = staff.filter((entry) => entry.key !== staffKey && entry.key !== VIEWER_KEY);
  const defaultTo =
    lastActor && lastActor !== staffKey && others.some((entry) => entry.key === lastActor)
      ? lastActor
      : (others[0]?.key ?? null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const target = to ?? defaultTo;
  const waiting = handoffs.filter((row) => !row.confirmedAt).length;

  async function send() {
    if (!staffKey || !target || !text.trim() || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await postNote(
        oppId,
        { kind: 'HANDOFF', text: text.trim(), toStaffKey: target, evalId },
        staffKey,
      );
      setText('');
      setOpen(false);
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? `${error.body.message} ${error.body.nextAction}`
          : handoffTexts.saveFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm(noteId: string) {
    if (!staffKey || busy) return;
    setBusy(true);
    try {
      await confirmHandoff(noteId, staffKey);
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? `${error.body.message} ${error.body.nextAction}`
          : handoffTexts.saveFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  // #803: 전달 사항이 없고 남길 수도 없으면(담당자 고르기 전·보기 전용) 빈 제목만 남던 자리를 비운다.
  if (handoffs.length === 0 && !canRecord) return null;
  // #847: 목록만 보일 때는 확인 전인 것만. 확인한 것은 활동 이력에 남는다.
  const shown = listOnly ? handoffs.filter((row) => !row.confirmedAt) : handoffs;
  if (listOnly && shown.length === 0) return null;

  return (
    <div data-testid="handoff-box" style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {shown.length > 0 ? <strong>{handoffTexts.title}</strong> : null}
        {waiting > 0 ? (
          <span data-testid="handoff-waiting" style={{ color: colors.textSecondary }}>
            {handoffTexts.waiting(waiting)}
          </span>
        ) : null}
        {canRecord && !listOnly ? (
          <Button
            size="small"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            data-testid="handoff-open"
          >
            {open ? handoffTexts.cancel : handoffTexts.open}
          </Button>
        ) : null}
      </div>
      {open && canRecord && !listOnly ? (
        <div data-testid="handoff-form" style={{ display: 'grid', gap: 6, maxWidth: 560 }}>
          <label htmlFor={`handoff-text-${oppId}`}>{handoffTexts.textLabel}</label>
          <Input.TextArea
            id={`handoff-text-${oppId}`}
            rows={2}
            maxLength={500}
            value={text}
            placeholder={handoffTexts.textPlaceholder}
            onChange={(event) => setText(event.target.value)}
            data-testid="handoff-text"
          />
          <label htmlFor={`handoff-to-${oppId}`}>{handoffTexts.toLabel}</label>
          <Select
            id={`handoff-to-${oppId}`}
            value={target ?? undefined}
            onChange={(value: string) => setTo(value)}
            options={others.map((entry) => ({ value: entry.key, label: entry.displayName }))}
            data-testid="handoff-to"
            style={{ maxWidth: 240 }}
          />
          <Button
            type="primary"
            disabled={busy || !text.trim() || !target}
            onClick={() => void send()}
            data-testid="handoff-send"
            style={{ justifySelf: 'start' }}
          >
            {handoffTexts.send}
          </Button>
        </div>
      ) : null}
      {message ? (
        <span role="alert" style={{ color: colors.error, fontSize: typography.fontSizeSecondary }}>
          {message}
        </span>
      ) : null}
      {shown.length > 0 ? (
        <ul
          data-testid="handoff-list"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          {shown.map((row) => {
            const done = Boolean(row.confirmedAt);
            return (
              <li
                key={row.noteId}
                data-testid="handoff-note"
                data-confirmed={done}
                style={{
                  background: done ? POSTIT_DONE : POSTIT,
                  border: `1px solid ${done ? colors.borderSecondary : '#E8D77A'}`,
                  borderRadius: 4,
                  padding: '8px 10px',
                  display: 'grid',
                  gap: 4,
                  color: done ? colors.textSecondary : colors.text,
                  boxShadow: done ? 'none' : '0 1px 2px rgba(0,0,0,0.08)',
                }}
              >
                <span style={{ fontSize: typography.fontSizeSecondary }}>
                  {handoffTexts.line(
                    nameOf(row.from),
                    toName(row),
                    formatMonthDay(row.at) ?? row.at,
                  )}
                </span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{row.text}</span>
                {done ? (
                  <span style={{ fontSize: typography.fontSizeSecondary }}>
                    ✓ {handoffTexts.confirmed}
                  </span>
                ) : isMine(row) && canRecord ? (
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => void confirm(row.noteId)}
                    data-testid="handoff-confirm"
                    style={{ justifySelf: 'start' }}
                  >
                    {handoffTexts.confirm}
                  </Button>
                ) : (
                  // #794: 보낸 사람·다른 직원도 받는 사람이 아직 안 봤는지 안다.
                  <span
                    data-testid="handoff-waiting-for"
                    style={{ fontSize: typography.fontSizeSecondary, color: colors.textSecondary }}
                  >
                    {handoffTexts.waitingFor(toName(row))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
