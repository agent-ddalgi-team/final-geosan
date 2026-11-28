// 연락처 먼저 알리기(#985, PM 결정 2026-11-29): 접촉 메모에 전화번호 · 이메일이 있으면 [보내기] · [저장] ·
// [이대로 저장]을 누르기 전에 화면이 먼저 알린다. 서버는 접촉 메모의 연락처를 400으로 거부하는데(CON-11),
// 전에는 번호를 지운 사본으로 AI 비용이 먼저 나간 뒤 저장에서 막혔다.
// 찾는 범위는 서버(geosan/config/validators.py CONTACT_PATTERNS)와 같다: 이메일 / 국내 전화(02-123-4567,
// 010-1234-5678, (02) 1234-5678, 02.1234.5678) / 구분 기호 없는 휴대전화(01012345678) / 국제 표기(+82-10-…).
// 화면은 미리 알리는 것일 뿐이고, 막는 것은 여전히 서버다(전각 숫자처럼 화면이 놓친 것도 서버가 거부한다).
// 옛 브라우저에서도 읽히도록 뒤돌아보기(lookbehind) 없이 "앞 글자가 숫자 · 붙임표가 아님"을 앞 글자 한 자로 본다.

export type ContactKind = 'EMAIL' | 'PHONE';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_DOMESTIC = /(?:^|[^\d-])\(?0\d{1,2}\)?[\s.-]{0,3}\d{3,4}[\s.-]{1,3}\d{4}(?![\d-])/;
const PHONE_MOBILE_PLAIN = /(?:^|\D)01[016789]\d{7,8}(?!\d)/;
const PHONE_INTERNATIONAL = /\+\s?82[\s.-]?\(?0?\)?\s?\d{1,2}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}/;

/** 글에 연락처 모양이 있으면 그 종류, 없으면 null. */
export function findContact(text: string): ContactKind | null {
  if (EMAIL.test(text)) return 'EMAIL';
  if (
    PHONE_DOMESTIC.test(text) ||
    PHONE_MOBILE_PLAIN.test(text) ||
    PHONE_INTERNATIONAL.test(text)
  ) {
    return 'PHONE';
  }
  return null;
}
