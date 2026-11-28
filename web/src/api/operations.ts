// 운영 관리 읽기(#799, 계약 C1 `GET /operations`). 운영 담당(설정 operations.staffKeys)만 200, 나머지 403.
// client.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다. 가짜 숫자는 없다.
import { request } from './client';
import type { Envelope } from './types';

export type UsageGroupKey = 'RESEARCH' | 'WEB_SEARCH' | 'SALES' | 'OTHER';
export type SourceKey =
  'FACTORY_FILE' | 'FACTORY_REGISTRY' | 'FACTORY_PROFILE' | 'WATER_LIST' | 'AI_JUDGMENT';

export interface Operations {
  usage: {
    month: string;
    calls: number;
    callLimit: number;
    costUsd: number;
    costLimitUsd: number;
    /** 설정 llm.costAlertRatio(0~1). */
    alertRatio: number;
    groups: { group: UsageGroupKey; calls: number; costUsd: number }[];
    daily: { day: string; costUsd: number }[];
    autoResearchToday: { usedUsd: number; limitUsd: number | null };
  };
  sources: {
    source: SourceKey;
    asOf: string | null;
    loadedAt: string | null;
    rows: number;
    refreshDueAt: string | null;
    refreshOverdue: boolean;
  }[];
  blocked: { occurredAt: string; purpose: string; kind: string; reason: string | null }[];
  /** #980 가린 상대 담당자 연락처·메모를 연 기록(최근 50건). 연 이름·번호·글은 없다. 옛 서버면 없음. */
  contactReveals?: {
    at: string;
    staffKey: string;
    staffName: string;
    oppId: string;
    customerName: string;
    kind: 'CONTACT' | 'NOTE';
  }[];
}

export function getOperations(
  signal?: AbortSignal,
  staffKey?: string | null,
): Promise<Envelope<Operations>> {
  return request<Operations>('/operations', { signal, staffKey });
}
