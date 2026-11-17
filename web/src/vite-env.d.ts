/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1'이면 서버 없이 src/test/fixtures의 가짜 응답을 쓴다. */
  readonly VITE_USE_FIXTURES?: string;
  /** 강조색 덮어쓰기(선택). 기본값은 src/config/brand.ts. */
  readonly VITE_BRAND_COLOR?: string;
  /** 대시보드 네이버 지도 화면용 키(#671, 계약 C7 map). 비밀 아님, 콘솔의 Web 서비스 URL로 보호. 없으면 자리표시. */
  readonly VITE_NCP_MAPS_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
