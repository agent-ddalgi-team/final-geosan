// 대시보드 읽기(계약 C1 `GET /dashboard` v2). client.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다.
// VITE_USE_FIXTURES=1 이면 서버 없이 src/test/fixtures/dashboard.json의 가짜 숫자를 돌려준다.
// 집계 API(#216)가 붙으면 가짜 모드 분기와 고정값 파일만 빼면 된다.
import { isFixtureMode, request } from './client';
import type { Dashboard } from './dashboardTypes';
import type { Envelope } from './types';

export async function getDashboard(signal?: AbortSignal): Promise<Envelope<Dashboard>> {
  if (isFixtureMode()) {
    return (await import('../test/fixtures/dashboard.json'))
      .default as unknown as Envelope<Dashboard>;
  }
  return request<Dashboard>('/dashboard', { signal });
}
