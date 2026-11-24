import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardMapPoint, DashboardVisitGroup } from '../../api/dashboardMapTypes';
import { dashboardMapTexts as t } from '../../labels/ko';
import { colors, spacing, statusPalette, typography } from '../../theme/tokens';

const FIRST_CARDS = 3;
const muted = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary };
const listStyle = { display: 'grid', gap: 6, listStyle: 'none', margin: 0, padding: 0 };
const buttonStyle = {
  justifySelf: 'start',
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: 6,
  background: colors.bgContainer,
  color: statusPalette.ask.fg,
  fontSize: typography.fontSizeSecondary,
  padding: '4px 8px',
  cursor: 'pointer',
} as const;

export const visitPanelStyle = {
  alignSelf: 'start',
  display: 'grid',
  gap: 10,
  flex: '1 1 235px',
  minWidth: 0,
  background: colors.bgLayout,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: 12,
  padding: spacing.cardGap,
} as const;

function CompanyCard({
  company,
  distance,
  onPickVisitBase,
}: {
  company: Pick<DashboardMapPoint, 'oppId' | 'customerName' | 'group'>;
  distance: string;
  onPickVisitBase?: () => void;
}) {
  const tone =
    company.group === 'INTERESTED'
      ? statusPalette.ask
      : company.group === 'IN_PROGRESS'
        ? statusPalette.wait
        : statusPalette.ok;
  return (
    <li>
      <Link
        to={`/opportunities/${encodeURIComponent(company.oppId)}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: '2px 8px',
          border: `1px solid ${colors.borderSecondary}`,
          padding: '7px 9px',
          borderRadius: 8,
          background: colors.bgContainer,
          color: colors.text,
          fontSize: typography.fontSizeSecondary,
          textDecoration: 'none',
        }}
      >
        <strong style={{ overflowWrap: 'anywhere' }}>{company.customerName}</strong>
        <span style={{ gridColumn: 2, gridRow: '1 / 3', ...muted }}>{distance}</span>
        <span
          style={{
            justifySelf: 'start',
            fontSize: 12,
            borderRadius: 4,
            padding: '0 4px',
            background: tone.bg,
            color: tone.fg,
          }}
        >
          {t.groups[company.group]}
        </span>
      </Link>
      {onPickVisitBase ? (
        <button
          type="button"
          aria-label={`${company.customerName} ${t.visitPickBase}`}
          onClick={onPickVisitBase}
          style={{ ...buttonStyle, marginTop: 4 }}
        >
          {t.visitPickBase}
        </button>
      ) : null}
    </li>
  );
}

export function MapClusterCards({
  companies,
  canPickVisitBase,
  onPickVisitBase,
  onClose,
}: {
  companies: DashboardMapPoint[];
  canPickVisitBase: (oppId: string) => boolean;
  onPickVisitBase: (oppId: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? companies : companies.slice(0, FIRST_CARDS);
  return (
    <section
      style={visitPanelStyle}
      aria-label="묶인 업체"
      data-testid="dashboard-map-cluster-list"
    >
      <h3 style={{ margin: 0, fontSize: typography.fontSize }}>
        이 위치의 업체 {companies.length}곳
      </h3>
      <ul style={listStyle}>
        {visible.map((company) => (
          <CompanyCard
            key={company.oppId}
            company={company}
            distance={t.visitNearbyDistance(company.distanceKm)}
            onPickVisitBase={
              canPickVisitBase(company.oppId) ? () => onPickVisitBase(company.oppId) : undefined
            }
          />
        ))}
      </ul>
      {companies.length > FIRST_CARDS && !expanded && (
        <button type="button" style={buttonStyle} onClick={() => setExpanded(true)}>
          {t.visitMore(companies.length - FIRST_CARDS)}
        </button>
      )}
      <p style={{ ...muted, margin: 0 }}>거산 본사에서의 직선거리</p>
      <button type="button" style={buttonStyle} onClick={onClose}>
        같이 들를 곳으로 돌아가기
      </button>
    </section>
  );
}

interface VisitOption {
  group: DashboardVisitGroup;
  anchor: DashboardMapPoint;
}

export default function VisitMapCards({
  options,
  current,
  radiusKm,
  widenBelowCount,
  onPick,
  focused,
  onFocus,
}: {
  options: VisitOption[];
  current?: VisitOption;
  radiusKm: number;
  widenBelowCount?: number;
  onPick: (oppId: string) => void;
  focused: string | null;
  onFocus: (oppId: string | null) => void;
}) {
  const [showAll, setShowAll] = useState<string | null>(null);
  const title = <h3 style={{ margin: 0, fontSize: typography.fontSize }}>{t.visitTitle}</h3>;

  if (!current) {
    return (
      <section style={visitPanelStyle} aria-label={t.visitTitle}>
        {title}
        <p style={{ ...muted, margin: 0 }}>{t.visitEmpty}</p>
      </section>
    );
  }

  const { group, anchor } = current;
  const nearby = [...group.nearby].sort((a, b) => a.distanceKm - b.distanceKm);
  const visible = showAll === anchor.oppId ? nearby : nearby.slice(0, FIRST_CARDS);
  const isFocused = focused === anchor.oppId;

  return (
    <section
      style={visitPanelStyle}
      aria-label={t.visitTitle}
      data-testid="dashboard-map-visit-cards"
    >
      {title}
      <label style={{ display: 'grid', gap: 3, ...muted }}>
        방문 기준
        <select
          value={anchor.oppId}
          onChange={(event) => {
            setShowAll(null);
            onPick(event.target.value);
          }}
          style={{
            width: '100%',
            minWidth: 0,
            padding: 6,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            background: colors.bgContainer,
            color: colors.text,
            font: 'inherit',
          }}
        >
          {options.map(({ anchor: row }) => (
            <option key={row.oppId} value={row.oppId}>
              {row.customerName} · {t.groups[row.group]}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
        <span data-testid="dashboard-map-visit-distance" style={muted} aria-live="polite">
          {t.distance(anchor.distanceKm)}
        </span>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => onFocus(isFocused ? null : anchor.oppId)}
        >
          {isFocused ? '전체 위치 보기' : '지도에서 보기'}
        </button>
        <Link
          to={`/opportunities/${encodeURIComponent(anchor.oppId)}`}
          style={{ color: statusPalette.ask.fg, fontSize: typography.fontSizeSecondary }}
        >
          {t.detailLink}
        </Link>
      </div>
      <div style={{ display: 'grid', gap: 6 }} aria-live="polite">
        <strong style={{ fontSize: typography.fontSizeSecondary }}>
          {t.visitNearbyCount(nearby.length)}
        </strong>
        {nearby.length === 0 ? (
          <p style={{ ...muted, margin: 0 }}>{t.visitNone}</p>
        ) : (
          <>
            <span style={muted}>방문 기준 업체에서 가까운 순</span>
            <ul aria-label="주변 업체" style={listStyle}>
              {visible.map((company) => (
                <CompanyCard
                  key={company.oppId}
                  company={company}
                  distance={t.visitNearbyDistance(company.distanceKm)}
                />
              ))}
            </ul>
            {visible.length < nearby.length && (
              <button type="button" style={buttonStyle} onClick={() => setShowAll(anchor.oppId)}>
                {t.visitMore(nearby.length - visible.length)}
              </button>
            )}
          </>
        )}
        <span style={muted}>
          {group.radiusKm !== undefined &&
          group.radiusKm > radiusKm &&
          widenBelowCount !== undefined
            ? `${radiusKm}km 안이 ${widenBelowCount}곳 미만이라 ${group.radiusKm}km까지 표시`
            : `방문 기준 업체에서 ${group.radiusKm ?? radiusKm}km 안`}
        </span>
      </div>
    </section>
  );
}
