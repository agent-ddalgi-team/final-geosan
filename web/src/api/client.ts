// 경계 파일: 고치려면 PM에게 먼저 말한다(계약 C1, 3장).
// 서버 요청 클라이언트(fetch). 응답 형식 Envelope/Error, 요청 중단 한도 10초, 담당자 키 헤더 X-Staff-Key.
// VITE_USE_FIXTURES=1 이면 서버 없이 src/test/fixtures의 가짜 응답을 돌려준다(Part E 초기 개발용).
// 화면 부품은 이 모듈의 함수만 쓰고 fetch를 직접 부르지 않는다.
import type {
  ActivityItem,
  ConfigUi,
  Envelope,
  ErrorBody,
  NoteRequest,
  NoteResponse,
  OpinionRequest,
  OpinionResponse,
  OpportunityCard,
  OpportunityDetail,
  OutcomeRequest,
  OutcomeResponse,
  ReplyRequest,
  ReplyResponse,
  ReviewCheckRequest,
  ReviewCheckResponse,
} from './types';
import { errorTexts } from '../labels/ko';

export const API_BASE = '/api/v1';
/** 요청 중단 한도(목록·상세·기록 10초, 계약 3장). */
export const REQUEST_TIMEOUT_MS = 10_000;
export const STAFF_KEY_HEADER = 'X-Staff-Key';
export const SESSION_REQUIRED_EVENT = 'geosan:session-required';

/** 서버 오류 응답(계약 3장)을 그대로 담는 예외. 화면은 message·nextAction만 보이고 ref는 작게. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /** 기록 요청에만 붙인다. 없으면 헤더를 보내지 않는다. */
  staffKey?: string | null;
  signal?: AbortSignal;
}

export function isFixtureMode(): boolean {
  return import.meta.env.VITE_USE_FIXTURES === '1';
}

function localErrorBody(message: string, kind: string): ErrorBody {
  return { message, nextAction: errorTexts.nextActionDefault, ref: 'local', kind };
}

/** fetch 한 번. 10초를 넘기면 중단하고 timeout 오류로 바꾼다. 오류 응답은 ApiError로 던진다. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  if (isFixtureMode()) {
    return fixtureResponse<T>(path, options);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort());
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.staffKey) headers[STAFF_KEY_HEADER] = options.staffKey;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new ApiError(0, localErrorBody(errorTexts.timeout, 'TIMEOUT'));
    }
    throw new ApiError(0, localErrorBody(errorTexts.network, 'NETWORK'));
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/session') {
      window.dispatchEvent(new Event(SESSION_REQUIRED_EVENT));
    }
    const body = isErrorResponse(json)
      ? json.error
      : localErrorBody(errorTexts.network, `HTTP_${response.status}`);
    throw new ApiError(response.status, body);
  }
  if (!isEnvelope<T>(json)) {
    throw new ApiError(response.status, localErrorBody(errorTexts.network, 'BAD_ENVELOPE'));
  }
  return json;
}

function isErrorResponse(value: unknown): value is { error: ErrorBody } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object'
  );
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  return typeof value === 'object' && value !== null && 'data' in value && 'meta' in value;
}

// ---------- 뼈대 경로 3개 + 설정 (뒤 단위는 자기 파일에서 함수를 "추가만" 한다) ----------

export function getConfigUi(signal?: AbortSignal) {
  return request<ConfigUi>('/config/ui', { signal });
}

export function getOpportunities(page = 1, pageSize = 20, signal?: AbortSignal) {
  const query = new URLSearchParams({ tab: 'new', page: String(page), pageSize: String(pageSize) });
  return request<OpportunityCard[]>(`/opportunities?${query.toString()}`, { signal });
}

export function getOpportunityDetail(oppId: string, signal?: AbortSignal) {
  return request<OpportunityDetail>(`/opportunities/${encodeURIComponent(oppId)}`, { signal });
}

export function postOpinion(oppId: string, body: OpinionRequest, staffKey: string) {
  return request<OpinionResponse>(`/opportunities/${encodeURIComponent(oppId)}/opinions`, {
    method: 'POST',
    body,
    staffKey,
  });
}

/** 영업 메모 저장(U5). 덧붙이기만 한다. */
export function postNote(oppId: string, body: NoteRequest, staffKey: string) {
  return request<NoteResponse>(`/opportunities/${encodeURIComponent(oppId)}/notes`, {
    method: 'POST',
    body,
    staffKey,
  });
}

/** 영업 단계·접촉 시도·다음 일정 저장(U5). 저장할 때마다 새 행이 쌓인다. */
export function postOutcome(oppId: string, body: OutcomeRequest, staffKey: string) {
  return request<OutcomeResponse>(`/opportunities/${encodeURIComponent(oppId)}/outcomes`, {
    method: 'POST',
    body,
    staffKey,
  });
}

/** 검토사항 체크·해제(U5). 해제도 새 행이 쌓인다. */
export function postReviewCheck(
  oppId: string,
  itemId: string,
  body: ReviewCheckRequest,
  staffKey: string,
) {
  return request<ReviewCheckResponse>(
    `/opportunities/${encodeURIComponent(oppId)}/review-items/${encodeURIComponent(itemId)}/check`,
    { method: 'POST', body, staffKey },
  );
}

/** 질문 답 저장(검토사항 [답 적기]). 이미 답이 있으면 최신으로 덮어쓰고 이전 답은 활동 이력에 남는다. */
export function postQuestionReply(questionId: string, body: ReplyRequest, staffKey: string) {
  return request<ReplyResponse>(`/questions/${encodeURIComponent(questionId)}/reply`, {
    method: 'POST',
    body,
    staffKey,
  });
}

/** 활동 이력(U5). 서버가 시각 순으로 준다. 한도 기본 20, 최대 100. */
export function getActivity(oppId: string, limit = 50, signal?: AbortSignal) {
  return request<ActivityItem[]>(
    `/opportunities/${encodeURIComponent(oppId)}/activity?limit=${limit}`,
    { signal },
  );
}

// ---------- 가짜 응답 전환 지점 (Step 3 fixtures) ----------

async function fixtureResponse<T>(path: string, options: RequestOptions): Promise<Envelope<T>> {
  const [route] = path.split('?');
  if (route === '/config/ui') {
    return (await import('../test/fixtures/config-ui.json')).default as unknown as Envelope<T>;
  }
  if (route === '/opportunities') {
    return (await import('../test/fixtures/opportunities-apjeong.json'))
      .default as unknown as Envelope<T>;
  }
  if (route === '/dashboard') {
    return (await import('../test/fixtures/dashboard.json')).default as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+\/opinions$/.test(route) && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const saved = (await import('../test/fixtures/opinion-saved.json'))
      .default as unknown as Envelope<Record<string, unknown>>;
    const body = (options.body ?? {}) as Partial<OpinionRequest>;
    return {
      ...saved,
      data: {
        ...saved.data,
        opinion: body.opinion ?? saved.data.opinion,
        reason: body.reason ?? null,
        memo: body.memo ?? null,
        updatedBy: options.staffKey,
      },
    } as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+\/(notes|outcomes)$/.test(route) && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const now = new Date().toISOString();
    const base = { version: 1, updatedBy: options.staffKey, updatedAt: now };
    const body = (options.body ?? {}) as Partial<OutcomeRequest>;
    const data = route.endsWith('/notes')
      ? { ...base, noteId: `note-fixture-${Date.now()}` }
      : {
          ...base,
          status: body.status,
          lostReasonCode: body.status === 'LOST' ? (body.lostReasonCode ?? null) : null,
          nextScheduleAt: body.nextScheduleAt ?? null,
        };
    return { data, meta: { updatedAt: now } } as unknown as Envelope<T>;
  }
  if (
    /^\/opportunities\/[^/]+\/review-items\/[^/]+\/check$/.test(route) &&
    options.method === 'POST'
  ) {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const now = new Date().toISOString();
    const body = (options.body ?? {}) as Partial<ReviewCheckRequest>;
    const itemId = decodeURIComponent(route.split('/')[4] ?? '');
    const checked = body.checked === true;
    return {
      data: {
        itemId,
        checked,
        checkedBy: checked ? options.staffKey : null,
        checkedAt: checked ? now : null,
      },
      meta: { updatedAt: now },
    } as unknown as Envelope<T>;
  }
  if (/^\/questions\/[^/]+\/reply$/.test(route) && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const now = new Date().toISOString();
    const body = (options.body ?? {}) as Partial<ReplyRequest>;
    return {
      data: {
        questionId: decodeURIComponent(route.split('/')[2] ?? ''),
        replyText: body.replyText ?? '',
        repliedAt: body.repliedAt ?? now.slice(0, 10),
        repliedBy: options.staffKey,
      },
      meta: { updatedAt: now },
    } as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+\/activity$/.test(route)) {
    return { data: [], meta: { updatedAt: new Date().toISOString() } } as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+$/.test(route)) {
    return (await import('../test/fixtures/opportunity-detail-apjeong.json'))
      .default as unknown as Envelope<T>;
  }
  throw new ApiError(404, localErrorBody('가짜 응답이 없는 경로입니다.', 'NO_FIXTURE'));
}
