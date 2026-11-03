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
