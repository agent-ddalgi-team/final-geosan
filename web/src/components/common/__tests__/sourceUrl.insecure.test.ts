// #810: https 인증서 오류로 http로 읽은 근거는 출처 주소가 http로 남는다. 화면은 그 옆에 표시를 붙인다.
import { splitSourceRef } from '../sourceUrl';

it('http 출처 주소 뒤에 "(암호화 없는 주소로 읽음)"이 붙고, https 주소에는 붙지 않는다', () => {
  const http = splitSourceRef('코파스 홈페이지 제품 http://kofas.example/productK/');
  expect(http.map((part) => part.text).join('')).toBe(
    '코파스 홈페이지 제품 http://kofas.example/productK/ (암호화 없는 주소로 읽음)',
  );
  expect(http.filter((part) => part.href)).toEqual([
    { text: 'http://kofas.example/productK/', href: 'http://kofas.example/productK/' },
  ]);
  const https = splitSourceRef('홈페이지 https://kofas.example/');
  expect(https.map((part) => part.text).join('')).toBe('홈페이지 https://kofas.example/');
});
