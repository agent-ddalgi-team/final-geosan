import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SessionGate from '../SessionGate';
import { ApiError, getConfigUi, SESSION_REQUIRED_EVENT } from '../../../api/client';
import { createSession, saveProfile } from '../../../api/session';
import fixture from '../../../test/fixtures/config-ui.json';
import type { ConfigUi, Envelope } from '../../../api/types';
import { accent, loginTheme } from '../../../theme/tokens';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getConfigUi: vi.fn(),
}));
vi.mock('../../../api/session', () => ({
  createSession: vi.fn(),
  saveProfile: vi.fn(),
  STAFF_LOGIN_KIND: 'STAFF_LOGIN_REQUIRED',
}));
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

// ---------- 접속 화면 디자인 ----------

const subtitle = '영업의 다음 한 걸음을 함께합니다';

it('Given 계정 방식 401 When 접속 화면 Then 두 칸에 안내 글이 있고 둘 다 넣어야 접속할 수 있다', async () => {
  config.mockRejectedValueOnce(
    new ApiError(401, {
      message: '접속 확인이 필요합니다.',
      nextAction: '아이디와 비밀번호를 입력해 주세요.',
      ref: 'test',
      kind: 'STAFF_LOGIN_REQUIRED',
    }),
  );
  renderGate();
  const id = await screen.findByPlaceholderText('아이디를 입력하세요');
  const password = screen.getByPlaceholderText('비밀번호를 입력하세요');
  const submit = screen.getByRole('button', { name: '접속' });
  expect(submit).toBeDisabled();
  fireEvent.change(id, { target: { value: 'sales-1' } });
  expect(submit).toBeDisabled();
  fireEvent.change(password, { target: { value: 'test-only-pass' } });
  expect(submit).toBeEnabled();
});

it('Given 401 When 접속 화면 Then 회사 이름·로고·제목·내부용 표시·저작권 줄을 보인다', async () => {
  config.mockRejectedValueOnce(denied());
  const view = renderGate();
  expect(await screen.findByLabelText('비밀번호')).toBeInTheDocument();
  expect(screen.getByText('(주)거산케미칼')).toBeInTheDocument();
  expect(view.container.querySelector('img.login-logo')?.getAttribute('src')).toMatch(
    /geosan-logo/,
  );
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('거산 영업지원');
  expect(screen.getByText(subtitle)).toBeInTheDocument();
  expect(screen.getByText('내부용')).toBeInTheDocument();
  expect(screen.getByRole('contentinfo')).toHaveTextContent('© (주)거산케미칼 · 영업지원 에이전트');
});

it('#978 Given 401 When 접속 화면 Then 밤하늘 바탕과 빛나는 곡선 위에 제목·한 줄 소개가 있고, 그 아래 유리 상자 안에 입력 칸·[접속]이 있다', async () => {
  config.mockRejectedValueOnce(denied());
  const view = renderGate();
  const password = await screen.findByLabelText('비밀번호');
  const card = screen.getByTestId('login-card');
  // 유리 상자 안: 입력 칸과 [접속]. 제목과 한 줄 소개는 상자 밖(위)에 있다.
  expect(card).toContainElement(password);
  expect(card).toContainElement(screen.getByRole('button', { name: '접속' }));
  const title = screen.getByRole('heading', { level: 1 });
  expect(card).not.toContainElement(title);
  expect(card).not.toContainElement(screen.getByText(subtitle));
  expect(title.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // 회사 이름·"내부용"·저작권 줄도 상자 밖(위·아래)에 있다.
  expect(card).not.toContainElement(screen.getByText('(주)거산케미칼'));
  expect(card).not.toContainElement(screen.getByText('내부용'));
  expect(card).not.toContainElement(screen.getByRole('contentinfo'));
  // 아래쪽 빛나는 곡선은 꾸밈이라 화면 읽기 도구에는 안 읽힌다.
  const planet = view.container.querySelector('.login-planet') as HTMLElement;
  expect(planet).not.toBeNull();
  expect(planet).toHaveAttribute('aria-hidden', 'true');
  // 색은 tokens의 loginTheme에서 CSS 변수로 넘어온다: 보라 밤하늘, 유리 상자, 모서리 20.
  const page = view.container.querySelector('.login-page') as HTMLElement;
  expect(page.style.getPropertyValue('--login-sky-top')).toBe(loginTheme.skyTop);
  expect(page.style.getPropertyValue('--login-sky-glow')).toBe(loginTheme.skyGlow);
  expect(page.style.getPropertyValue('--login-planet')).toBe(loginTheme.planet);
  expect(page.style.getPropertyValue('--login-card-tint')).toBe(loginTheme.cardTint);
  expect(page.style.getPropertyValue('--login-card-radius')).toBe('20px');
  // [접속] 단추는 다른 화면과 같은 강조 보라다(연두 단추가 아니다).
  expect(loginTheme.accent).toBe(accent.bg);
});

it('Given 세션 확인 중 When 아직 응답 전 Then "내부용" 표시는 보이지 않는다(업무 화면의 내부용 띠와 헷갈리지 않게)', async () => {
  let resolve!: (value: Envelope<ConfigUi>) => void;
  config.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  renderGate();
  expect(screen.getByRole('status')).toHaveTextContent('확인');
  expect(screen.queryByText(/내부용/)).not.toBeInTheDocument();
  await act(async () => resolve(allowed));
});

it('Given 접속 허용 When 업무 화면을 연다 Then 접속 화면의 틀은 사라진다', async () => {
  config.mockResolvedValueOnce(allowed);
  renderGate();
  expect(await screen.findByText('보호된 업무 화면')).toBeInTheDocument();
  expect(screen.queryByText(subtitle)).not.toBeInTheDocument();
});

it('Given 서버 오류 When 접속 확인 실패 Then 같은 틀 안에서 오류와 다시 시도를 보인다', async () => {
  config.mockRejectedValueOnce(new Error('offline'));
  renderGate();
  expect(await screen.findByRole('alert')).toHaveTextContent('연결하지 못했습니다');
  expect(screen.getByText(subtitle)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
});

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

// ---------- #754 계정 방식 ----------

const accountDenied = () =>
  new ApiError(401, {
    message: '접속 확인이 필요합니다.',
    nextAction: '아이디와 비밀번호를 입력해 주세요.',
    ref: 'test',
    kind: 'STAFF_LOGIN_REQUIRED',
  });

function withStaff(current: ConfigUi['currentStaff']): Envelope<ConfigUi> {
  return { ...allowed, data: { ...allowed.data, currentStaff: current } };
}

it('Given 계정 방식 401 When 접속 화면 Then 아이디 칸이 보이고 아이디·비밀번호로 로그인한다', async () => {
  config
    .mockRejectedValueOnce(accountDenied())
    .mockResolvedValueOnce(
      withStaff({ key: 'sales-1', displayName: '영업 김', canRecord: true, setupRequired: false }),
    );
  login.mockResolvedValueOnce({ data: null, meta: {} });
  renderGate();
  const id = await screen.findByLabelText('아이디');
  // 화면 시안: 계정 방식에는 안내 문장을 두지 않는다(칸 이름과 안내 글이 대신한다).
  expect(screen.queryByText('안내받은 아이디와 비밀번호를 입력해 주세요.')).not.toBeInTheDocument();
  fireEvent.change(id, { target: { value: ' sales-1 ' } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'test-only-pass' } });
  fireEvent.click(screen.getByRole('button', { name: '접속' }));
  expect(await screen.findByText('보호된 업무 화면')).toBeInTheDocument();
  expect(login).toHaveBeenCalledWith('test-only-pass', 'sales-1');
  expect(localStorage.length).toBe(0);
});

it('Given 공용 방식 401 When 접속 화면 Then 아이디 칸이 없다', async () => {
  config.mockRejectedValueOnce(denied());
  renderGate();
  await screen.findByLabelText('비밀번호');
  expect(screen.queryByLabelText('아이디')).not.toBeInTheDocument();
});

it('Given 첫 로그인(임시 비밀번호) When 이름·새 비밀번호를 정한다 Then 저장 뒤 업무 화면을 연다', async () => {
  config
    .mockResolvedValueOnce(
      withStaff({ key: 'sales-1', displayName: null, canRecord: false, setupRequired: true }),
    )
    .mockResolvedValueOnce(
      withStaff({ key: 'sales-1', displayName: '영업 김', canRecord: true, setupRequired: false }),
    );
  vi.mocked(saveProfile).mockResolvedValueOnce({
    data: { key: 'sales-1', displayName: '영업 김', canRecord: true, setupRequired: false },
    meta: {},
  });
  renderGate();
  expect(await screen.findByTestId('profile-setup')).toBeInTheDocument();
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
  const save = screen.getByRole('button', { name: '저장하고 시작' });
  fireEvent.change(screen.getByLabelText('화면에 보일 이름'), { target: { value: ' 영업 김 ' } });
  fireEvent.change(screen.getByLabelText('받은 임시 비밀번호'), { target: { value: 'temp-pass' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 (8자 이상)'), {
    target: { value: 'new-pass-1' },
  });
  fireEvent.change(screen.getByLabelText('새 비밀번호 한 번 더'), {
    target: { value: 'new-pass-2' },
  });
  expect(screen.getByText('새 비밀번호 두 칸이 다릅니다.')).toBeInTheDocument();
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('새 비밀번호 한 번 더'), {
    target: { value: 'new-pass-1' },
  });
  fireEvent.click(save);
  expect(await screen.findByText('보호된 업무 화면')).toBeInTheDocument();
  expect(saveProfile).toHaveBeenCalledWith({
    displayName: '영업 김',
    currentPassword: 'temp-pass',
    newPassword: 'new-pass-1',
  });
});

it('Given 첫 로그인 When 서버가 이름을 거부 Then 이유를 보이고 업무 화면을 열지 않는다', async () => {
  config.mockResolvedValueOnce(
    withStaff({ key: 'sales-1', displayName: null, canRecord: false, setupRequired: true }),
  );
  vi.mocked(saveProfile).mockRejectedValueOnce(
    new ApiError(400, {
      message: '이름에 전화번호·이메일은 넣을 수 없습니다.',
      nextAction: '이름이나 부르는 말만 적어 주세요. 예: 영업 김',
      ref: 'test',
    }),
  );
  renderGate();
  await screen.findByTestId('profile-setup');
  fireEvent.change(screen.getByLabelText('화면에 보일 이름'), { target: { value: '김 010' } });
  fireEvent.change(screen.getByLabelText('받은 임시 비밀번호'), { target: { value: 'temp-pass' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 (8자 이상)'), {
    target: { value: 'new-pass-1' },
  });
  fireEvent.change(screen.getByLabelText('새 비밀번호 한 번 더'), {
    target: { value: 'new-pass-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: '저장하고 시작' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('전화번호·이메일');
  expect(screen.queryByText('보호된 업무 화면')).not.toBeInTheDocument();
});

it('Given 계정 방식 사용 중 When 세션 만료(kind STAFF_LOGIN_REQUIRED) Then 아이디 칸이 있는 접속 화면', async () => {
  config.mockResolvedValueOnce(allowed);
  renderGate();
  await screen.findByText('보호된 업무 화면');
  act(() =>
    window.dispatchEvent(
      new CustomEvent(SESSION_REQUIRED_EVENT, { detail: { kind: 'STAFF_LOGIN_REQUIRED' } }),
    ),
  );
  expect(await screen.findByLabelText('아이디')).toBeInTheDocument();
});
