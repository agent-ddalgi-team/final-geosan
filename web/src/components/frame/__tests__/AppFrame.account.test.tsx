// #754 계정 방식: 위쪽에 담당자 고르기 대신 로그인한 사람과 [로그아웃]이 보이고,
// 기록 가능 여부는 서버가 준 canRecord를 따른다. 설정 응답은 가짜(실제 서버 연결 확인이 아님).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AppFrame from '../AppFrame';
import { STAFF_STORAGE_KEY, useFrame } from '../FrameContext';
import { getConfigUi } from '../../../api/client';
import { logout } from '../../../api/session';
import { frame } from '../../../labels/ko';
import fixture from '../../../test/fixtures/config-ui.json';
import type { ConfigUi, CurrentStaff, Envelope } from '../../../api/types';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getConfigUi: vi.fn(),
}));
vi.mock('../../../api/session', () => ({ logout: vi.fn() }));

function Probe() {
  const { staffKey, canRecord } = useFrame();
  return <span data-testid="probe">{`${staffKey ?? 'none'}|${canRecord}`}</span>;
}

function renderWith(current: CurrentStaff | null) {
  const base = fixture as unknown as Envelope<ConfigUi>;
  vi.mocked(getConfigUi).mockResolvedValue({
    ...base,
    data: {
      ...base.data,
      staff: current
        ? [{ key: current.key, displayName: current.displayName ?? current.key }]
        : base.data.staff,
      currentStaff: current,
    },
  });
  return render(
    <MemoryRouter>
      <AppFrame title={frame.pageTitleList}>
        <Probe />
      </AppFrame>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
});

it('Given 로그인한 담당자 When 공통 틀 Then 이름과 [로그아웃]이 보이고 담당자 고르기는 없다', async () => {
  window.localStorage.setItem(STAFF_STORAGE_KEY, 'park-lee');
  renderWith({ key: 'sales-1', displayName: '영업 김', canRecord: true, setupRequired: false });
  expect(await screen.findByTestId('current-staff')).toHaveTextContent('영업 김 님');
  expect(screen.queryByTestId('staff-select')).not.toBeInTheDocument();
  // 브라우저에 기억해 둔 옛 담당자 키가 아니라 로그인한 사람이 담당자다.
  expect(screen.getByTestId('probe')).toHaveTextContent('sales-1|true');
});

it('Given 보기 전용 계정 When 공통 틀 Then 기록할 수 없다', async () => {
  renderWith({ key: 'boss-1', displayName: '대표', canRecord: false, setupRequired: false });
  expect(await screen.findByTestId('current-staff')).toHaveTextContent('대표 님');
  expect(screen.getByTestId('probe')).toHaveTextContent('boss-1|false');
});

it('Given 로그인한 담당자 When [로그아웃] Then 세션을 끝내는 요청을 보낸다', async () => {
  vi.mocked(logout).mockResolvedValue({ data: null, meta: {} });
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  renderWith({ key: 'sales-1', displayName: '영업 김', canRecord: true, setupRequired: false });
  await userEvent.click(await screen.findByTestId('logout-button'));
  expect(logout).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  vi.unstubAllGlobals();
});

it('Given 공용 방식(currentStaff null) When 공통 틀 Then 지금처럼 담당자 고르기가 보인다', async () => {
  renderWith(null);
  expect(await screen.findByTestId('staff-select')).toBeInTheDocument();
  expect(screen.queryByTestId('current-staff')).not.toBeInTheDocument();
});
