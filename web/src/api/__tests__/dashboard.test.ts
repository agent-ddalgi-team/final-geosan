// getDashboard는 늘 client의 request로 /dashboard 를 읽는다(#216). 가짜 모드(VITE_USE_FIXTURES=1)일 때만
// client.ts의 가짜 응답 자리가 고정값을 돌려주고, 아니면 /api/v1/dashboard 로 실제 요청을 보낸다.
// fetch는 가짜로 바꾼 확인이며 실제 서버(집계 API) 연결 확인이 아니다.
import { getDashboard } from '../dashboard';
import dashboardFixture from '../../test/fixtures/dashboard.json';

describe('getDashboard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('가짜 모드에서는 서버를 부르지 않고 고정값 파일을 돌려준다', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '1');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = await getDashboard();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(envelope.data.counts).toEqual(dashboardFixture.data.counts);
    expect(envelope.meta.hasVirtualData).toBe(true);
  });

  it('가짜 모드가 아니면 /api/v1/dashboard 를 읽고 응답을 그대로 돌려준다', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
    const body = JSON.stringify({ data: dashboardFixture.data, meta: { total: null } });
    const fetchSpy = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = await getDashboard();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/dashboard');
    expect(envelope.data.asOf).toBe(dashboardFixture.data.asOf);
  });

  it('담당자 키를 주면 X-Staff-Key 헤더로 보내 서버가 "최근 내 기록"을 그 담당자 것으로 채우게 한다 (#216 후속)', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
    const body = JSON.stringify({ data: dashboardFixture.data, meta: { total: null } });
    const fetchSpy = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await getDashboard(undefined, 'park-lee');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Staff-Key']).toBe('park-lee');
  });

  it('담당자 키가 없거나 null이면 헤더를 아예 보내지 않는다 (보기 전용·담당자 미선택)', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
    const body = JSON.stringify({ data: dashboardFixture.data, meta: { total: null } });
    // 호출마다 새 응답을 만든다(같은 응답 본문은 한 번만 읽을 수 있다).
    const fetchSpy = vi.fn().mockImplementation(async () => new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await getDashboard(undefined, null);
    await getDashboard();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.headers as Record<string, string>).not.toHaveProperty('X-Staff-Key');
    }
  });
});
