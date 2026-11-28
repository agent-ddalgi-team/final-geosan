// 브랜드 설정 한 곳(FR6.8). 거산 로고·강조색 자료가 오면 여기만 바꾼다.
// 서버 앱 설정(brand.*)이 /config/ui로 내려오면 화면이 그 값으로 덮어쓴다(AppFrame, Step 23).
// 환경 변수 VITE_BRAND_COLOR로도 강조색을 덮어쓸 수 있다(NFR11).
// 로고(#898, PM 2026-11-23): 거산케미칼 로고의 그림·영문 부분만(아래 한글 회사명은 뺌). 화면 묶음에 함께 실려
// 배포 사이트·PC 서버 어디서나 보인다. 서버 설정 brand.logoUrl이 비어 있으면(null) 이 로고를 쓴다.
import geosanLogo from '../assets/brand/geosan-logo.png';
// 접속 화면용: 흰 배경만 지우고 색은 진하게 둔 투명 로고(#972부터 접속 화면도 밝은 바탕이지만 선이 더 또렷해 그대로 쓴다).
import geosanLogoClear from '../assets/brand/geosan-logo-clear.png';

export interface BrandConfig {
  logoUrl: string | null;
  loginLogoUrl: string;
  brandName: string;
  /** 강조색 1개(주 단추·선택 표시). #972부터 보라 #6A4DF0(흰 글자 대비 약 5.3:1). 링크는 강조 글자색 + 밑줄(tokens accent.text). */
  colorPrimary: string;
  /** 띠에 함께 보이는 문구(예: 부분 시연·거산 확인 전). 서버 설정 brand.demoLabel이 우선. */
  demoLabel: string | null;
}

const envColor = import.meta.env.VITE_BRAND_COLOR;

export const brand: BrandConfig = {
  logoUrl: geosanLogo,
  loginLogoUrl: geosanLogoClear,
  brandName: '거산 영업지원',
  colorPrimary: envColor && /^#[0-9A-Fa-f]{6}$/.test(envColor) ? envColor : '#6A4DF0',
  demoLabel: null,
};
