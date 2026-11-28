// #980(PM 결정 2026-11-28, 캔버스 "기업 상세 일정 잡기" 장): 기업 상세 영업 코치 맨 위 "다음 일정" 칸.
// 접힌 모습: "다음 일정  12/2 방문 · 샘플 전달 [바꾸기]" / 일정이 없으면 "다음 일정  일정 없음 [일정 잡기]".
// 지난 일정은 주황으로 "지난 일정 11/18 …". 펼치면 영업 홈 표와 같은 공용 칸(ScheduleQuickEdit, #983)이
// 열려 날짜 · 종류 · 내용으로 저장한다(같은 저장 길 POST /outcomes, AI 없음). 저장되면 상세를 다시 읽는다.
import { useState } from 'react';
import type { OutcomeRecord } from '../../api/types';
import { coachScheduleTexts as texts } from '../../labels/ko';
import { colors, homePalette, radius, typography } from '../../theme/tokens';
import { formatMonthDay, todayKst } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';
import ScheduleQuickEdit from '../schedule/ScheduleQuickEdit';

export interface CoachNextScheduleProps {
  oppId: string;
  outcome: OutcomeRecord | null;
  /** 저장이 끝나거나 [다시 읽기]를 누르면 부른다(상세·활동 이력을 다시 읽는다). */
  onSaved: () => void;
}

export default function CoachNextSchedule({ oppId, outcome, onSaved }: CoachNextScheduleProps) {
  const { canRecord } = useFrame();
  const [open, setOpen] = useState(false);
  const at = outcome?.nextScheduleAt ?? null;
  const note = outcome?.nextScheduleNote?.trim() || null;
  const overdue = Boolean(at && at < todayKst());
  const day = at ? (formatMonthDay(at) ?? at) : null;
  return (
    <section
      aria-label={texts.title}
      data-testid="coach-next-schedule"
      style={{
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: radius.control,
        padding: '10px 12px',
        marginBottom: 12,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: typography.fontSize }}>{texts.title}</strong>
        <span
          data-testid="coach-next-schedule-line"
          style={{
            fontSize: typography.fontSizeSecondary,
            color: overdue ? homePalette.yellowText : colors.textSecondary,
            fontWeight: overdue ? 600 : 400,
          }}
        >
          {day
            ? [overdue ? `${texts.overdue} ${day}` : day, note].filter(Boolean).join(' · ')
            : texts.none}
        </span>
        {open ? null : (
          <button
            type="button"
            disabled={!canRecord}
            onClick={() => setOpen(true)}
            data-testid="coach-next-schedule-open"
            style={{
              marginLeft: 'auto',
              padding: '3px 10px',
              borderRadius: radius.controlSm,
              border: `1px solid ${colors.border}`,
              background: colors.bgContainer,
              color: colors.text,
              font: 'inherit',
              fontSize: typography.fontSizeSecondary,
              cursor: canRecord ? 'pointer' : 'not-allowed',
            }}
          >
            {at ? texts.change : texts.add}
          </button>
        )}
      </div>
      {open ? (
        <ScheduleQuickEdit
          oppId={oppId}
          currentScheduleAt={at}
          currentScheduleNote={note}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
          onCancel={() => setOpen(false)}
          onReload={onSaved}
        />
      ) : null}
    </section>
  );
}
