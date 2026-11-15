import { request } from './client';
import type { CurrentStaff } from './types';

/** 접속 화면이 계정 방식임을 아는 표시(#754). 서버 401의 kind. */
export const STAFF_LOGIN_KIND = 'STAFF_LOGIN_REQUIRED';

/**
 * 계약 C1 POST /session. 비밀번호는 요청 본문에만 두고 브라우저에 저장하지 않는다.
 * 계정 방식(#754)이면 아이디(staffKey)를 함께 보낸다.
 */
export function createSession(password: string, staffKey?: string) {
  const body = staffKey ? { password, staffKey } : { password };
  return request<unknown>('/session', { method: 'POST', body });
}

export interface ProfileBody {
  displayName: string;
  currentPassword: string;
  newPassword: string;
}

/** 계약 C1 POST /session/profile(#754): 첫 로그인 때 화면에 보일 이름과 새 비밀번호를 정한다. */
export function saveProfile(body: ProfileBody) {
  return request<CurrentStaff>('/session/profile', { method: 'POST', body });
}

/** 계약 C1 POST /session/logout(#754): 지금 세션을 끝낸다. */
export function logout() {
  return request<unknown>('/session/logout', { method: 'POST' });
}
