// 추천 목록 엑셀 내려받기(#217, 계약 C1 `GET /export/xlsx`). client.ts(경계 파일)는 고치지 않고 상수·오류 틀만 가져다 쓴다.
// 응답이 JSON이 아니라 엑셀 파일이라 `request`를 쓰지 못해 여기서 fetch를 한 번 부른다. 화면 부품은 이 함수만 쓴다.
// 서버는 목록 조회와 같은 조건을 받아 쪽 나눔 없이 전부 담는다. 메모·대표번호는 파일에 없다(계약 C4 OUTPUT_EXPORT).
// 거부(422 EXPORT_REJECTED)·접속 확인(401)·그 밖의 오류는 다른 요청과 같은 ApiError로 던진다.
import {
  API_BASE,
  ApiError,
  REQUEST_TIMEOUT_MS,
  SESSION_REQUIRED_EVENT,
  isFixtureMode,
} from './client';
import type { ListFilters } from './client';
import type { ErrorBody } from './types';
import { errorTexts, listExport } from '../labels/ko';

export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface XlsxFile {
  blob: Blob;
  /** 서버가 정한 파일 이름(예: 거산_추천목록_20261113.xlsx). 못 읽으면 화면 기본 이름. */
  fileName: string;
}

function localError(message: string, kind: string): ErrorBody {
  return { message, nextAction: errorTexts.nextActionDefault, ref: 'local', kind };
}

/** 응답 머리 `Content-Disposition`에서 파일 이름을 읽는다. 한글 이름(`filename*=UTF-8''…`)을 먼저 본다. */
export function fileNameFrom(disposition: string | null): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '');
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // 깨진 이름이면 아래 기본 이름을 쓴다.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition ?? '');
  return plain ? plain[1] : listExport.defaultFileName;
}

/** 지금 걸러 본 조건 그대로 엑셀을 받는다. 비어 있는 조건은 보내지 않는다(목록 조회와 같은 규칙). */
export async function getListXlsx(filters: ListFilters = {}): Promise<XlsxFile> {
  if (isFixtureMode()) {
    throw new ApiError(404, localError(listExport.noFixture, 'NO_FIXTURE'));
  }
  const query = new URLSearchParams({ tab: 'new' });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/export/xlsx?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: `${XLSX_MEDIA_TYPE}, application/json` },
      signal: controller.signal,
      credentials: 'same-origin',
    });
  } catch {
    if (controller.signal.aborted) throw new ApiError(0, localError(errorTexts.timeout, 'TIMEOUT'));
    throw new ApiError(0, localError(errorTexts.network, 'NETWORK'));
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_REQUIRED_EVENT));
    let body: ErrorBody | null = null;
    try {
      const json: unknown = await response.json();
      if (typeof json === 'object' && json !== null && 'error' in json) {
        const error = (json as { error: unknown }).error;
        if (typeof error === 'object' && error !== null) body = error as ErrorBody;
      }
    } catch {
      body = null;
    }
    throw new ApiError(
      response.status,
      body ?? localError(errorTexts.network, `HTTP_${response.status}`),
    );
  }
  // 엑셀이 아닌 응답(예: 화면 HTML)을 파일로 저장하지 않는다.
  if (!(response.headers.get('Content-Type') ?? '').startsWith(XLSX_MEDIA_TYPE)) {
    throw new ApiError(response.status, localError(errorTexts.network, 'BAD_FILE'));
  }
  return {
    blob: await response.blob(),
    fileName: fileNameFrom(response.headers.get('Content-Disposition')),
  };
}

/** 받은 파일을 브라우저의 내려받기로 넘긴다(보이지 않는 링크를 한 번 누른다). */
export function saveFile(file: XlsxFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
