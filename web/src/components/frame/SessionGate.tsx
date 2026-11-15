import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Alert, Button, ConfigProvider, Input, Typography } from 'antd';
import { ApiError, getConfigUi, SESSION_REQUIRED_EVENT } from '../../api/client';
import { createSession, saveProfile, STAFF_LOGIN_KIND } from '../../api/session';
import { antdTheme, colors, spacing } from '../../theme/tokens';

type GateState = 'checking' | 'login' | 'setup' | 'ready' | 'error';

/**
 * 서버가 확인한 세션만 통과시킨다. 실제 접근 차단과 실패 횟수 제한은 서버 책임이다.
 * 계정 방식(#754)이면 아이디 칸을 보이고, 첫 로그인이면 화면에 보일 이름·새 비밀번호를 먼저 정한다.
 */
export default function SessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking');
  const [accounts, setAccounts] = useState(false);
  const [staffKey, setStaffKey] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const checkSession = useCallback((signal?: AbortSignal) => {
    return getConfigUi(signal)
      .then((envelope) => {
        if (signal?.aborted) return;
        const current = envelope.data.currentStaff;
        if (current) setAccounts(true);
        setState(current?.setupRequired ? 'setup' : 'ready');
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          if (error.body.kind === STAFF_LOGIN_KIND) setAccounts(true);
          setState('login');
        } else {
          setState('error');
        }
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    const expired = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: string | null }>).detail?.kind;
      if (kind === STAFF_LOGIN_KIND) setAccounts(true);
      setPassword('');
      setState('login');
    };
    window.addEventListener(SESSION_REQUIRED_EVENT, expired);
    return () => {
      controller.abort();
      window.removeEventListener(SESSION_REQUIRED_EVENT, expired);
    };
  }, [checkSession]);

  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000)));
    if (!waitUntil) return;
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [waitUntil]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || Date.now() < waitUntil) return;
    setBusy(true);
    setMessage('');
    const entered = password;
    setPassword('');
    try {
      if (accounts) await createSession(entered, staffKey.trim());
      else await createSession(entered);
      setState('checking');
      await checkSession();
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.body.message);
        const delay = error.body.retryAfterSeconds;
        if (
          error.status === 429 &&
          typeof delay === 'number' &&
          Number.isFinite(delay) &&
          delay > 0
        ) {
          setWaitUntil(Date.now() + delay * 1000);
          setSeconds(Math.ceil(delay));
        }
      } else {
        setMessage('접속을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === 'ready') return children;
  return (
    <ConfigProvider theme={antdTheme}>
      <main
        style={{
          maxWidth: 440,
          margin: '80px auto',
          padding: spacing.cardPadding,
          background: colors.bgContainer,
        }}
      >
        <Typography.Title level={1}>거산 영업지원 접속</Typography.Title>
        {state === 'checking' && <p role="status">접속 권한을 확인하고 있습니다.</p>}
        {state === 'error' && (
          <>
            <Alert
              type="error"
              role="alert"
              message="서버에 연결하지 못했습니다. 다시 시도해 주세요."
            />
            <Button
              onClick={() => {
                setState('checking');
                void checkSession();
              }}
            >
              다시 시도
            </Button>
          </>
        )}
        {state === 'login' && (
          <form onSubmit={submit}>
            <p>
              {accounts
                ? '안내받은 아이디와 비밀번호를 입력해 주세요.'
                : '안내받은 공용 비밀번호를 입력해 주세요.'}
            </p>
            {accounts && (
              <>
                <label htmlFor="access-staff-key">아이디</label>
                <Input
                  id="access-staff-key"
                  autoComplete="username"
                  value={staffKey}
                  onChange={(event) => setStaffKey(event.target.value)}
                  disabled={busy || seconds > 0}
                  required
                  autoFocus
                />
              </>
            )}
            <label htmlFor="access-password">비밀번호</label>
            <Input.Password
              id="access-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy || seconds > 0}
              required
              autoFocus={!accounts}
            />
            {message && <Alert type="error" role="alert" message={message} />}
            {seconds > 0 && <p role="status">{seconds}초 뒤에 다시 시도해 주세요.</p>}
            <Button
              type="primary"
              htmlType="submit"
              loading={busy}
              disabled={seconds > 0 || !password || (accounts && !staffKey.trim())}
            >
              접속
            </Button>
          </form>
        )}
        {state === 'setup' && (
          <ProfileSetup
            onDone={() => {
              setState('checking');
              void checkSession();
            }}
          />
        )}
      </main>
    </ConfigProvider>
  );
}

/** 첫 로그인 설정(#754): 화면에 보일 이름과 새 비밀번호. 비밀번호는 저장하지 않고 요청에만 쓴다. */
function ProfileSetup({ onDone }: { onDone: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && next !== again;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || mismatch) return;
    setBusy(true);
    setMessage('');
    try {
      await saveProfile({
        displayName: displayName.trim(),
        currentPassword: current,
        newPassword: next,
      });
      onDone();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? `${error.body.message} ${error.body.nextAction}`
          : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setCurrent('');
      setNext('');
      setAgain('');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="profile-setup">
      <p>처음 접속했습니다. 기록에 보일 이름과 새 비밀번호를 정해 주세요.</p>
      <label htmlFor="profile-name">화면에 보일 이름</label>
      <Input
        id="profile-name"
        placeholder="예: 영업 김"
        maxLength={20}
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        disabled={busy}
        required
        autoFocus
      />
      <label htmlFor="profile-current">받은 임시 비밀번호</label>
      <Input.Password
        id="profile-current"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        disabled={busy}
        required
      />
      <label htmlFor="profile-new">새 비밀번호 (8자 이상)</label>
      <Input.Password
        id="profile-new"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        disabled={busy}
        required
      />
      <label htmlFor="profile-again">새 비밀번호 한 번 더</label>
      <Input.Password
        id="profile-again"
        autoComplete="new-password"
        value={again}
        onChange={(event) => setAgain(event.target.value)}
        disabled={busy}
        required
      />
      {mismatch && <p role="status">새 비밀번호 두 칸이 다릅니다.</p>}
      {message && <Alert type="error" role="alert" message={message} />}
      <Button
        type="primary"
        htmlType="submit"
        loading={busy}
        disabled={!displayName.trim() || !current || next.length < 8 || next !== again}
      >
        저장하고 시작
      </Button>
    </form>
  );
}
