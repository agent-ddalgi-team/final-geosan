import type { CSSProperties, ReactNode } from 'react';
import { brand } from '../../config/brand';
import { loginTexts } from '../../labels/ko';
import { loginTheme } from '../../theme/tokens';
import './LoginLayout.css';

/** 색·크기 값은 tokens.ts에서 가져와 CSS 변수로 넘긴다. */
const pageVars = {
  '--login-sky-top': loginTheme.skyTop,
  '--login-sky-middle': loginTheme.skyMiddle,
  '--login-sky-low': loginTheme.skyLow,
  '--login-sky-glow': loginTheme.skyGlow,
  '--login-spot': loginTheme.spot,
  '--login-planet': loginTheme.planet,
  '--login-rim': loginTheme.rim,
  '--login-glow-core': loginTheme.glowCore,
  '--login-text': loginTheme.text,
  '--login-text-soft': loginTheme.textSoft,
  '--login-badge-border': loginTheme.badgeBorder,
  '--login-badge-radius': `${loginTheme.badgeRadius}px`,
  '--login-card-tint': loginTheme.cardTint,
  '--login-card-sheen': loginTheme.cardSheen,
  '--login-card-border': loginTheme.cardBorder,
  '--login-card-shadow': loginTheme.cardShadow,
  '--login-icon': loginTheme.icon,
  '--login-button-ring': loginTheme.buttonRing,
  '--login-focus-ring': loginTheme.focusRing,
  '--login-card-width': `${loginTheme.cardWidth}px`,
  '--login-card-radius': `${loginTheme.cardRadius}px`,
  '--login-input-height': `${loginTheme.inputHeight}px`,
  '--login-input-radius': `${loginTheme.inputRadius}px`,
  '--login-title-size': `${loginTheme.titleSize}px`,
  '--login-subtitle-size': `${loginTheme.subtitleSize}px`,
} as CSSProperties;

/**
 * 접속 화면의 틀(#978): 짙은 보라 밤하늘과 아래쪽 빛나는 곡선, 왼쪽 위 로고 + 회사 이름, 오른쪽 위 "내부용",
 * 가운데 제목 · 한 줄 소개, 그 아래 유리 느낌 상자(입력 칸), 맨 아래 저작권 줄. 접속 확인은 SessionGate가 맡는다.
 */
export default function LoginLayout({
  children,
  showBadge,
}: {
  children: ReactNode;
  /** 접속 확인 중에는 숨긴다: 곧바로 열리는 업무 화면의 "내부용" 띠와 헷갈리지 않게 한다. */
  showBadge: boolean;
}) {
  return (
    <div className="login-page" style={pageVars}>
      {/* 아래쪽 빛나는 곡선은 꾸밈이다. */}
      <div className="login-planet" aria-hidden="true" />
      <header className="login-header">
        <span className="login-brand">
          {/* 옆에 회사 이름 글자가 있으므로 그림은 꾸밈이다. */}
          <img className="login-logo" src={brand.loginLogoUrl} alt="" />
          <span>{loginTexts.companyName}</span>
        </span>
        {showBadge ? <span className="login-badge">{loginTexts.internalBadge}</span> : null}
      </header>
      <main className="login-main">
        <h1 className="login-title">{loginTexts.title}</h1>
        <p className="login-subtitle">{loginTexts.subtitle}</p>
        <div className="login-card login-body" data-testid="login-card">
          {children}
        </div>
      </main>
      <footer className="login-footer">{loginTexts.footer}</footer>
    </div>
  );
}
