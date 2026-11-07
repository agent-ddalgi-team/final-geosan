// 추천 목록에서 마지막으로 본 선택을 이 브라우저에 기억한다(#368 → #383, 2026-11-07 PM 결정).
// 값은 공정 코드 하나(그 공정으로 연다) 또는 "묶음 보기" 표시(공정별 묶음으로 연다)다.
// 공정 없이 목록을 열면 이 값으로 바로 연다. 계정이 없어 담당자 키처럼 localStorage에 둔다.
// #368 때 저장된 값(공정 코드만)과 호환된다: 값이 공정 코드면 그 공정으로 연다.
export const LAST_PROCESS_STORAGE_KEY = 'geosan.list.lastProcess';

/** "전체(공정별로 묶음)"를 마지막으로 봤다는 표시 값. 공정 코드(대문자·밑줄)와 겹치지 않는 글자다. */
export const GROUPED_VIEW_CHOICE = '*grouped*';

export function readLastProcess(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROCESS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 공정 코드나 `GROUPED_VIEW_CHOICE`를 기억한다. null이면 기억을 지운다. */
export function storeLastProcess(code: string | null): void {
  try {
    if (code) window.localStorage.setItem(LAST_PROCESS_STORAGE_KEY, code);
    else window.localStorage.removeItem(LAST_PROCESS_STORAGE_KEY);
  } catch {
    // 저장소를 못 써도 목록은 그대로 쓸 수 있다. 다음에 열 때 묶음 보기로 열린다.
  }
}
