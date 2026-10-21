// 경계 파일: 고치려면 PM에게 먼저 말한다(계약 C1, 3장).
// 서버 요청 클라이언트(fetch). 응답 형식 Envelope/Error, 요청 중단 한도 10초, 담당자 키 헤더 X-Staff-Key.
// VITE_USE_FIXTURES=1 이면 서버 없이 src/test/fixtures의 가짜 응답을 돌려준다(Part E 초기 개발용).
// 화면 부품은 이 모듈의 함수만 쓰고 fetch를 직접 부르지 않는다.
import type {
  ConfigUi,
  Envelope,
  ErrorBody,
  OpinionRequest,
  OpinionResponse,
  OpportunityCard,
  OpportunityDetail,
} from './types';
import { errorTexts } from '../labels/ko';

export const API_BASE = '/api/v1';
/** 요청 중단 한도(목록·상세·기록 10초, 계약 3장). */
export const REQUEST_TIMEOUT_MS = 10_000;
export const STAFF_KEY_HEADER = 'X-Staff-Key';

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
  if (/^\/opportunities\/[^/]+$/.test(route)) {
    return (await import('../test/fixtures/opportunity-detail-apjeong.json'))
      .default as unknown as Envelope<T>;
  }
  throw new ApiError(404, localErrorBody('가짜 응답이 없는 경로입니다.', 'NO_FIXTURE'));
}
