import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SessionGate from '../SessionGate';
import { ApiError, getConfigUi, SESSION_REQUIRED_EVENT } from '../../../api/client';
import { createSession } from '../../../api/session';
import fixture from '../../../test/fixtures/config-ui.json';
import type { ConfigUi, Envelope } from '../../../api/types';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getConfigUi: vi.fn(),
}));
vi.mock('../../../api/session', () => ({ createSession: vi.fn() }));
const config = vi.mocked(getConfigUi);
const login = vi.mocked(createSession);
const allowed = fixture as unknown as Envelope<ConfigUi>;
const denied = () =>
  new ApiError(401, { message: '비밀번호가 맞지 않습니다.', nextAction: '다시 입력', ref: 'test' });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

function renderGate() {
  return render(
    <SessionGate>
      <p>보호된 업무 화면</p>
    </SessionGate>,
  );
}

it('Given 세션 확인 중 When 첫 접속 Then 업무 화면을 먼저 그리지 않는다', async () => {
  let resolve!: (value: Envelope<ConfigUi>) => void;
  config.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  renderGate();
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('확인');
  await act(async () => resolve(allowed));
  expect(screen.getByText('보호된 업무 화면')).toBeInTheDocument();
});

it('Given 401 When 비밀번호 제출·쿠키 확인 성공 Then 업무 화면을 열고 비밀번호를 저장하지 않는다', async () => {
  config.mockRejectedValueOnce(denied()).mockResolvedValueOnce(allowed);
  login.mockResolvedValueOnce({ data: null, meta: {} });
  renderGate();
  const password = await screen.findByLabelText('비밀번호');
  fireEvent.change(password, { target: { value: 'test-only-passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: '접속' }));
  expect(await screen.findByText('보호된 업무 화면')).toBeInTheDocument();
  expect(login).toHaveBeenCalledWith('test-only-passphrase');
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it('Given 잘못된 비밀번호 When 401 Then 오류를 보여 주고 입력을 비운다', async () => {
  config.mockRejectedValueOnce(denied());
  login.mockRejectedValueOnce(denied());
  renderGate();
  fireEvent.change(await screen.findByLabelText('비밀번호'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: '접속' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('비밀번호가 맞지 않습니다.');
  expect(screen.getByLabelText('비밀번호')).toHaveValue('');
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
});

it('Given 로그인 응답 대기 중 When 다시 제출 Then 요청은 한 번만 보내고 확인 전에는 화면을 열지 않는다', async () => {
  let finishLogin!: (value: Awaited<ReturnType<typeof createSession>>) => void;
  let finishCheck!: (value: Envelope<ConfigUi>) => void;
  config.mockRejectedValueOnce(denied()).mockReturnValueOnce(
    new Promise((resolve) => {
      finishCheck = resolve;
    }),
  );
  login.mockReturnValueOnce(
    new Promise((resolve) => {
      finishLogin = resolve;
    }),
  );
  renderGate();
  const input = await screen.findByLabelText('비밀번호');
  const form = input.closest('form')!;
  fireEvent.change(input, { target: { value: 'test-only-passphrase' } });
  fireEvent.submit(form);
  expect(input).toBeDisabled();
  expect(input).toHaveValue('');
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(login).toHaveBeenCalledTimes(1);
  expect(login).toHaveBeenCalledWith('test-only-passphrase');
  expect(config).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
  await act(async () => finishLogin({ data: null, meta: {} }));
  expect(config).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status')).toHaveTextContent('접속 권한을 확인');
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
  await act(async () => finishCheck(allowed));
  expect(screen.getByText('보호된 업무 화면')).toBeInTheDocument();
  expect(login).toHaveBeenCalledTimes(1);
});

it('Given 로그인 요청 통신 오류 When 실패 후 다시 입력 Then 원문을 숨기고 수동 재접속할 수 있다', async () => {
  config.mockRejectedValueOnce(denied()).mockResolvedValueOnce(allowed);
  login
    .mockRejectedValueOnce(new Error('test-only-passphrase private-network-error'))
    .mockResolvedValueOnce({ data: null, meta: {} });
  renderGate();
  fireEvent.change(await screen.findByLabelText('비밀번호'), {
    target: { value: 'test-only-passphrase' },
  });
  fireEvent.click(screen.getByRole('button', { name: '접속' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('접속을 확인하지 못했습니다');
  expect(screen.queryByText(/private-network-error/)).not.toBeInTheDocument();
  const input = screen.getByLabelText('비밀번호');
  expect(input).toHaveValue('');
  expect(input).not.toBeDisabled();
  // 오류 안내 뒤 버튼의 비동기 로딩 표시까지 끝나야 다시 입력할 수 있다.
  expect(await screen.findByRole('button', { name: '접속' })).toBeDisabled();
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
  expect(login).toHaveBeenCalledTimes(1);
  expect(config).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  fireEvent.change(input, { target: { value: 'second-test-passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: '접속' }));
  expect(await screen.findByText('보호된 업무 화면')).toBeInTheDocument();
  expect(login).toHaveBeenCalledTimes(2);
  expect(login).toHaveBeenLastCalledWith('second-test-passphrase');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('Given 서버가 30초 대기를 요구 When 시간이 지나기 전·후 Then 재요청을 막았다가 입력을 허용한다', async () => {
  config.mockRejectedValueOnce(denied());
  login.mockRejectedValueOnce(
    new ApiError(429, {
      message: '잠시 기다려 주세요.',
      nextAction: '다시 입력',
      ref: 'test',
      retryAfterSeconds: 30,
    }),
  );
  renderGate();
  const input = await screen.findByLabelText('비밀번호');
  vi.useFakeTimers();
  fireEvent.change(input, { target: { value: 'wrong' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '접속' })));
  expect(input).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('30초');
  fireEvent.submit(input.closest('form')!);
  expect(login).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(input).not.toBeDisabled();
});

it('Given 로그인 응답 성공이나 쿠키 확인 실패 When 다시 조회 Then 업무 화면을 열지 않는다', async () => {
  config.mockRejectedValue(denied());
  login.mockResolvedValue({ data: null, meta: {} });
  renderGate();
  fireEvent.change(await screen.findByLabelText('비밀번호'), { target: { value: 'test' } });
  fireEvent.click(screen.getByRole('button', { name: '접속' }));
  await waitFor(() => expect(config).toHaveBeenCalledTimes(2));
  expect(await screen.findByLabelText('비밀번호')).toBeInTheDocument();
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
});

it('Given 업무 화면 사용 중 When 세션 만료 Then 화면을 닫고 접속 화면으로 돌아온다', async () => {
  config.mockResolvedValue(allowed);
  renderGate();
  await screen.findByText('보호된 업무 화면');
  act(() => window.dispatchEvent(new Event(SESSION_REQUIRED_EVENT)));
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
  expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
});

it('Given 서버 오류 When 접속 확인 실패 Then 성공으로 처리하지 않고 다시 시도한다', async () => {
  config.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(allowed);
  renderGate();
  expect(await screen.findByRole('alert')).toHaveTextContent('연결하지 못했습니다');
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('보호된 업무 화면')).toBeInTheDocument();
});
