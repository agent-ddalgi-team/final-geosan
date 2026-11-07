// 홈페이지 보내기(#210, 서버 #304): 요청 모양(POST·본문·담당자 머리) / 서버가 60초까지 걸려도 10초에 끊지 않는다 /
// 가짜 모드의 흐름. fetch는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { ApiError, HOMEPAGE_TIMEOUT_MS, REQUEST_TIMEOUT_MS, postHomepage } from '../client';

describe('postHomepage (실제 요청 모양)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('POST /api/v1/opportunities/{oppId}/homepage 로 본문과 담당자 머리를 보낸다', async () => {
    const data = {
      homepageUrl: 'https://a.test',
      homepageStatus: 'CONFIRMED',
      homepageSource: 'STAFF',
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data, meta: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = await postHomepage('opp 1', { confirmOnly: true }, 'park-lee');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v1/opportunities/opp%201/homepage');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Staff-Key']).toBe('park-lee');
    expect(JSON.parse(init.body)).toEqual({ confirmOnly: true });
    expect(envelope.data).toEqual(data);
  });

  it('조사는 10초가 지나도 끊지 않고 65초까지 기다린다', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
            setTimeout(
              () =>
                resolve(
                  new Response(
                    JSON.stringify({
                      data: {
                        evidenceCount: 1,
                        requirementCandidateCount: 0,
                        questionCount: 0,
                        evalId: 'e',
                      },
                      meta: {},
                    }),
                    { status: 200 },
                  ),
                ),
              REQUEST_TIMEOUT_MS + 20_000,
            );
          }),
      ),
    );
    const pending = postHomepage('opp-1', {}, 'park-lee');
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 20_000);
    await expect(pending).resolves.toBeTruthy();
    expect(aborted).toBe(false);
    expect(HOMEPAGE_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it('서버가 503 kind를 주면 ApiError로 그대로 던진다', async () => {
    const error = { message: '한도 초과', nextAction: '다음 달에', ref: 'r1', kind: 'LLM_LIMIT' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 503 })),
    );
    const caught = await postHomepage('opp-1', {}, 'park-lee').catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 503, body: error });
  });
});

describe('postHomepage (가짜 모드)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('[맞음]이면 CONFIRMED를, 아니면 조사 건수를 돌려주고, 보기 전용은 403이다', async () => {
    const confirmed = await postHomepage('opp-1', { confirmOnly: true }, 'park-lee');
    expect(confirmed.data).toMatchObject({ homepageStatus: 'CONFIRMED', homepageSource: 'STAFF' });
    const researched = await postHomepage('opp-1', {}, 'park-lee');
    expect(researched.data).toMatchObject({ evidenceCount: 3, questionCount: 1 });
    await expect(postHomepage('opp-1', {}, 'viewer')).rejects.toMatchObject({ status: 403 });
  });
});
