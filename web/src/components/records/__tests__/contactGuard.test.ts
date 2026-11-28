// 연락처 먼저 알리기(#985, PM 결정 2026-11-29): 서버가 접촉 메모에서 거부하는 모양(전화번호 · 이메일)과 같은 범위.
// 번호 · 주소는 모두 가짜다.
import { findContact } from '../contactGuard';

describe('메모의 전화번호 · 이메일 찾기 (#985 마)', () => {
  it.each([
    '구매팀과 통화. 010-0000-0000으로 다시 전화 달라고 함',
    '대표번호 02-000-0000',
    '(02) 0000-0000 로 연락',
    '031.000.0000',
    '041 000 0000',
    '휴대폰 01000000000',
    '+82-10-0000-0000',
    '+82 2 000 0000',
  ])('Given "%s" When 찾으면 Then 전화번호다', (text) => {
    expect(findContact(text)).toBe('PHONE');
  });

  it('Given 이메일 주소 When 찾으면 Then 이메일이다', () => {
    expect(findContact('견적은 buyer@example.com 으로 보내 달라고 함')).toBe('EMAIL');
  });

  it.each([
    '구매팀과 통화. 견적 요청 받음. 금요일에 다시 전화하기로',
    '12/3에 다시 가져가기로',
    '두께 0.8mm, 수량 3000개',
    '2026-11-29 방문',
    '사업자번호 0000000000 확인',
    '',
  ])('Given 연락처가 없는 "%s" When 찾으면 Then 없다', (text) => {
    expect(findContact(text)).toBeNull();
  });

  it('Given 더 긴 숫자 줄의 한 부분 When 찾으면 Then 전화번호로 보지 않는다(서버와 같다)', () => {
    expect(findContact('주문번호 1-010-0000-0000-9')).toBeNull();
    expect(findContact('일련번호 9010000000001')).toBeNull();
  });
});
