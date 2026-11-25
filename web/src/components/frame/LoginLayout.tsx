import type { CSSProperties, ReactNode } from 'react';
import { Typography } from 'antd';
import { brand } from '../../config/brand';
import { loginTexts } from '../../labels/ko';
import { colors, loginTheme, typography } from '../../theme/tokens';
import './LoginLayout.css';

/** 색·크기 값은 tokens.ts에서 가져와 CSS 변수로 넘긴다. */
const pageVars = {
  '--login-form-width': `${loginTheme.formMaxWidth}px`,
  '--login-control-height': `${loginTheme.controlHeight}px`,
  '--login-input-radius': `${loginTheme.inputRadius}px`,
  '--login-focus-ring': loginTheme.focusRing,
  '--login-accent': loginTheme.accent,
  '--login-photo-text': loginTheme.photoText,
  '--login-photo-bar': loginTheme.photoBar,
  '--login-photo-shade': loginTheme.photoShade,
  background: colors.bgContainer,
} as CSSProperties;

/** 접속 화면의 틀(#912): 왼쪽에 로고와 입력 자리, 오른쪽에 건물 사진과 인사말. 접속 확인은 SessionGate가 맡는다. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <main className="login-page" style={pageVars}>
      <section className="login-panel">
        <img className="login-logo" src={brand.loginLogoUrl} alt={loginTexts.logoAlt} />
        <div className="login-body">
          <Typography.Title
            level={1}
            style={{ fontSize: typography.fontSizeH1, textAlign: 'center' }}
          >
            {loginTexts.title}
          </Typography.Title>
          {children}
        </div>
      </section>
      <aside
        className="login-photo"
        style={{ '--login-photo': `url("${brand.loginPhotoUrl}")` } as CSSProperties}
      >
        <span className="login-photo-bar" aria-hidden="true" />
        <p className="login-greeting" style={{ fontSize: loginTheme.titleSize }}>
          {loginTexts.greetingHello}
          <br />
          {loginTexts.greetingAgent}
        </p>
        <p className="login-greeting-sub" style={{ fontSize: loginTheme.subtitleSize }}>
          {loginTexts.greetingSub}
        </p>
      </aside>
    </main>
  );
}
