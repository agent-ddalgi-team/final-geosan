// 영업 코치(#742, 계약 C1 `POST /opportunities/{oppId}/assistant/coach`).
// 저장 전 접촉 메모 하나와 그 회사의 지난 기록을 서버가 이름·전화를 지운 사본으로 AI에 보내 정리해 준다.
// 읽기 전용이다: 저장은 담당자가 [이대로 저장]을 누를 때 화면이 기존 /outcomes·/notes를 부른다.
// client.ts·types.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다. 필드 이름은 계약 모양 그대로(camelCase).
import { ASSISTANT_TIMEOUT_MS } from './assistant';
import { request } from './client';
import type { ContactMethod, SalesStep } from './types';

export interface CoachAnswer {
  questionId: string;
  /** 고정 보기 질문은 보기 id 하나, 공정·산업 질문은 여러 개. */
  answerIds: string[];
  /** 근거가 된 메모 구절(지운 사본에서 딴 것). 일정에서 채운 "다음 할 일"은 빈 글. */
  quote: string;
  /** AI = 미리 채우고 "AI가 채움" 표시, SUGGEST = 제안으로만 보이고 미리 고르지 않는다. */
  fill: 'AI' | 'SUGGEST';
}

export interface CoachResult {
  answers: CoachAnswer[];
  /** 다음 일정(할 일은 "다음 할 일은?"의 보기 id). 날짜를 못 읽었으면 date가 null. */
  nextSchedule: { actionId: string; date: string | null } | null;
  /** 지난 기록을 짚는 피드백 0~3줄. */
  feedback: string[];
  /** (#750) 같은 호출에서 받은 다음 통화에 물어볼 것 0~3줄. [이대로 저장] 때 CALL_PREP로 남긴다. */
  nextCall: string[];
  summary: string;
  /** 규칙으로 계산한 빠진 필수 질문(AI 아님). 질문 파일 순서. */
  missingRequired: string[];
  stepBefore: SalesStep;
  stepAfter: SalesStep;
  aiGenerated: true;
  removedNames: number;
  removedContacts: number;
}

export function postCoach(
  oppId: string,
  body: { memo: string; method: ContactMethod; attemptedAt?: string },
  staffKey: string,
) {
  return request<CoachResult>(`/opportunities/${encodeURIComponent(oppId)}/assistant/coach`, {
    method: 'POST',
    body,
    staffKey,
    timeoutMs: ASSISTANT_TIMEOUT_MS,
  });
}
