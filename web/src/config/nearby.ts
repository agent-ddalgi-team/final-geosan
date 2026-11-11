// 영업 지역 지도의 본사 위치(대시보드 화면 설정). 지도에는 위치를 아는 회사가 모두 보이고, 본사와의 거리는 점 팝업에만 적는다.
// 본사 위치는 저장소에 적힌 값이 없어 담당자가 알려 준 시·군(충남 천안시)을 쓴다. 실제 본사 위치는 PM 확인 전이다.
// 거리는 본사 시·군과 회사 시·군의 가운데 사이 직선 거리라서 실제 도로 거리·정확한 주소 거리가 아니다.
export const HQ_REGION = '천안시';
export const HQ_LABEL = '거산케미칼 본사(천안시)';

/** 두 좌표([경도, 위도]) 사이의 직선 거리(km). */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
