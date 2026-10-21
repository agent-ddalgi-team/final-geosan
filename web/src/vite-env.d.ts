/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1'이면 서버 없이 src/test/fixtures의 가짜 응답을 쓴다. */
  readonly VITE_USE_FIXTURES?: string;
  /** 강조색 덮어쓰기(선택). 기본값은 src/config/brand.ts. */
  readonly VITE_BRAND_COLOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
