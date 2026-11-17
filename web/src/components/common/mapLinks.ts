// 지도앱 검색 링크(distance-map-proposal-20261103 2장). 서버를 거치지 않고 화면이 주소로 링크를 만든다. API 키 없음.
// 카카오맵은 "충청남도 …"처럼 도 이름을 길게 쓰면 결과가 없어서 "충남 …"으로 줄여 넣는다.

const PROVINCE_SHORT: [string, string][] = [
  ['충청남도', '충남'],
  ['충청북도', '충북'],
  ['경상남도', '경남'],
  ['경상북도', '경북'],
  ['전라남도', '전남'],
  ['전라북도', '전북'],
  ['전북특별자치도', '전북'],
  ['경기도', '경기'],
  ['강원특별자치도', '강원'],
  ['강원도', '강원'],
  ['제주특별자치도', '제주'],
];

/** 주소 맨 앞의 도 이름을 약칭으로 바꾼다. 도 이름이 없으면 그대로 둔다. */
export function shortenProvince(address: string): string {
  const text = address.trim();
  for (const [full, short] of PROVINCE_SHORT) {
    if (text.startsWith(`${full} `)) return `${short}${text.slice(full.length)}`;
  }
  return text;
}

export interface MapLinks {
  naver: string;
  kakao: string;
}

/** 주소가 비어 있으면 null. 두 링크 모두 새 창에서 열린다(target=_blank, rel=noopener). */
export function buildMapLinks(address: string | null | undefined): MapLinks | null {
  const text = address?.trim();
  if (!text) return null;
  return {
    naver: `https://map.naver.com/p/search/${encodeURIComponent(text)}`,
    kakao: `https://map.kakao.com/link/search/${encodeURIComponent(shortenProvince(text))}`,
  };
}
