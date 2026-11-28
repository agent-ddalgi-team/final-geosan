// "부재" 낱말(#985, PM 결정 2026-11-29): 기록 남기기 메모가 아래 낱말 하나뿐이면 영업 코치(AI)를 부르지 않고
// [저장] 한 번으로 "부재" 접촉을 남긴다. 부재는 AI가 판단할 일이 아니어서 비용을 쓰지 않는다.
// 규칙 숫자가 아니라 화면이 알아보는 낱말이다. 낱말을 더하거나 뺄 때는 PM 확인 뒤 이 파일만 고친다.
// 견줄 때: 앞뒤 빈칸과 끝의 마침표를 떼고, 띄어쓰기는 무시한다. 낱말과 "같을" 때만이다 —
// "부재. 내일 다시 전화"처럼 다른 말이 섞이면 해당하지 않고 [보내기 유료]로 남는다.
import type { ContactMethod } from '../../api/types';

export const ABSENT_WORDS: Record<ContactMethod, readonly string[]> = {
  CALL: ['부재', '연락 안 됨', '안 받음', '통화 안 됨', '전화 안 받음'],
  EMAIL: ['답 없음', '회신 없음'],
  VISIT: ['못 만남', '부재'],
};

function squash(text: string): string {
  return text
    .trim()
    .replace(/[.。]+$/u, '')
    .replace(/\s+/gu, '');
}

/** 메모가 그 종류의 "부재" 낱말 하나와 같은가. */
export function isAbsentMemo(method: ContactMethod, memo: string): boolean {
  const text = squash(memo);
  if (text === '') return false;
  return ABSENT_WORDS[method].some((word) => squash(word) === text);
}
