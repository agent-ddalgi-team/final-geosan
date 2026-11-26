// #943 되먹임 ③: 영업 분석 맨 위 "담당자 선호 제안". 담당자가 최근에 고른 회사가 한 조합에 몰리고
// 그 조합의 성사율도 다른 곳보다 낮지 않을 때만 제안이 오고, 관리자가 [승인]하면 신규 거래처 찾기
// "근거 있음" 안에서 한 단계 위로 간다. 켜진 선호는 기한과 [끄기]가 보인다. 점수는 바뀌지 않는다.
// 설정이 꺼져 있거나 서버가 이 창구를 모르면(옛 서버) 아무것도 그리지 않는다.
import { useCallback, useEffect, useState } from 'react';
import { Button } from 'antd';
import { ApiError } from '../../api/client';
import {
  approvePreference,
  getPreferences,
  revokePreference,
  type PreferenceCombo,
  type Preferences,
} from '../../api/preferences';
import { preferenceLabels as t } from '../../labels/ko';
import { colors, detailTheme, spacing, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

function errorText(error: unknown): string {
  return error instanceof ApiError ? `${error.body.message} ${error.body.nextAction}` : t.failed;
}

export default function PreferencePanel() {
  const { staffKey } = useFrame();
  const [data, setData] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getPreferences(controller.signal, staffKey)
      .then((response) => setData(response.data))
      .catch(() => {
        // 읽지 못하면(옛 서버·네트워크) 칸을 그리지 않는다. 영업 분석 본문은 그대로 보인다.
        if (!controller.signal.aborted) setData(null);
      });
    return () => controller.abort();
  }, [staffKey, version]);

  const act = useCallback(async (run: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      await run();
      setVersion((n) => n + 1);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!data || !data.enabled || !data.basis) return null;
  const basis = data.basis;
  const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary };
  const approve = (combo: PreferenceCombo) => act(() => approvePreference(combo, staffKey));

  return (
    <section
      aria-labelledby="preference-title"
      data-testid="preference-panel"
      style={{
        background: colors.bgContainer,
        border: `1px solid ${detailTheme.border}`,
        borderRadius: detailTheme.radius,
        padding: spacing.cardPadding,
        display: 'grid',
        gap: 10,
      }}
    >
      <h2
        id="preference-title"
        style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
      >
        {t.title}
      </h2>
      <p style={{ margin: 0, ...secondary }}>{t.intro(basis.windowDays, basis.pickedCount)}</p>
      {data.suggestions.length === 0 ? (
        <p data-testid="preference-none" style={{ margin: 0 }}>
          {t.none(basis.pickedCount, basis.minPicks, basis.minClosedForRate)}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {data.suggestions.map((row) => (
            <li
              key={`${row.kind}:${row.processCode ?? ''}:${row.industry ?? ''}:${row.distanceKm ?? ''}`}
              data-testid="preference-suggestion"
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}
            >
              <strong>{t.combo(row)}</strong>
              <span>{t.share(row.pickedCount, basis.pickedCount, row.excludedCount)}</span>
              <span style={secondary}>
                {t.rate(row.wonCount, row.closedCount, row.otherWonCount, row.otherClosedCount)}
              </span>
              {data.canApprove ? (
                <Button size="small" type="primary" disabled={busy} onClick={() => approve(row)}>
                  {t.approve}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data.suggestions.length > 0 && !data.canApprove ? (
        <p data-testid="preference-approve-hint" style={{ margin: 0, ...secondary }}>
          {t.approveHint}
        </p>
      ) : null}
      {data.active.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <strong>{t.activeTitle}</strong>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {data.active.map((row) => (
              <li
                key={row.prefId}
                data-testid="preference-active"
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}
              >
                <span>{t.combo(row)}</span>
                <span style={secondary}>
                  {t.active(
                    formatMonthDay(row.approvedAt) ?? '',
                    formatMonthDay(row.expiresAt) ?? '',
                  )}
                </span>
                {data.canApprove ? (
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => act(() => revokePreference(row.prefId, staffKey))}
                  >
                    {t.revoke}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p style={{ margin: 0, ...secondary }}>{t.safeguards(basis.approvalDays)}</p>
      {failure ? (
        <p role="alert" data-testid="preference-failed" style={{ margin: 0, color: colors.error }}>
          {failure}
        </p>
      ) : null}
    </section>
  );
}
