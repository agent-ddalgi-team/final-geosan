import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Alert, Button, ConfigProvider, Input, Typography } from 'antd';
import { ApiError, getConfigUi, SESSION_REQUIRED_EVENT } from '../../api/client';
import { createSession } from '../../api/session';
import { antdTheme, colors, spacing } from '../../theme/tokens';

/** 서버가 확인한 세션만 통과시킨다. 실제 접근 차단과 실패 횟수 제한은 서버 책임이다. */
export default function SessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'login' | 'ready' | 'error'>('checking');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const checkSession = useCallback((signal?: AbortSignal) => {
    return getConfigUi(signal)
      .then(() => {
        if (!signal?.aborted) setState('ready');
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setState(error instanceof ApiError && error.status === 401 ? 'login' : 'error');
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    const expired = () => {
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
      await createSession(entered);
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
            <p>안내받은 공용 비밀번호를 입력해 주세요.</p>
            <label htmlFor="access-password">비밀번호</label>
            <Input.Password
              id="access-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy || seconds > 0}
              required
              autoFocus
            />
            {message && <Alert type="error" role="alert" message={message} />}
            {seconds > 0 && <p role="status">{seconds}초 뒤에 다시 시도해 주세요.</p>}
            <Button
              type="primary"
              htmlType="submit"
              loading={busy}
              disabled={seconds > 0 || !password}
            >
              접속
            </Button>
          </form>
        )}
      </main>
    </ConfigProvider>
  );
}
