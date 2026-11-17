// 대시보드 지도 읽기(계약 C1 `GET /dashboard/map`, 서버 창구 #642). client.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다.
// 이 파일에는 가짜 숫자가 없다. VITE_USE_FIXTURES=1 일 때만 src/test/fixtures의 가짜 응답을 돌려준다.
// 서버 창구가 합쳐지기 전에는 실제 서버 연결을 확인하지 못했다(가짜 응답으로만 확인).
import { request } from './client';
import type { DashboardMap } from './dashboardMapTypes';
import type { Envelope } from './types';

export async function getDashboardMap(signal?: AbortSignal): Promise<Envelope<DashboardMap>> {
  if (import.meta.env.VITE_USE_FIXTURES === '1') {
    return (await import('../test/fixtures/dashboard-map.json'))
      .default as unknown as Envelope<DashboardMap>;
  }
  return request<DashboardMap>('/dashboard/map', { signal });
}
