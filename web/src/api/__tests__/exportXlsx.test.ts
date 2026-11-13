// 엑셀 내려받기 요청(#217): 주소·조건 모양 / 파일 이름 읽기 / 거부(422)·접속 확인(401)·끊김은 ApiError / 가짜 모드.
// fetch는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { ApiError, SESSION_REQUIRED_EVENT } from '../client';
import { XLSX_MEDIA_TYPE, fileNameFrom, getListXlsx, saveFile } from '../exportXlsx';
import { errorTexts, listExport } from '../../labels/ko';

const DISPOSITION =
  'attachment; filename="geosan-list-20261113.xlsx"; ' +
  "filename*=UTF-8''%EA%B1%B0%EC%82%B0_%EC%B6%94%EC%B2%9C%EB%AA%A9%EB%A1%9D_20261113.xlsx";

function fileResponse(headers: Record<string, string> = {}) {
  return new Response(new Blob(['PK-가짜 파일']), {
    status: 200,
    headers: { 'Content-Type': XLSX_MEDIA_TYPE, 'Content-Disposition': DISPOSITION, ...headers },
  });
}

describe('getListXlsx (#217)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('GET /api/v1/export/xlsx 로 고른 조건만 보내고(쪽 번호 없음) 담당자 머리는 보내지 않는다', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fileResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const file = await getListXlsx({
      process: 'ANODIZING',
      region: '아산시',
      industry: null,
      stage: null,
      filter: null,
      q: null,
      bookmarked: 'true',
      opinion: 'NEED_CHECK',
      sort: 'recent',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    const [path, search] = (url as string).split('?');
    expect(path).toBe('/api/v1/export/xlsx');
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      tab: 'new',
      process: 'ANODIZING',
      region: '아산시',
      bookmarked: 'true',
      opinion: 'NEED_CHECK',
      sort: 'recent',
    });
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['X-Staff-Key']).toBeUndefined();
    expect(file.fileName).toBe('거산_추천목록_20261113.xlsx');
    expect(file.blob.size).toBeGreaterThan(0);
  });

  it('파일 이름은 한글 이름을 먼저, 없으면 영문 이름, 그것도 없으면 기본 이름을 쓴다', () => {
    expect(fileNameFrom(DISPOSITION)).toBe('거산_추천목록_20261113.xlsx');
    expect(fileNameFrom('attachment; filename="geosan-list-20261113.xlsx"')).toBe(
      'geosan-list-20261113.xlsx',
    );
    expect(fileNameFrom(null)).toBe(listExport.defaultFileName);
    expect(fileNameFrom("attachment; filename*=UTF-8''%E0%A4%A")).toBe(listExport.defaultFileName);
  });

  it('거부(422 EXPORT_REJECTED)면 서버가 준 말 그대로 ApiError를 던지고 파일을 돌려주지 않는다', async () => {
    const error = {
      message: '내보낼 수 없는 항목이 있어 엑셀 파일을 만들지 않았습니다.',
      nextAction: '아래 번호와 함께 운영자에게 알려 주세요.',
      ref: 'abc12345',
      kind: 'EXPORT_REJECTED',
      rejectedItems: [{ refId: 'opp-1', reason: '보안 등급이 금지이거나 확인되지 않았습니다.' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 422 })),
    );
    const caught = await getListXlsx({}).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(422);
    expect((caught as ApiError).body).toEqual(error);
  });

  it('접속 확인이 필요하면(401) 접속 화면을 띄우라는 신호를 보낸다', async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_REQUIRED_EVENT, listener);
    const error = { message: '접속 확인이 필요합니다.', nextAction: '비밀번호', ref: 'r1' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 401 })),
    );
    await expect(getListXlsx({})).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_REQUIRED_EVENT, listener);
  });

  it('오류 본문이 JSON이 아니거나 엑셀이 아닌 200 응답이면 파일로 저장하지 않고 오류로 본다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 500 })));
    await expect(getListXlsx({})).rejects.toMatchObject({
      status: 500,
      body: { message: errorTexts.network, kind: 'HTTP_500' },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
        ),
    );
    await expect(getListXlsx({})).rejects.toMatchObject({ body: { kind: 'BAD_FILE' } });
  });

  it('서버에 닿지 못하면 연결 오류, 10초를 넘기면 시간 초과 오류다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(getListXlsx({})).rejects.toMatchObject({ body: { kind: 'NETWORK' } });
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    const pending = getListXlsx({}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(((await pending) as ApiError).body.kind).toBe('TIMEOUT');
  });

  it('가짜 응답 모드에서는 서버를 부르지 않고 만들 수 없다고 알린다', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '1');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(getListXlsx({})).rejects.toMatchObject({
      body: { message: listExport.noFixture, kind: 'NO_FIXTURE' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saveFile은 받은 파일을 그 이름으로 내려받게 하고 임시 주소를 지운다', () => {
    const create = vi.fn(() => 'blob:fake');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: revoke });
    const clicked: { href: string; download: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    const blob = new Blob(['x']);
    saveFile({ blob, fileName: '거산_추천목록_20261113.xlsx' });
    expect(create).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:fake', download: '거산_추천목록_20261113.xlsx' }]);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });
});
