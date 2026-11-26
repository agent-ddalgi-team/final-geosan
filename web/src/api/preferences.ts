// 담당자 선호 제안·승인(#943, 계약 C1 `GET·POST /preferences`, `POST /preferences/{prefId}/revoke`).
// 읽기는 누구나, 승인·끄기는 관리자(설정 operations.staffKeys)만 200, 나머지 403.
// client.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다. 가짜 숫자는 없다.
import { request } from './client';
import type { Envelope } from './types';

export type PreferenceKind = 'PROCESS_INDUSTRY' | 'DISTANCE';

export interface PreferenceCombo {
  kind: PreferenceKind;
  processCode: string | null;
  processName: string | null;
  industry: string | null;
  distanceKm: number | null;
}

export interface PreferenceSuggestion extends PreferenceCombo {
  pickedCount: number;
  excludedCount: number;
  /** (조합 안 고른 수 − 조합 안 제외 수) ÷ 고른 회사 수, 0~1 */
  share: number;
  closedCount: number;
  wonCount: number;
  otherClosedCount: number;
  otherWonCount: number;
}

export interface PreferenceApproval extends PreferenceCombo {
  prefId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

export interface Preferences {
  enabled: boolean;
  canApprove: boolean;
  basis: {
    windowDays: number;
    minPicks: number;
    minShare: number;
    distanceKm: number;
    minClosedForRate: number;
    approvalDays: number;
    pickedCount: number;
  } | null;
  suggestions: PreferenceSuggestion[];
  active: PreferenceApproval[];
}

export function getPreferences(
  signal?: AbortSignal,
  staffKey?: string | null,
): Promise<Envelope<Preferences>> {
  return request<Preferences>('/preferences', { signal, staffKey });
}

export function approvePreference(
  combo: PreferenceCombo,
  staffKey: string | null,
): Promise<Envelope<PreferenceApproval>> {
  const body =
    combo.kind === 'DISTANCE'
      ? { kind: combo.kind, distanceKm: combo.distanceKm }
      : { kind: combo.kind, processCode: combo.processCode, industry: combo.industry };
  return request<PreferenceApproval>('/preferences', { method: 'POST', body, staffKey });
}

export function revokePreference(
  prefId: string,
  staffKey: string | null,
): Promise<Envelope<{ prefId: string; revokedAt: string }>> {
  return request<{ prefId: string; revokedAt: string }>(
    `/preferences/${encodeURIComponent(prefId)}/revoke`,
    { method: 'POST', staffKey },
  );
}
