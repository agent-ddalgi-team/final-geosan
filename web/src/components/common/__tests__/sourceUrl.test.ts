// 출처 글에서 주소 찾기(#174): 글은 그대로, 주소 조각만 링크 대상, 끝 문장부호는 주소에서 뺀다.
import { describe, expect, it } from 'vitest';
import { splitSourceRef } from '../sourceUrl';

describe('splitSourceRef', () => {
  it('주소가 없으면 글 전체가 주소 없는 한 조각이다', () => {
    expect(splitSourceRef('카탈로그 3쪽 (인쇄면)')).toEqual([{ text: '카탈로그 3쪽 (인쇄면)' }]);
  });

  it('글 뒤의 주소만 주소 조각으로 나눈다', () => {
    expect(splitSourceRef('코파스 홈페이지 http://kofas.com/productK/')).toEqual([
      { text: '코파스 홈페이지 ' },
      { text: 'http://kofas.com/productK/', href: 'http://kofas.com/productK/' },
    ]);
  });

  it('주소 끝의 마침표·닫는 괄호는 주소에 넣지 않고 글로 남긴다', () => {
    expect(splitSourceRef('(출처 https://example.com/a).')).toEqual([
      { text: '(출처 ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: ').' },
    ]);
  });

  it('http 가 아닌 주소(javascript: 등)는 링크로 만들지 않는다', () => {
    expect(splitSourceRef('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });
});
