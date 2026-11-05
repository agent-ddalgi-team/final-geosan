// 대시보드 읽기(계약 C1 `GET /dashboard` v2, 집계 서버 #216). client.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다.
// 이 파일에는 가짜 숫자가 없다. VITE_USE_FIXTURES=1 일 때만 client.ts의 가짜 응답 자리가 고정값을 돌려준다.
import { request } from './client';
import type { Dashboard } from './dashboardTypes';
import type { Envelope } from './types';

export function getDashboard(signal?: AbortSignal): Promise<Envelope<Dashboard>> {
  return request<Dashboard>('/dashboard', { signal });
}
