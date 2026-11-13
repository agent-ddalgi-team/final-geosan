// 대시보드 지도 응답 타입 — 계약 C1 `GET /dashboard/map` 모양 그대로(필드 이름 camelCase). 이슈 #226·#641.
// 응답에는 메모·연락처·대표번호가 없다. 새 필드는 약속 파일에 먼저 적고 PM 확인을 받는다.

/** 점 묶음: 관심 기업 / 영업 진행 중 / 올해 성공. */
export type DashboardMapGroup = 'INTERESTED' | 'IN_PROGRESS' | 'WON_THIS_YEAR';

export interface DashboardMapPoint {
  oppId: string;
  customerName: string;
  lat: number;
  lng: number;
  group: DashboardMapGroup;
  /** 거산 본사에서의 직선거리(km). */
  distanceKm: number;
}

export interface DashboardMap {
  /** 거산 본사 좌표(설정 `geosan`). */
  center: { lat: number; lng: number };
  /** 원 반지름(km). 설정 `distanceFilterPresetsKm`, 보통 [30, 50, 100]. */
  ringsKm: number[];
  points: DashboardMapPoint[];
  /** 좌표를 아직 못 구한 대상 회사 수. */
  missingCoordinates: number;
  asOf: string;
}
