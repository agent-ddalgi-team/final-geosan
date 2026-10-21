// 브랜드 설정 한 곳(FR6.8). 거산 로고·강조색 자료가 오면 여기만 바꾼다.
// 서버 앱 설정(brand.*)이 /config/ui로 내려오면 화면이 그 값으로 덮어쓴다(AppFrame, Step 23).
// 환경 변수 VITE_BRAND_COLOR로도 강조색을 덮어쓸 수 있다(NFR11).

export interface BrandConfig {
  logoUrl: string | null;
  brandName: string;
  /** 강조색 1개. 초기값 #1F5FBF는 팀 제안(흰 바탕 대비 약 6.1:1). */
  colorPrimary: string;
  /** 띠에 함께 보이는 문구(예: 부분 시연·거산 확인 전). 서버 설정 brand.demoLabel이 우선. */
  demoLabel: string | null;
}

const envColor = import.meta.env.VITE_BRAND_COLOR;

export const brand: BrandConfig = {
  logoUrl: null,
  brandName: '거산 영업지원',
  colorPrimary: envColor && /^#[0-9A-Fa-f]{6}$/.test(envColor) ? envColor : '#1F5FBF',
  demoLabel: null,
};
