// 대시보드 읽기(계약 C1 `GET /dashboard` v2, 집계 서버 #216). client.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다.
// 이 파일에는 가짜 숫자가 없다. VITE_USE_FIXTURES=1 일 때만 client.ts의 가짜 응답 자리가 고정값을 돌려준다.
import { request } from './client';
import type { Dashboard } from './dashboardTypes';
import type { Envelope } from './types';

/**
 * 대시보드 집계 읽기. `staffKey`를 주면 `X-Staff-Key` 헤더로 보내 서버가 "최근 내 기록"을 그 담당자 것으로 채운다.
 * 키를 안 주면(보기 전용·담당자 미선택) 헤더를 보내지 않고, 서버는 그 목록을 빈 채로 돌려준다(#216 후속).
 */
export function getDashboard(
  signal?: AbortSignal,
  staffKey?: string | null,
): Promise<Envelope<Dashboard>> {
  return request<Dashboard>('/dashboard', { signal, staffKey });
}
