import type { CSSProperties, ReactNode } from 'react';
import { Typography } from 'antd';
import { brand } from '../../config/brand';
import { loginTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import './LoginLayout.css';

/** 접속 화면의 틀(#912): 왼쪽에 로고와 입력 자리, 오른쪽에 인사말. 접속 확인은 SessionGate가 맡는다. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <main className="login-page" style={{ background: colors.bgLayout }}>
      <section
        className="login-panel"
        style={{ background: colors.bgContainer, borderColor: colors.borderSecondary }}
      >
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
        className="login-aside"
        style={{ '--login-ring': colors.bgContainer } as CSSProperties}
      >
        <p style={{ fontSize: typography.fontSizeCardTitle }}>{loginTexts.greeting}</p>
      </aside>
    </main>
  );
}
