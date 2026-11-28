// 달력 날짜 메모(#984, 계약 C1 `GET·POST /day-memos` · `DELETE /day-memos/{memoId}`, PM 결정 2026-11-28).
// 어느 날짜든 짧은 메모를 남기고 팀이 함께 본다. 읽기는 누구나(담당자 키 없이), 남기기는 기록 담당자만,
// 지우기는 쓴 사람만 한다. 메모는 내부 메모라 AI · 엑셀로 내보내지 않는다(이 파일에도 그런 길이 없다).
// client.ts의 request만 가져다 쓴다. 필드 이름은 계약 모양 그대로(camelCase).
// 가짜 응답 모드(VITE_USE_FIXTURES=1)에는 이 경로의 고정값이 없어 메모 칸이 "불러오지 못했습니다"를 보인다.
import { request } from './client';

/** 메모 글자 수 상한(계약 C1 `POST /day-memos`: text 1~200자). 서버도 같은 값으로 막는다. */
export const DAY_MEMO_MAX_LENGTH = 200;
/** 한 번에 읽을 수 있는 기간(from · to 포함한 날 수, 계약 C1). 달력은 한 달씩만 읽는다. */
export const DAY_MEMO_MAX_RANGE_DAYS = 93;

/** 날짜 메모 한 건. staffName은 지금 담당자 표의 표시 이름이고 표에 없으면 null이다. */
export interface DayMemo {
  memoId: string;
  /** 메모를 붙인 날짜(YYYY-MM-DD). */
  day: string;
  text: string;
  /** 쓴 사람의 담당자 키. */
  staffKey: string;
  staffName: string | null;
  /** 적은 시각(시간대가 붙은 시각). */
  createdAt: string;
}

export interface DayMemoDeleted {
  memoId: string;
  deleted: boolean;
}

/** 그 기간(둘 다 포함, 최대 93일)의 메모. 서버가 날짜 · 쓴 순서로 준다. 지운 메모는 오지 않는다. */
export function getDayMemos(from: string, to: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ from, to });
  return request<DayMemo[]>(`/day-memos?${query.toString()}`, { signal });
}

/** 그 날짜에 메모 한 건을 남긴다. 보기 전용 · 담당자 미선택은 403, 빈 글 · 200자 초과는 400. */
export function postDayMemo(day: string, text: string, staffKey: string) {
  return request<DayMemo>('/day-memos', { method: 'POST', body: { day, text }, staffKey });
}

/** 쓴 사람만 지운다. 남의 메모면 403, 이미 없으면 404. */
export function deleteDayMemo(memoId: string, staffKey: string) {
  return request<DayMemoDeleted>(`/day-memos/${encodeURIComponent(memoId)}`, {
    method: 'DELETE',
    staffKey,
  });
}

/**
 * 메모를 남기거나 지우면 창(window)에 알린다. 왼쪽 달력 · 영업 홈 "오늘 할 일"의 메모 줄이 듣고 바로 따라온다
 * (일정의 SCHEDULE_CHANGED_EVENT와 같은 방식). detail에 바뀐 내용을 실어 다시 읽지 않고도 고칠 수 있게 한다.
 */
export const DAY_MEMO_CHANGED_EVENT = 'geosan:day-memo-changed';

export type DayMemoChange = { type: 'added'; memo: DayMemo } | { type: 'deleted'; memoId: string };

export function announceDayMemoChange(change: DayMemoChange): void {
  window.dispatchEvent(new CustomEvent<DayMemoChange>(DAY_MEMO_CHANGED_EVENT, { detail: change }));
}
