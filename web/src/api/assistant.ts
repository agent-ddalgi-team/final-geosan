// 영업 비서(#680, 계약 C1 `POST /assistant/ask` · `POST /opportunities/{oppId}/assistant/call-prep`).
// client.ts·types.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다. 필드 이름은 계약 모양 그대로(camelCase).
// 서버는 메모 글 없이 고른 값만 외부 AI에 보내 답을 받는다. 읽기 전용이지만 AI에 보내는 일이라 담당자 키가 필요하다.
// 가짜 응답 모드(VITE_USE_FIXTURES=1)에는 이 경로의 고정값이 없어 화면이 오류 한 줄을 보인다.
import { request } from './client';
import type { ConfigUi } from './types';

/** 서버가 AI 응답을 60초까지 기다린다(계약 C9). 화면은 그보다 조금 더 기다린다. */
export const ASSISTANT_TIMEOUT_MS = 70_000;

export interface AssistantSource {
  oppId: string;
  name: string;
}

export interface AssistantAnswer {
  answer: string;
  /** 답의 근거 회사. AI가 아니라 서버가 만든다(조회에 실린 회사 가운데 답에 이름이 나온 곳만). */
  sources: AssistantSource[];
  aiGenerated: true;
  usedQueries: string[];
  /** 질문에 답하기에만 온다: 조회에 실은 회사 수와 대상 회사 전체 수. */
  companiesIncluded?: number;
  companiesTotal?: number;
}

/** `/config/ui`의 `assistant`(더하는 변경 #680). 서버가 아직 안 주면 없음 = 화면에 아무것도 보이지 않는다. */
export interface AssistantConfig {
  /** 영업 기록 전용 스위치와 전체 AI 스위치가 모두 켜져 있을 때만 true. */
  enabled: boolean;
  questionMaxLength: number | null;
}

export function assistantConfigOf(config: ConfigUi | null): AssistantConfig | null {
  const value = (config as { assistant?: AssistantConfig } | null)?.assistant;
  return value && typeof value.enabled === 'boolean' ? value : null;
}

export function postAssistantAsk(question: string, staffKey: string) {
  return request<AssistantAnswer>('/assistant/ask', {
    method: 'POST',
    body: { question },
    staffKey,
    timeoutMs: ASSISTANT_TIMEOUT_MS,
  });
}

export function postCallPrep(oppId: string, staffKey: string) {
  return request<AssistantAnswer>(
    `/opportunities/${encodeURIComponent(oppId)}/assistant/call-prep`,
    { method: 'POST', staffKey, timeoutMs: ASSISTANT_TIMEOUT_MS },
  );
}
