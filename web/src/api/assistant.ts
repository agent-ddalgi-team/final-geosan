// 영업 비서(#680, 계약 C1 `POST /assistant/ask` · `POST /opportunities/{oppId}/assistant/call-prep`).
// client.ts·types.ts(경계 파일)는 고치지 않고 request만 가져다 쓴다. 필드 이름은 계약 모양 그대로(camelCase).
// 서버는 메모 글 없이 고른 값만 외부 AI에 보내 답을 받는다. 읽기 전용이지만 AI에 보내는 일이라 담당자 키가 필요하다.
// 가짜 응답 모드(VITE_USE_FIXTURES=1)에는 이 경로의 고정값이 없어 화면이 오류 한 줄을 보인다.
import { request } from './client';
import type { ConfigUi, OutcomeResponse } from './types';

/** 서버가 AI 응답을 60초까지 기다린다(계약 C9). 화면은 그보다 조금 더 기다린다. */
export const ASSISTANT_TIMEOUT_MS = 70_000;

export interface AssistantSource {
  oppId: string;
  name: string;
}

/** 답 아래 할 일 제안 하나(#774). 서버가 검증한 값이고 [넣기]를 눌러야 저장된다. */
export interface AssistantSuggestion {
  oppId: string;
  name: string;
  /** 꼬리 질문 "다음 할 일은?"의 보기 id와 그 이름(예: VISIT · 방문). */
  actionId: string;
  actionLabel: string;
  /** 넣을 날짜(YYYY-MM-DD). */
  date: string;
  /** 그 회사의 지금 다음 일정. 있으면 [넣기] 전에 "바꿀까요?"를 묻는다. */
  currentScheduleAt: string | null;
  currentScheduleNote: string | null;
  /** 최신 영업 기록 번호(기록이 없으면 0). [넣기] 때 그대로 보낸다. */
  outcomeVersion: number;
}

/** 오른쪽 영업 코치 칸이 놓인 화면(#774). LIST(신규 거래처 찾기)면 서버가 후보 표를 더 싣는다. */
export type AssistantPage = 'DASHBOARD' | 'LIST' | 'BOOKMARKS' | 'ANALYSIS';

export interface AssistantAnswer {
  answer: string;
  /** 답의 근거 회사. AI가 아니라 서버가 만든다(조회에 실린 회사 가운데 답에 이름이 나온 곳만). */
  sources: AssistantSource[];
  aiGenerated: true;
  usedQueries: string[];
  /** 질문에 답하기에만 온다: 조회에 실은 회사 수와 대상 회사 전체 수. */
  companiesIncluded?: number;
  companiesTotal?: number;
  /** 질문에 답하기에만 온다(#774): 할 일 제안 0~3개. 옛 서버는 칸이 없다. */
  suggestions?: AssistantSuggestion[];
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

export function postAssistantAsk(
  question: string,
  staffKey: string,
  page: AssistantPage | null = null,
) {
  return request<AssistantAnswer>('/assistant/ask', {
    method: 'POST',
    body: page ? { question, page } : { question },
    staffKey,
    timeoutMs: ASSISTANT_TIMEOUT_MS,
  });
}

// ---------- [넣기](#774, 계약 C1 `POST /opportunities/{oppId}/schedule`) ----------
// 영업 코치가 권한 일정을 담당자가 누를 때만 저장한다. 단계·이유는 그대로, 일정과 할 일만 바뀐다.

export interface ScheduleSetBody {
  nextScheduleAt: string;
  actionId: string;
  expectedVersion: number;
}

export function postSchedule(oppId: string, body: ScheduleSetBody, staffKey: string) {
  return request<OutcomeResponse>(`/opportunities/${encodeURIComponent(oppId)}/schedule`, {
    method: 'POST',
    body,
    staffKey,
  });
}

/** [넣기]로 일정이 바뀌면 창(window)에 알린다. 대시보드가 듣고 오늘 확인할 것을 다시 읽는다. */
export const SCHEDULE_CHANGED_EVENT = 'geosan:schedule-changed';

// ---------- 오늘 정리(#743, 계약 C1 `GET /assistant/daily`) ----------
// 서버가 하루(한국 날짜) 한 번만 AI를 부르고, 같은 날 다시 부르면 기억해 둔 글을 준다(reused = true).
// 일정·같이 들를 곳(거리는 프로그램이 잰 값)·지난 7일 단계 이동·보류 회사를 몇 줄로 정리한 글이다.

export interface DailyBrief {
  summary: string;
  /** 글의 근거 회사. AI가 아니라 서버가 만든다. */
  sources: AssistantSource[];
  aiGenerated: true;
  /** 한국 날짜(YYYY-MM-DD). */
  day: string;
  generatedAt: string;
  /** true = 오늘 이미 쓴 글을 다시 준 것(AI를 부르지 않음). */
  reused: boolean;
}

export function getAssistantDaily(staffKey: string, signal?: AbortSignal) {
  return request<DailyBrief>('/assistant/daily', {
    staffKey,
    signal,
    timeoutMs: ASSISTANT_TIMEOUT_MS,
  });
}

// (#750) 상세의 [통화 준비 💰]는 화면에서 뺐다. 영업 코치가 [보내기] 한 번에 다음 통화 준비도 주고,
// 저장한 것을 상세가 records.callPrep으로 받는다. 서버의 call-prep 창구는 그대로 둔다(약속 C1).

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
