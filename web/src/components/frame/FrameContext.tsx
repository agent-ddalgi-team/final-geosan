// 공통 틀이 화면(페이지)에 나눠 주는 값: 고른 담당자, 설정(/config/ui), 띠에 보일 응답 meta.
// 담당자 키는 브라우저 localStorage에 기억한다(계정 없음, FR14.1). 보기 전용(viewer)은 실수 방지용이다.
import { createContext, useContext } from 'react';
import type { ConfigUi, Meta } from '../../api/types';

export const STAFF_STORAGE_KEY = 'geosan.staffKey';
export const VIEWER_KEY = 'viewer';

export interface FrameValue {
  config: ConfigUi | null;
  /** 고른 담당자 키. 없거나 설정 목록에 없으면 null. */
  staffKey: string | null;
  setStaffKey: (key: string | null) => void;
  /** 기록 버튼을 쓸 수 있는가: 담당자를 골랐고 보기 전용이 아님. */
  canRecord: boolean;
  /** 페이지가 받은 응답 meta를 띠에 알린다(hasVirtualData·datasetKind·updatedAt·reevaluated). */
  setBannerMeta: (meta: Meta | null) => void;
}

export const FrameContext = createContext<FrameValue>({
  config: null,
  staffKey: null,
  setStaffKey: () => {},
  canRecord: false,
  setBannerMeta: () => {},
});

export function useFrame(): FrameValue {
  return useContext(FrameContext);
}

export function readStoredStaffKey(): string | null {
  try {
    return window.localStorage.getItem(STAFF_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeStaffKey(key: string | null): void {
  try {
    if (key) window.localStorage.setItem(STAFF_STORAGE_KEY, key);
    else window.localStorage.removeItem(STAFF_STORAGE_KEY);
  } catch {
    // 저장소를 못 써도 이번 화면에서는 고른 값이 유지된다.
  }
}
