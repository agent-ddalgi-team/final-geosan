import { request } from './client';

/** 계약 C1 POST /session. 비밀번호는 요청 본문에만 두고 브라우저에 저장하지 않는다. */
export function createSession(password: string) {
  return request<unknown>('/session', { method: 'POST', body: { password } });
}
