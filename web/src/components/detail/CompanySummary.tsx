// 상세 머리의 기업 요약(#210, 결정 2026-11-03): 홈페이지 상태 띠 + "회사 소개" 줄들.
// 조사일(3일 전)·오래됨, 거산에서의 거리, 대표번호(출처·담당자 확인 [맞음]), 한 줄 소개·특징(AI 제안).
// 값이 없는 줄은 보이지 않는다. 홈페이지 [맞음]·[고치기]·[다시 조사]는 `HomepageControls.tsx`(서버 `POST /homepage`)에 있다.
import { useState } from 'react';
import { Button } from 'antd';
import { ApiError, postMainPhoneConfirm } from '../../api/client';
import type { DetailHeader } from '../../api/types';
import { companySummary, errorTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { daysAgo, formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } as const;

/** 맨 위 띠: 홈페이지 확신이 낮거나 못 찾았을 때만 보인다. */
export function HomepageBand({ status }: { status?: DetailHeader['homepageStatus'] }) {
  if (status !== 'NEEDS_CONFIRMATION' && status !== 'NOT_FOUND') return null;
  return (
    <div role="status" data-testid="homepage-band" data-status={status}>
      <StatusTag tone="wait" icon="⚠">
        {status === 'NOT_FOUND'
          ? companySummary.bandNotFound
          : companySummary.bandNeedsConfirmation}
      </StatusTag>
    </div>
  );
}

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value) && /^https?:\/\/\S+$/.test(value as string);
}

export interface CompanySummaryProps {
  oppId: string;
  header: DetailHeader;
  /** 번호가 그 사이 바뀌었을 때 [새로 불러오기]가 부른다. 상세 화면이 서버에서 다시 읽는다. */
  onReload: () => void;
  /** 시험이 현재 시각에 기대지 않게 지금 시각을 받을 수 있다. */
  now?: Date;
}

export default function CompanySummary({ oppId, header, onReload, now }: CompanySummaryProps) {
  const { staffKey, canRecord, config } = useFrame();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ at: string; by: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const highlights = header.highlights ?? [];
  const phone = header.mainPhone ?? null;
  const distance = header.distanceKm ?? null;
  const isAi = header.researchSource === 'AI';
  const hasAnything =
    Boolean(header.researchedAt) ||
    Boolean(header.summaryLine) ||
    highlights.length > 0 ||
    phone !== null ||
    distance !== null;
  if (!hasAnything) return null;

  const researchedDate = formatMonthDay(header.researchedAt);
  const ago = daysAgo(header.researchedAt, now);
  const agoText =
    ago === null ? null : ago === 0 ? companySummary.today : companySummary.daysAgo(ago);

  const confirmedAt = saved?.at ?? header.mainPhoneConfirmedAt ?? null;
  const confirmedBy = saved?.by ?? header.mainPhoneConfirmedBy ?? null;
  const confirmedName =
    config?.staff.find((entry) => entry.key === confirmedBy)?.displayName ?? confirmedBy;
  const sourceUrl = isHttpUrl(header.mainPhoneSourceUrl) ? header.mainPhoneSourceUrl : null;
  const telHref =
    phone && /^[0-9+()\-\s]+$/.test(phone) ? `tel:${phone.replace(/[^0-9+]/g, '')}` : null;

  async function confirmPhone() {
    if (!staffKey || !phone) return;
    setSaving(true);
    setError(null);
    setStale(false);
    try {
      const envelope = await postMainPhoneConfirm(oppId, { expectedPhone: phone }, staffKey);
      setSaved({
        at: envelope.data.mainPhoneConfirmedAt,
        by: envelope.data.mainPhoneConfirmedBy,
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setStale(true);
        setError(companySummary.phoneStale);
      } else {
        const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
        setError(`${companySummary.phoneConfirmFailed} (${detail})`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label={companySummary.title}
      data-testid="company-summary"
      style={{ display: 'grid', gap: 8 }}
    >
      {header.researchedAt || distance !== null ? (
        <div style={{ ...rowStyle, ...secondary }}>
          {header.researchedAt ? (
            <span data-testid="company-research">
              {header.researchSource === 'CASE_FILE'
                ? `${companySummary.caseFileBasis}${researchedDate ? ` · ${researchedDate}` : ''}`
                : researchedDate
                  ? companySummary.researched(researchedDate, agoText ?? '')
                  : ''}
            </span>
          ) : null}
          {header.researchStale ? (
            <StatusTag tone="recheck" data-testid="company-stale-tag">
              {companySummary.stale}
            </StatusTag>
          ) : null}
          {distance !== null ? (
            <span data-testid="company-distance">{companySummary.distance(distance)}</span>
          ) : null}
        </div>
      ) : null}

      {phone ? (
        <div style={rowStyle} data-testid="company-phone">
          <span>
            {companySummary.mainPhone}{' '}
            {telHref ? (
              <a href={telHref} data-testid="company-phone-link">
                {phone}
              </a>
            ) : (
              phone
            )}
          </span>
          {sourceUrl ? (
            <span style={secondary}>
              {companySummary.phoneSource}:{' '}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="company-phone-source"
              >
                {companySummary.phoneSourceHomepage} ↗
              </a>
            </span>
          ) : header.mainPhoneSource === 'CSV' ? (
            <span style={secondary} data-testid="company-phone-source">
              {companySummary.phoneSource}: {companySummary.phoneSourceCsv}
            </span>
          ) : null}
          {confirmedAt ? (
            <span style={secondary} data-testid="company-phone-status">
              {companySummary.phoneConfirmed(
                formatMonthDay(confirmedAt) ?? '',
                confirmedName ?? '',
              )}
            </span>
          ) : (
            <>
              <span style={secondary} data-testid="company-phone-status">
                {companySummary.phoneUnconfirmed}
              </span>
              <Button
                size="small"
                disabled={!canRecord || saving}
                loading={saving}
                onClick={() => void confirmPhone()}
                data-testid="company-phone-confirm-button"
              >
                {companySummary.phoneConfirmButton}
              </Button>
              {!canRecord ? (
                <span style={secondary} data-testid="company-phone-pick-staff">
                  {companySummary.pickStaffFirst}
                </span>
              ) : null}
            </>
          )}
          {error ? (
            <span role="alert" data-testid="company-phone-error" style={{ color: colors.error }}>
              {error}
              {stale ? (
                <>
                  {' '}
                  <Button
                    type="link"
                    size="small"
                    onClick={onReload}
                    data-testid="company-phone-reload-button"
                  >
                    {companySummary.reload}
                  </Button>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {header.summaryLine ? (
        <div style={rowStyle} data-testid="company-summary-line">
          <span>
            {companySummary.summaryLine}: {header.summaryLine}
          </span>
          {isAi ? <StatusTag tone="ask">{companySummary.aiSuggestion}</StatusTag> : null}
        </div>
      ) : null}

      {highlights.length > 0 ? (
        <div style={rowStyle} data-testid="company-highlights">
          <span>{companySummary.highlights}:</span>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {isAi ? <StatusTag tone="ask">{companySummary.aiSuggestion}</StatusTag> : null}
        </div>
      ) : null}
    </section>
  );
}
