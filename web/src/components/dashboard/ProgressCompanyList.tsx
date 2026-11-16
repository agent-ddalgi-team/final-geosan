// #800(PM 결정 2026-11-16): 대시보드 영업 진행 띠의 칸을 누르면 그 단계 회사가 펴진다.
//   "코파스 주식회사 · 마지막 접촉 3일 전 · 다음 11/18 방문"
//   다음 일정 없이 마지막 접촉 뒤 설정 일수(14일)가 지난 접촉·견적 회사에는 "⚠ 멈춘 회사"(서버가 계산).
// 칸 숫자와 같은 분류로 서버가 고른 회사라 목록 길이가 칸 숫자와 같다. 메모·연락처는 오지 않는다.
// 앞 5곳만 보이고 [n곳 더 보기]로 편다. 맨 아래 [목록에서 보기 →]는 지금처럼 걸러진 목록으로 간다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'antd';
import type { ProgressBandKey, ProgressCompany } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

const SHOWN = 5;

/** 두 날짜(YYYY-MM-DD) 사이 날 수. 글이 날짜가 아니면 null. */
export function daysBetween(from: string, to: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  };
  const a = parse(from);
  const b = parse(to);
  return a === null || b === null ? null : Math.round((b - a) / 86_400_000);
}

/** "11/18". 날짜 글이 아니면 그대로. */
function monthDay(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}/${Number(match[2])}` : value;
}

export function progressLine(row: ProgressCompany, today: string): string {
  const days = row.lastContactAt ? daysBetween(row.lastContactAt, today) : null;
  const contact = days === null ? t.progressNoContact : t.progressLastContact(days);
  const next = row.nextScheduleAt
    ? t.progressNext(monthDay(row.nextScheduleAt), row.nextScheduleNote)
    : t.progressNoSchedule;
  return `${contact} · ${next}`;
}

export default function ProgressCompanyList({
  band,
  rows,
  today,
  listHref,
}: {
  band: ProgressBandKey;
  rows: ProgressCompany[];
  /** 오늘(YYYY-MM-DD). "며칠 전"을 셀 때 쓴다. */
  today: string;
  listHref: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const hidden = rows.length - shown.length;
  const stage = band === 'ON_HOLD' ? t.progressOnHoldName : t.progressBandNames[band];
  return (
    <div
      id="dashboard-progress-companies"
      data-testid={`dashboard-progress-companies-${band}`}
      style={{ display: 'grid', gap: 6 }}
    >
      <strong style={{ fontSize: typography.fontSize }}>
        {t.progressListTitle(stage, rows.length)}
      </strong>
      {rows.length === 0 ? (
        <span style={{ color: colors.textSecondary }}>{t.progressListEmpty}</span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {shown.map((row) => (
            <li
              key={row.oppId}
              data-testid="dashboard-progress-company"
              data-stalled={row.stalled}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}
            >
              <Link to={`/opportunities/${encodeURIComponent(row.oppId)}`}>{row.customerName}</Link>
              <span style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}>
                {progressLine(row, today)}
              </span>
              {row.stalled ? (
                <span
                  data-testid="dashboard-progress-stalled"
                  style={{
                    color: colors.error,
                    fontSize: typography.fontSizeSecondary,
                    fontWeight: 600,
                  }}
                >
                  {t.progressStalled}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {hidden > 0 ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => setAll(true)}
            data-testid="dashboard-progress-more"
          >
            {t.progressMore(hidden)}
          </Button>
        ) : null}
        <Link
          to={listHref}
          data-testid={`dashboard-progress-list-link-${band}`}
          style={{ fontSize: typography.fontSizeSecondary }}
        >
          {t.progressListLink}
        </Link>
      </span>
    </div>
  );
}
