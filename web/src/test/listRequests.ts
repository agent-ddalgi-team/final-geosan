// 시험 도우미(#981): 가짜 목록 창구(getOpportunities) 호출 가운데 "목록 요청"만 골라 본다.
// 관심 기업 화면은 목록 요청 말고 맨 위 "의견 전" 띠가 곳 수를 읽는 요청을 하나 더 보낸다
// (한 줄만 읽는다: 쪽 1 · 쪽 크기 1 · 지금 화면의 조건 + 관심 기업 + 의견 전).
// "목록을 어떤 조건으로 몇 번 불렀나"를 보는 시험은 이 도우미로 띠 요청을 빼고 본다.
import type { getOpportunities } from '../api/client';

type ListCall = Parameters<typeof getOpportunities>;

/**
 * "의견 전" 띠가 곳 수를 읽는 요청인지. 쪽 1 · 한 줄(쪽 크기 1)이고 관심 기업 + "의견 전" 조건(filter=NO_OPINION)일 때만 참이다.
 * "의견 전"은 영업 홈의 같은 이름 칸과 같은 기준이다(관심 + 의견 없음 + 영업 단계 전). 의견 거르기(opinion)는 띠가 비워 보낸다.
 * 화면의 목록 요청은 쪽 크기가 20이라, [의견 전만 보기]로 거른 목록 요청(filter=NO_OPINION)도 이 모양과 겹치지 않는다.
 */
export function isNoOpinionCountCall(call: ListCall): boolean {
  const [page, pageSize, , filters] = call;
  if (page !== 1 || pageSize !== 1 || !filters) return false;
  return filters.bookmarked === 'true' && filters.filter === 'NO_OPINION';
}

/** 목록 요청만(띠의 곳 수 요청을 뺀 것). 부른 순서 그대로다. */
export function listCallsOf(calls: ListCall[]): ListCall[] {
  return calls.filter((call) => !isNoOpinionCountCall(call));
}

/** "의견 전" 띠의 곳 수 요청만. */
export function noOpinionCountCallsOf(calls: ListCall[]): ListCall[] {
  return calls.filter(isNoOpinionCountCall);
}
