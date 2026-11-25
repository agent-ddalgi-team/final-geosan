import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import './TempLoginGate.css';

// 임시 로그인 화면(시연용). 실제 인증이 아니다: 아래 시연용 값과 같으면 통과한다(화면 코드에 있어 비밀이 아니다).
// 통과 표시는 이 브라우저에만 남긴다(서버·DB와 무관). 실제 계정 로그인은 뒤에 오는 SessionGate가 따로 맡는다.
const DEMO_EMAIL = 'demo@geosan.example';
const DEMO_PASSWORD = 'geosan1234';
const PASS_KEY = 'ddalgi-temp-login';
const EMAIL_KEY = 'ddalgi-temp-login-id';

const TEXTS = {
  ko: {
    title: '계정에 로그인',
    subtitle: '로그인 정보를 입력해 주세요.',
    email: '이메일 주소',
    password: '비밀번호',
    show: '비밀번호 보기',
    hide: '비밀번호 숨기기',
    keep: '로그인 상태 유지',
    login: '로그인',
    logout: '임시 로그아웃',
    empty: '이메일과 비밀번호를 입력해 주세요.',
    wrong: '이메일 또는 비밀번호가 맞지 않습니다.',
    notice: '임시 화면(예시)',
    slides: [
      {
        quote:
          '거래처 후보, 관심 기업, 접촉 기록을 한곳에서 관리합니다. 오늘 연락할 곳을 놓치지 않고 정리할 수 있습니다.',
        name: '영업 담당 (예시 문구)',
        role: '거산케미칼',
      },
      {
        quote:
          '추천 근거와 검토사항을 함께 보여 줘서, 어떤 회사를 먼저 확인해야 하는지 바로 알 수 있습니다.',
        name: '검수 담당 (예시 문구)',
        role: '거산케미칼',
      },
    ],
  },
  en: {
    title: 'Login to your account',
    subtitle: 'Enter your details to login.',
    email: 'Email Address',
    password: 'Password',
    show: 'Show password',
    hide: 'Hide password',
    keep: 'Keep me logged in',
    login: 'Login',
    logout: 'Log out (temp)',
    empty: 'Please enter your email and password.',
    wrong: 'The email or password is incorrect.',
    notice: 'Temporary sample screen',
    slides: [
      {
        quote:
          'Manage prospects, saved companies and contact records in one place, and keep track of who to contact today.',
        name: 'Sales staff (sample text)',
        role: '거산케미칼',
      },
      {
        quote:
          'Reasons and review points are shown together, so you know which company to check first.',
        name: 'Review staff (sample text)',
        role: '거산케미칼',
      },
    ],
  },
};
type Lang = keyof typeof TEXTS;

function readStore(store: 'session' | 'local', key: string): string | null {
  try {
    return (store === 'session' ? window.sessionStorage : window.localStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStore(store: 'session' | 'local', key: string, value: string | null) {
  try {
    const target = store === 'session' ? window.sessionStorage : window.localStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    // 저장이 막힌 브라우저에서는 새로고침하면 다시 로그인 화면이 나올 뿐이다.
  }
}

export default function TempLoginGate({ children }: { children: ReactNode }) {
  const [passed, setPassed] = useState(
    () => readStore('session', PASS_KEY) === '1' || readStore('local', PASS_KEY) === '1',
  );
  const [lang, setLang] = useState<Lang>('ko');
  const [email, setEmail] = useState(() => readStore('local', EMAIL_KEY) ?? '');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [keep, setKeep] = useState(() => readStore('local', EMAIL_KEY) !== null);
  const [error, setError] = useState<'empty' | 'wrong' | null>(null);
  const [slide, setSlide] = useState(0);
  const t = TEXTS[lang];

  const logout = () => {
    writeStore('session', PASS_KEY, null);
    writeStore('local', PASS_KEY, null);
    setPassword('');
    setVisible(false);
    setPassed(false);
  };

  if (passed) {
    return (
      <>
        {children}
        <button type="button" className="tl-logout" onClick={logout}>
          {t.logout}
        </button>
      </>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('empty');
      return;
    }
    if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
      setError('wrong');
      return;
    }
    setError(null);
    writeStore('session', PASS_KEY, '1');
    writeStore('local', PASS_KEY, keep ? '1' : null);
    writeStore('local', EMAIL_KEY, keep ? email.trim() : null);
    setPassed(true);
  };

  return (
    <main className="tl-page" data-testid="temp-login">
      <section className="tl-left">
        <header className="tl-brand">
          <span className="tl-logo" aria-hidden="true" />
          <span>거산케미칼</span>
        </header>

        <form className="tl-form" onSubmit={submit} noValidate>
          <h1 className="tl-title">{t.title}</h1>
          <p className="tl-subtitle">{t.subtitle}</p>

          <label className="tl-label" htmlFor="tl-email">
            {t.email}
            <span aria-hidden="true">*</span>
          </label>
          <div className="tl-field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M4 7l8 6 8-6" />
            </svg>
            <input
              id="tl-email"
              type="email"
              autoComplete="username"
              placeholder={DEMO_EMAIL}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <label className="tl-label" htmlFor="tl-password">
            {t.password}
            <span aria-hidden="true">*</span>
          </label>
          <div className="tl-field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <input
              id="tl-password"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="tl-eye"
              aria-label={visible ? t.hide : t.show}
              aria-pressed={visible}
              onClick={() => setVisible((v) => !v)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
                {visible ? <path d="M4 20L20 4" /> : null}
              </svg>
            </button>
          </div>

          <label className="tl-keep">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>{t.keep}</span>
          </label>

          {error ? (
            <p className="tl-error" role="alert">
              {t[error]}
            </p>
          ) : null}

          <button type="submit" className="tl-submit">
            {t.login}
          </button>
        </form>

        <footer className="tl-footer">
          <span>© 2026 거산케미칼 · {t.notice}</span>
          <label className="tl-lang">
            <span aria-hidden="true">🌐</span>
            <select
              aria-label="언어 / Language"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              <option value="ko">KOR</option>
              <option value="en">ENG</option>
            </select>
          </label>
        </footer>
      </section>

      <aside className="tl-right">
        <div className="tl-quote">
          <span className="tl-avatar" aria-hidden="true">
            {slide === 0 ? '영' : '검'}
          </span>
          <p>{t.slides[slide].quote}</p>
          <strong>{t.slides[slide].name}</strong>
          <small>{t.slides[slide].role}</small>
          <div className="tl-dots">
            {t.slides.map((item, index) => (
              <button
                type="button"
                key={item.name}
                aria-label={`${index + 1} / ${t.slides.length}`}
                aria-current={index === slide}
                className={index === slide ? 'is-on' : undefined}
                onClick={() => setSlide(index)}
              />
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
