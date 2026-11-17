// 지도 링크: 네이버는 주소 그대로, 카카오맵은 도 이름을 줄인 주소로 만든다(distance-map-proposal-20261103).
import { buildMapLinks, shortenProvince } from '../mapLinks';

const ADDRESS = '충청남도 천안시 서북구 성거읍 봉주로 303-1';

describe('mapLinks', () => {
  it('충청남도를 충남으로 줄인다', () => {
    expect(shortenProvince(ADDRESS)).toBe('충남 천안시 서북구 성거읍 봉주로 303-1');
  });

  it('도 이름이 없는 주소는 그대로 둔다', () => {
    expect(shortenProvince('천안시 서북구 봉주로 303-1')).toBe('천안시 서북구 봉주로 303-1');
  });

  it('네이버는 원래 주소, 카카오는 줄인 주소를 주소창 글자로 바꿔 넣는다', () => {
    const links = buildMapLinks(ADDRESS);
    expect(links?.naver).toBe(`https://map.naver.com/p/search/${encodeURIComponent(ADDRESS)}`);
    expect(links?.kakao).toBe(
      `https://map.kakao.com/link/search/${encodeURIComponent('충남 천안시 서북구 성거읍 봉주로 303-1')}`,
    );
  });

  it('주소가 없거나 비어 있으면 링크를 만들지 않는다', () => {
    expect(buildMapLinks(null)).toBeNull();
    expect(buildMapLinks(undefined)).toBeNull();
    expect(buildMapLinks('   ')).toBeNull();
  });
});
