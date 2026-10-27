// 출처 글 안의 http(s) 주소를 찾는다(#174). 주소가 아닌 글은 그대로 두고, 주소 끝의 문장부호는 주소에서 뺀다.
export interface SourcePart {
  text: string;
  /** 주소인 조각만 값이 있다. */
  href?: string;
}

const URL_PATTERN = /https?:\/\/\S+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

export function splitSourceRef(sourceRef: string): SourcePart[] {
  const parts: SourcePart[] = [];
  let last = 0;
  for (const match of sourceRef.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (!/^https?:\/\/\S/.test(url)) continue;
    if (start > last) parts.push({ text: sourceRef.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < sourceRef.length) parts.push({ text: sourceRef.slice(last) });
  return parts;
}
