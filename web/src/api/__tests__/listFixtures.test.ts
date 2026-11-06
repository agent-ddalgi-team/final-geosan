// 가짜 모드(VITE_USE_FIXTURES=1)의 목록 응답(#361): 공정 9종(0곳 포함)이 오고, 0곳인 공정은 빈 목록, 검색어는 제목으로 거른다.
// 서버 없이 가짜 응답만 본 확인이며 실제 서버 연결 확인이 아니다.
import { getOpportunities } from '../client';

describe('가짜 모드의 목록 머리 응답', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '1');
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('공정 9종이 모두 오고 0곳인 공정도 실려 있으며, 맨 첫 공정이 0곳이라 회사가 있는 첫 공정은 두 번째다', async () => {
    const { meta } = await getOpportunities(1, 20, undefined, {});
    const counts = meta.processCounts ?? [];
    expect(counts).toHaveLength(9);
    expect(new Set(counts.map((item) => item.processCode)).size).toBe(9);
    expect(counts[0]).toMatchObject({ processCode: 'ZINC_PLATING', count: 0 });
    expect(counts.find((item) => item.count > 0)).toMatchObject({
      processCode: 'ANODIZING',
      processName: '아노다이징',
      count: 1,
    });
    expect(counts.filter((item) => item.count === 0)).toHaveLength(8);
  });

  it('회사가 있는 공정을 고르면 카드가 오고, 0곳인 공정을 고르면 빈 목록(전체 0곳)이 온다', async () => {
    const filled = await getOpportunities(1, 20, undefined, { process: 'ANODIZING' });
    expect(filled.data).toHaveLength(1);
    expect(filled.meta.total).toBe(1);
    const empty = await getOpportunities(1, 20, undefined, { process: 'CHROME_PLATING' });
    expect(empty.data).toHaveLength(0);
    expect(empty.meta.total).toBe(0);
    // 빈 목록이어도 선택란을 그릴 공정 9종은 그대로 온다.
    expect(empty.meta.processCounts).toHaveLength(9);
  });

  it('검색어를 주면 제목에 그 글자가 든 회사만 오고, 없는 이름이면 빈 목록이 온다', async () => {
    const found = await getOpportunities(1, 20, undefined, { q: 'A정밀' });
    expect(found.data).toHaveLength(1);
    const none = await getOpportunities(1, 20, undefined, { q: '없는회사' });
    expect(none.data).toHaveLength(0);
    expect(none.meta.total).toBe(0);
  });
});
