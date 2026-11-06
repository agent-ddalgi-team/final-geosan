// 추천 목록에서 마지막으로 본 공정을 이 브라우저에 기억한다(#368, 2026-11-06 PM 결정).
// 공정 없이 목록을 열면 이 값으로 바로 연다. 계정이 없어 담당자 키처럼 localStorage에 둔다(공정 코드 하나뿐이다).
export const LAST_PROCESS_STORAGE_KEY = 'geosan.list.lastProcess';

export function readLastProcess(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROCESS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLastProcess(code: string | null): void {
  try {
    if (code) window.localStorage.setItem(LAST_PROCESS_STORAGE_KEY, code);
    else window.localStorage.removeItem(LAST_PROCESS_STORAGE_KEY);
  } catch {
    // 저장소를 못 써도 목록은 그대로 쓸 수 있다. 다음에 열 때 공정을 다시 고르면 된다.
  }
}
