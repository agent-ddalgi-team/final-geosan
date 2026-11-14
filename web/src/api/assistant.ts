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

// ---------- 메모 읽기(#720, 계약 C1 `POST /opportunities/{oppId}/assistant/memo-read`) ----------
// 서버가 메모 글 하나를 사람 이름·전화·이메일을 지운 사본으로 AI에 보내 한 줄 요약과 변경 제안을 받는다.
// 읽기 전용이다: 제안은 저장되지 않고, 담당자가 [반영]을 누르면 화면이 기존 저장 창구를 부른다.

export type MemoProposalKind = 'PROCESS' | 'INDUSTRY' | 'NEXT_SCHEDULE';

export interface MemoProposal {
  kind: MemoProposalKind;
  /** PROCESS = 공정 코드(확정 공정 전체가 될 값), INDUSTRY = 산업군 이름, NEXT_SCHEDULE = 다음 할 일 보기 id 하나. */
  values: string[];
  /** 지금 값의 이름(없으면 빈 배열). NEXT_SCHEDULE은 "11/20 견적" 꼴. */
  before: string[];
  /** 새 값의 이름. NEXT_SCHEDULE은 할 일 이름 하나. */
  after: string[];
  /** NEXT_SCHEDULE의 날짜(YYYY-MM-DD). 다른 종류는 null. */
  date: string | null;
  /** 근거가 된 메모 구절(이름·연락처를 지운 사본에서 그대로 딴 것). */
  quote: string;
}

export interface MemoReadAnswer {
  summary: string;
  proposals: MemoProposal[];
  aiGenerated: true;
  removedNames: number;
  removedContacts: number;
}

export function postMemoRead(
  oppId: string,
  recordKind: 'NOTE' | 'OUTCOME',
  recordId: string,
  staffKey: string,
) {
  return request<MemoReadAnswer>(
    `/opportunities/${encodeURIComponent(oppId)}/assistant/memo-read`,
    { method: 'POST', body: { recordKind, recordId }, staffKey, timeoutMs: ASSISTANT_TIMEOUT_MS },
  );
}
