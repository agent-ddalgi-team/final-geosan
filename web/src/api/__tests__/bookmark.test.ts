// 관심 켜고 끄기(#357, 약속 v3 #356): 요청 모양(PUT·담당자 머리·본문) / 끄기 거부 오류 / 가짜 모드의 흐름 /
// 관심 값만 다시 읽기. fetch는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { readBookmark } from '../bookmark';
import {
  ApiError,
  getOpportunities,
  getOpportunityDetail,
  postNote,
  postOpinion,
  putBookmark,
} from '../client';

describe('putBookmark (실제 요청 모양)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('PUT /api/v1/opportunities/{oppId}/bookmark 로 본문과 담당자 머리(X-Staff-Key)를 보낸다', async () => {
    const saved = {
      active: true,
      version: 1,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-06T01:00:00Z',
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: saved, meta: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = await putBookmark(
      'opp 1',
      { active: true, expectedVersion: null },
      'park-lee',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v1/opportunities/opp%201/bookmark');
    expect(init.method).toBe('PUT');
    expect(init.headers['X-Staff-Key']).toBe('park-lee');
    expect(JSON.parse(init.body)).toEqual({ active: true, expectedVersion: null });
    expect(envelope.data).toEqual(saved);
  });

  it('끄기가 거부되면(422) 서버의 문구·다음 할 일·종류를 그대로 담은 오류를 던진다', async () => {
    const error = {
      message: '기록이 있는 회사는 관심에서 뺄 수 없습니다',
      nextAction: "빼려면 검토 의견을 '제외'로 저장해 주세요",
      ref: 'r-1',
      kind: 'BOOKMARK_HAS_RECORDS',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 422 })),
    );
    const caught = await putBookmark(
      'opp-1',
      { active: false, expectedVersion: 2 },
      'park-lee',
    ).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(422);
    expect((caught as ApiError).body).toMatchObject(error);
  });
});

describe('가짜 모드의 관심 흐름', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '1');
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('켜고 끄면 값이 바뀌고 판 번호가 올라가며, 같은 값으로 다시 누르면 그대로다', async () => {
    const on = await putBookmark('opp-toggle', { active: true }, 'park-lee');
    expect(on.data).toMatchObject({ active: true, version: 1, updatedBy: 'park-lee' });
    const again = await putBookmark('opp-toggle', { active: true }, 'kim-gwajang');
    expect(again.data).toEqual(on.data);
    const off = await putBookmark('opp-toggle', { active: false }, 'kim-gwajang');
    expect(off.data).toMatchObject({ active: false, version: 2, updatedBy: 'kim-gwajang' });
  });

  it.each([null, 'viewer'])(
    '담당자가 %s이면 기존 가짜 403과 같은 오류를 돌려준다',
    async (staff) => {
      const caught = await putBookmark(
        'opp-403',
        { active: true },
        staff as unknown as string,
      ).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ApiError);
      expect((caught as ApiError).status).toBe(403);
    },
  );

  it('메모나 검토 의견을 저장하면 관심이 켜지고(자동 관심), 그 뒤 끄기는 422로 거부된다', async () => {
    await postNote('opp-note', { text: '메모' }, 'park-lee');
    expect(await readBookmark('opp-note')).toMatchObject({ active: true, updatedBy: 'park-lee' });
    const refused = await putBookmark('opp-note', { active: false }, 'park-lee').catch(
      (e: unknown) => e,
    );
    expect((refused as ApiError).status).toBe(422);
    expect((refused as ApiError).body).toMatchObject({
      kind: 'BOOKMARK_HAS_RECORDS',
      message: '기록이 있는 회사는 관심에서 뺄 수 없습니다',
      nextAction: "빼려면 검토 의견을 '제외'로 저장해 주세요",
    });

    await postOpinion('opp-opinion', { opinion: 'WORTH_REVIEW', evalId: 'eval-1' }, 'park-lee');
    expect(await readBookmark('opp-opinion')).toMatchObject({ active: true });
  });

  it('목록과 상세의 관심 값은 켜고 끈 대로 보이고, bookmarked=true면 관심 기업만 돌려준다', async () => {
    const before = await getOpportunities(1, 20, undefined, {});
    const oppId = before.data[0].oppId;
    expect(before.data[0].records.bookmark ?? null).toBeNull();
    const none = await getOpportunities(1, 20, undefined, { bookmarked: 'true' });
    expect(none.data).toHaveLength(0);
    expect(none.meta.total).toBe(0);

    await putBookmark(oppId, { active: true }, 'park-lee');
    const only = await getOpportunities(1, 20, undefined, { bookmarked: 'true' });
    expect(only.data.map((card) => card.oppId)).toEqual([oppId]);
    expect(only.data[0].records.bookmark).toMatchObject({ active: true });
    const detail = await getOpportunityDetail(oppId);
    expect(detail.data.records.bookmark).toMatchObject({ active: true, version: 1 });
  });

  it('한 번도 켠 적이 없는 회사의 관심 값은 null로 읽힌다', async () => {
    expect(await readBookmark('opp-never')).toBeNull();
  });
});
