// 경계 파일: 고치려면 PM에게 먼저 말한다(계약 C1, 3장).
// 서버 요청 클라이언트(fetch). 응답 형식 Envelope/Error, 요청 중단 한도 10초, 담당자 키 헤더 X-Staff-Key.
// VITE_USE_FIXTURES=1 이면 서버 없이 src/test/fixtures의 가짜 응답을 돌려준다(Part E 초기 개발용).
// 화면 부품은 이 모듈의 함수만 쓰고 fetch를 직접 부르지 않는다.
import type {
  ActivityItem,
  BookmarkRecord,
  BookmarkRequest,
  BookmarkResponse,
  ConfigUi,
  Envelope,
  ErrorBody,
  IngestRequest,
  IngestResponse,
  NoteRequest,
  NoteResponse,
  OpinionRequest,
  OpinionResponse,
  OpportunityCard,
  OpportunityDetail,
  OutcomeRequest,
  OutcomeResponse,
  HomepageRequest,
  HomepageResponse,
  MainPhoneConfirmRequest,
  MainPhoneConfirmResponse,
  RelationRequest,
  RelationResponse,
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
  /** 요청 중단 한도(밀리초). 안 주면 10초. 홈페이지 조사처럼 서버가 60초까지 걸리는 요청만 늘린다. */
  timeoutMs?: number;
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
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
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

/** 목록 조건(#210). 비어 있는 값은 보내지 않는다. 서버는 이 조건들을 모두 AND로 건다. */
export interface ListFilters {
  /** 공정 코드(예: ANODIZING). 주면 그 공정 연결 기회만, 순위는 그 안 번호. */
  process?: string | null;
  /** 시·군 또는 묶음 이름(예: 천안 인근, 아산시). */
  region?: string | null;
  /** 설정에 있는 산업군 이름. */
  industry?: string | null;
  /** 영업 단계(예: IN_PROGRESS). 주소 `?stage=`로 넘어올 때 쓴다. */
  stage?: string | null;
  /** 대시보드 칸을 누르고 넘어올 때 그 칸의 이름표(예: NOT_CONTACTED, SCHEDULE_DUE). 서버가 대시보드와 같은 규칙으로 거른다. */
  filter?: string | null;
  /** `true`면 관심으로 켜 둔 회사만("관심 기업" 목록, #356). 안 주면 거르지 않는다. */
  bookmarked?: string | null;
  /** 최신 검토 의견으로 거르기(#356): WORTH_REVIEW·NEED_CHECK·NOT_TARGET, NONE은 의견이 없는 회사("기타"). */
  opinion?: string | null;
  /** 회사·기회·산업군 검색어. */
  q?: string | null;
  /** 후보 가져오기 회차(#316). `latest`면 마지막 수집 회차에 들어온 회사만("이번 수집만"). 안 주면 전체. */
  batch?: string | null;
}

export function getOpportunities(
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
  filters: ListFilters = {},
) {
  const query = new URLSearchParams({ tab: 'new', page: String(page), pageSize: String(pageSize) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
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

/**
 * 관심 켜고 끄기(#356, 계약 C1 `PUT /bookmark`). 관심은 영업 단계가 아니라 팀이 함께 쓰는 표시다.
 * 기록(메모·영업 기록·검토 의견)이 있는 회사를 끄려 하면 422 BOOKMARK_HAS_RECORDS, 보기 전용은 403이다.
 */
export function putBookmark(oppId: string, body: BookmarkRequest, staffKey: string) {
  return request<BookmarkResponse>(`/opportunities/${encodeURIComponent(oppId)}/bookmark`, {
    method: 'PUT',
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

/** 대표번호 [맞음](#209). 번호는 못 고치고 확인한 시각·담당자만 남긴다. */
export function postMainPhoneConfirm(
  oppId: string,
  body: MainPhoneConfirmRequest,
  staffKey: string,
) {
  return request<MainPhoneConfirmResponse>(
    `/opportunities/${encodeURIComponent(oppId)}/main-phone/confirm`,
    { method: 'POST', body, staffKey },
  );
}

/** 홈페이지 조사 한도. 서버가 전체 60초 안에 끝내므로 화면은 그보다 조금 더 기다린다(계약 C1 `POST /homepage`). */
export const HOMEPAGE_TIMEOUT_MS = 65_000;

/**
 * 홈페이지 [맞음]·[고치기]·[다시 조사]·본문 붙여넣기(#210·#304, 계약 C1 `POST /homepage`).
 * `confirmOnly`면 외부 호출 없이 확인 상태만 저장하고, 아니면 근거 추출·재평가까지 한다.
 * 실패는 409 STALE_VALUE, 422 ROBOTS_DISALLOW·TERMS_DISALLOW·UNREACHABLE, 503 kind 6종이다.
 */
export function postHomepage(oppId: string, body: HomepageRequest, staffKey: string) {
  return request<HomepageResponse>(`/opportunities/${encodeURIComponent(oppId)}/homepage`, {
    method: 'POST',
    body,
    staffKey,
    timeoutMs: HOMEPAGE_TIMEOUT_MS,
  });
}

/** 거래 관계 저장(#265). 저장하면 서버가 이력을 남기고 이 회사를 다시 평가한다. */
export function postRelation(oppId: string, body: RelationRequest, staffKey: string) {
  return request<RelationResponse>(`/opportunities/${encodeURIComponent(oppId)}/relation`, {
    method: 'POST',
    body,
    staffKey,
  });
}

/**
 * 새 후보 가져오기(#316, 계약 C1 `POST /ingest`). 회차를 만든 직후 바로 응답하고 찾기는 서버 뒤에서 이어진다.
 * 이미 가져오는 중이면 409 INGEST_RUNNING, 소스 읽기 실패는 503, 설정 밖 값은 400, 보기 전용은 403이다.
 */
export function postIngest(body: IngestRequest, staffKey: string) {
  return request<IngestResponse>('/ingest', { method: 'POST', body, staffKey });
}

/** 활동 이력(U5). 서버가 시각 순으로 준다. 한도 기본 20, 최대 100. */
export function getActivity(oppId: string, limit = 50, signal?: AbortSignal) {
  return request<ActivityItem[]>(
    `/opportunities/${encodeURIComponent(oppId)}/activity?limit=${limit}`,
    { signal },
  );
}

// ---------- 가짜 응답 전환 지점 (Step 3 fixtures) ----------

// 가짜 모드의 관심 표시(#357). 서버가 없으니 이 화면이 떠 있는 동안만 기억하고, 새로 고침하면 처음으로 돌아간다.
const fixtureBookmarks = new Map<string, BookmarkRecord>();
/** 가짜 모드에서 메모·영업 기록·검토 의견을 저장한 회사. 실제 서버처럼 관심 끄기를 거부하는 데 쓴다. */
const fixtureRecorded = new Set<string>();

function fixtureOppId(route: string): string {
  return decodeURIComponent(route.split('/')[2] ?? '');
}

/** 관심 값을 바꾼다. 이미 같은 값이면 새로 쌓지 않고 지금 값을 돌려준다(계약 C1 `/bookmark`). */
function fixtureSetBookmark(oppId: string, active: boolean, staffKey: string): BookmarkRecord {
  const current = fixtureBookmarks.get(oppId);
  if (current && current.active === active) return current;
  const next: BookmarkRecord = {
    version: (current?.version ?? 0) + 1,
    updatedBy: staffKey,
    updatedAt: new Date().toISOString(),
    active,
  };
  fixtureBookmarks.set(oppId, next);
  return next;
}

/** 자동 관심: 기록을 저장하면 서버가 같은 저장 안에서 관심을 켠다. 가짜 모드도 같은 순서로 흉내 낸다. */
function fixtureAutoBookmark(route: string, staffKey: string): void {
  const oppId = fixtureOppId(route);
  fixtureRecorded.add(oppId);
  fixtureSetBookmark(oppId, true, staffKey);
}

async function fixtureResponse<T>(path: string, options: RequestOptions): Promise<Envelope<T>> {
  const [route, search = ''] = path.split('?');
  if (route === '/config/ui') {
    return (await import('../test/fixtures/config-ui.json')).default as unknown as Envelope<T>;
  }
  if (route === '/opportunities') {
    const envelope = (await import('../test/fixtures/opportunities-apjeong.json'))
      .default as unknown as Envelope<OpportunityCard[]>;
    // 이 화면에서 켜고 끈 관심을 카드에 얹고, `bookmarked=true`면 관심 기업만 돌려준다.
    const cards = envelope.data.map((card) => ({
      ...card,
      records: {
        ...card.records,
        bookmark: fixtureBookmarks.get(card.oppId) ?? card.records.bookmark ?? null,
      },
    }));
    const query = new URLSearchParams(search);
    const bookmarkedOnly = query.get('bookmarked') === 'true';
    // 목록 머리(#361) 흉내: 가짜 카드에는 공정 칸이 없어서, 곳 수가 0인 공정을 고르면 빈 목록을 돌려주는 것으로 대신한다.
    // 검색어(`q`)는 카드 제목에 그 글자가 든 회사만 남긴다. 지역·산업 같은 다른 조건은 거르지 않는다.
    const process = query.get('process');
    const emptyProcess = (envelope.meta.processCounts ?? []).some(
      (item) => item.processCode === process && item.count === 0,
    );
    const q = query.get('q');
    const data = cards.filter(
      (card) =>
        !emptyProcess &&
        (!bookmarkedOnly || card.records.bookmark?.active === true) &&
        (!q || card.title.includes(q)),
    );
    return { data, meta: { ...envelope.meta, total: data.length } } as unknown as Envelope<T>;
  }
  if (route === '/dashboard') {
    return (await import('../test/fixtures/dashboard.json')).default as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+\/opinions$/.test(route) && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    fixtureAutoBookmark(route, options.staffKey);
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
    fixtureAutoBookmark(route, options.staffKey);
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
  if (/^\/opportunities\/[^/]+\/bookmark$/.test(route) && options.method === 'PUT') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const oppId = fixtureOppId(route);
    const active = ((options.body ?? {}) as Partial<BookmarkRequest>).active === true;
    if (!active && fixtureRecorded.has(oppId)) {
      const err = (await import('../test/fixtures/error-422-bookmark.json')).default;
      throw new ApiError(422, err.error as ErrorBody);
    }
    const saved = fixtureSetBookmark(oppId, active, options.staffKey);
    return { data: saved, meta: { updatedAt: saved.updatedAt } } as unknown as Envelope<T>;
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
  if (/^\/opportunities\/[^/]+\/main-phone\/confirm$/.test(route) && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const now = new Date().toISOString();
    const body = (options.body ?? {}) as Partial<MainPhoneConfirmRequest>;
    return {
      data: {
        mainPhone: body.expectedPhone ?? '',
        mainPhoneConfirmedAt: now,
        mainPhoneConfirmedBy: options.staffKey,
      },
      meta: { updatedAt: now },
    } as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+\/homepage$/.test(route) && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const now = new Date().toISOString();
    const body = (options.body ?? {}) as Partial<HomepageRequest>;
    const data = body.confirmOnly
      ? {
          homepageUrl: body.url ?? 'https://example.test',
          homepageStatus: 'CONFIRMED',
          homepageSource: 'STAFF',
        }
      : { evidenceCount: 3, requirementCandidateCount: 1, questionCount: 1, evalId: `eval-${now}` };
    return { data, meta: { updatedAt: now } } as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+\/relation$/.test(route) && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    const now = new Date().toISOString();
    const body = (options.body ?? {}) as Partial<RelationRequest>;
    return {
      data: {
        relationStatus: body.relationStatus,
        relationConfirmedAt: now.slice(0, 10),
        relationConfirmedBy: options.staffKey,
        evalId: `${body.evalId ?? 'eval'}-reevaluated`,
      },
      meta: { updatedAt: now, reevaluated: true },
    } as unknown as Envelope<T>;
  }
  if (route === '/ingest' && options.method === 'POST') {
    if (!options.staffKey || options.staffKey === 'viewer') {
      const err = (await import('../test/fixtures/error-403.json')).default;
      throw new ApiError(403, err.error as ErrorBody);
    }
    // 가짜 모드: 회차를 만든 것처럼 바로 응답한다. 진행·결과는 목록 가짜 응답에 들어 있지 않다.
    return {
      data: {
        batchId: `batch-fixture-${Date.now()}`,
        newCount: 0,
        mergeCandidateCount: 0,
        skippedCount: 0,
      },
      meta: { updatedAt: new Date().toISOString() },
    } as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+\/activity$/.test(route)) {
    return { data: [], meta: { updatedAt: new Date().toISOString() } } as unknown as Envelope<T>;
  }
  if (/^\/opportunities\/[^/]+$/.test(route)) {
    const envelope = (await import('../test/fixtures/opportunity-detail-apjeong.json'))
      .default as unknown as Envelope<OpportunityDetail>;
    const bookmark = fixtureBookmarks.get(fixtureOppId(route));
    if (!bookmark) return envelope as unknown as Envelope<T>;
    return {
      ...envelope,
      data: { ...envelope.data, records: { ...envelope.data.records, bookmark } },
    } as unknown as Envelope<T>;
  }
  throw new ApiError(404, localErrorBody('가짜 응답이 없는 경로입니다.', 'NO_FIXTURE'));
}
