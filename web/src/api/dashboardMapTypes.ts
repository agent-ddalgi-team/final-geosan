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
  /** "같이 들를 곳" 반경(km, #673). 설정 `visitGroupRadiusKm`, 보통 5. 옛 응답에는 없다. */
  visitRadiusKm?: number;
  /** 방문할 회사(진행 중·관심)마다 반경 안 후보 묶음. 진행 중 먼저, 그다음 관심(#673). */
  visitGroups?: DashboardVisitGroup[];
}

/** "같이 들를 곳" 근처 회사. distanceKm는 묶음 중심 회사에서의 직선거리. group이 null이면 지도 대상이 아닌 후보. */
export interface DashboardVisitNearby {
  oppId: string;
  customerName: string;
  lat: number;
  lng: number;
  distanceKm: number;
  group: DashboardMapGroup | null;
}

export interface DashboardVisitGroup {
  /** 묶음 중심 회사. points 가운데 진행 중·관심 회사의 oppId. */
  oppId: string;
  nearby: DashboardVisitNearby[];
}
