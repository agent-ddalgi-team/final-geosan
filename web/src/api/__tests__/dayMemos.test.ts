// 달력 날짜 메모(#984, 계약 C1 `/day-memos`): 요청 모양(경로 · 방식 · 담당자 머리 · 본문)과 오류 전달, 바뀜 알림.
// fetch는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 담당자 이름은 역할 말만 쓴다.
import { ApiError } from '../client';
import {
  DAY_MEMO_CHANGED_EVENT,
  DAY_MEMO_MAX_LENGTH,
  announceDayMemoChange,
  deleteDayMemo,
  getDayMemos,
  postDayMemo,
} from '../dayMemos';
import type { DayMemo } from '../dayMemos';

const memo: DayMemo = {
  memoId: 'daymemo-1',
  day: '2026-12-09',
  text: '오전 안전 교육',
  staffKey: 'park-lee',
  staffName: '영업 담당',
  createdAt: '2026-11-28T08:40:00Z',
};

function ok(data: unknown) {
  return vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data, meta: {} }), { status: 200 }));
}

beforeEach(() => {
  vi.stubEnv('VITE_USE_FIXTURES', '0');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('날짜 메모 요청 모양', () => {
  it('Given 기간이 주어지면 When 메모를 읽으면 Then GET /api/v1/day-memos?from=…&to=… 로 담당자 머리 없이 보낸다(누구나 읽는다)', async () => {
    const fetchSpy = ok([memo]);
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = await getDayMemos('2026-12-01', '2026-12-31');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v1/day-memos?from=2026-12-01&to=2026-12-31');
    expect(init.method).toBe('GET');
    expect(init.headers['X-Staff-Key']).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(envelope.data).toEqual([memo]);
  });

  it('Given 담당자가 글을 적으면 When 메모를 남기면 Then POST /api/v1/day-memos 로 날짜 · 글과 담당자 머리(X-Staff-Key)를 보낸다', async () => {
    const fetchSpy = ok(memo);
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = await postDayMemo('2026-12-09', '오전 안전 교육', 'park-lee');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v1/day-memos');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Staff-Key']).toBe('park-lee');
    expect(JSON.parse(init.body)).toEqual({ day: '2026-12-09', text: '오전 안전 교육' });
    expect(envelope.data).toEqual(memo);
  });

  it('Given 내가 쓴 메모가 있으면 When 지우면 Then DELETE /api/v1/day-memos/{memoId} 로 담당자 머리를 보내고 본문은 없다', async () => {
    const fetchSpy = ok({ memoId: 'daymemo 1', deleted: true });
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = await deleteDayMemo('daymemo 1', 'park-lee');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v1/day-memos/daymemo%201');
    expect(init.method).toBe('DELETE');
    expect(init.headers['X-Staff-Key']).toBe('park-lee');
    expect(init.body).toBeUndefined();
    expect(envelope.data).toEqual({ memoId: 'daymemo 1', deleted: true });
  });

  it('Given 남의 메모면 When 지우려 하면 Then 서버의 403 문구 · 다음 할 일을 그대로 담은 오류를 던진다(성공처럼 넘기지 않는다)', async () => {
    const error = {
      message: '다른 담당자의 메모는 지울 수 없습니다.',
      nextAction: '메모를 쓴 담당자에게 알려 주세요.',
      ref: 'r-1',
      kind: 'FORBIDDEN',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 403 })),
    );
    const caught = await deleteDayMemo('daymemo-9', 'park-lee').catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(403);
    expect((caught as ApiError).body).toMatchObject(error);
  });

  it('메모 글자 수 상한은 약속(C1)의 200자다', () => {
    expect(DAY_MEMO_MAX_LENGTH).toBe(200);
  });
});

describe('메모 바뀜 알림', () => {
  it('Given 듣는 곳이 있으면 When 남김 · 지움을 알리면 Then 창(window) 알림에 바뀐 내용이 실려 온다', () => {
    const heard: unknown[] = [];
    const listener = (event: Event) => heard.push((event as CustomEvent).detail);
    window.addEventListener(DAY_MEMO_CHANGED_EVENT, listener);
    announceDayMemoChange({ type: 'added', memo });
    announceDayMemoChange({ type: 'deleted', memoId: 'daymemo-1' });
    window.removeEventListener(DAY_MEMO_CHANGED_EVENT, listener);
    expect(heard).toEqual([
      { type: 'added', memo },
      { type: 'deleted', memoId: 'daymemo-1' },
    ]);
  });
});
