// 대시보드 + 실제 공통 틀(AppFrame)을 함께 그려, 담당자 선택칸을 눌렀을 때 요청이 실제로 어떻게 나가는지 본다(#216 후속).
// 서버(fetch)만 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 담당자 키 헤더(X-Staff-Key)에 따라 다른 기록을 돌려준다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import AppFrame from '../../components/frame/AppFrame';
import { STAFF_STORAGE_KEY } from '../../components/frame/FrameContext';
import dashboardFixture from '../../test/fixtures/dashboard.json';
import configFixture from '../../test/fixtures/config-ui.json';

// 지도 칸(#641)은 이 시험의 관심사가 아니다. 응답을 오지 않게 막아 두어 요청 횟수 확인에 끼어들지 않게 한다.
vi.mock('../../api/dashboardMap', () => ({ getDashboardMap: vi.fn(() => new Promise(() => {})) }));

const STAFF = [
  { key: 'park-lee', displayName: '영업 담당' },
  { key: 'kim-gwajang', displayName: '검수 담당' },
  { key: 'choi-pm', displayName: '운영 담당' },
  { key: 'viewer', displayName: '보기 전용' },
];

/** 담당자 키별로 서버가 돌려줄 "최근 내 기록". 키가 없거나 기록 담당자가 아니면 빈 목록이다. */
const RECENT: Record<string, string[]> = {
  'park-lee': ['영업 담당의 메모'],
  'kim-gwajang': ['검수 담당의 접촉', '검수 담당의 메모'],
};

function dashboardFor(staffKey: string | null) {
  const summaries = (staffKey && RECENT[staffKey]) || [];
  return {
    data: {
      ...dashboardFixture.data,
      recentActivity: summaries.map((summary, index) => ({
        at: `2026-11-05T09:0${index}:00+09:00`,
        oppId: `opp-${index}`,
        customerName: `시험 회사 ${index}`,
        kind: 'NOTE',
        summary,
      })),
    },
    meta: { hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' },
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

interface Call {
  path: string;
  staffKey: string | null;
}

function installFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const staffKey = ((init?.headers ?? {}) as Record<string, string>)['X-Staff-Key'] ?? null;
      const path = String(url).replace('/api/v1', '');
      calls.push({ path, staffKey });
      if (path === '/config/ui') {
        return json({ data: { ...configFixture.data, staff: STAFF }, meta: {} });
      }
      if (path === '/dashboard') return json(dashboardFor(staffKey));
      throw new Error(`예상하지 못한 요청: ${path}`);
    }),
  );
  return calls;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppFrame title="대시보드">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
        </Routes>
      </AppFrame>
    </MemoryRouter>,
  );
}

async function pickStaff(name: string) {
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByTitle(name));
}

describe('대시보드 + 공통 틀: 담당자 선택칸을 누르면 최근 내 기록이 바뀐다 (#216 후속)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('선택칸으로 담당자를 바꿀 때마다 그 담당자 키로 다시 읽고, 기록이 그 담당자 것으로 바뀐다', async () => {
    window.localStorage.setItem(STAFF_STORAGE_KEY, 'park-lee');
    const calls = installFetch();
    renderApp();

    // 처음 열 때: 설정을 읽은 뒤 기억해 둔 영업 담당 기록이 보인다.
    expect(await screen.findByText('영업 담당의 메모')).toBeInTheDocument();

    await pickStaff('검수 담당');
    expect(await screen.findByText('검수 담당의 메모')).toBeInTheDocument();
    expect(screen.getByText('검수 담당의 접촉')).toBeInTheDocument();
    expect(screen.queryByText('영업 담당의 메모')).not.toBeInTheDocument();

    await pickStaff('운영 담당');
    await waitFor(() => expect(screen.queryByText('검수 담당의 메모')).not.toBeInTheDocument());
    expect(screen.getByTestId('dashboard-recent-empty')).toBeInTheDocument();

    await pickStaff('보기 전용');
    await waitFor(() => expect(screen.getByTestId('dashboard-recent-empty')).toBeInTheDocument());

    // 마지막 요청들의 담당자 키: 검수 담당, 운영 담당 순으로 나가고, 보기 전용은 키를 보내지 않는다.
    const dash = calls.filter((c) => c.path === '/dashboard').map((c) => c.staffKey);
    expect(dash).toContain('park-lee');
    expect(dash).toContain('kim-gwajang');
    expect(dash).toContain('choi-pm');
    expect(dash.at(-1)).toBeNull();
    const view = within(screen.getByRole('main'));
    expect(view.queryByText('영업 담당의 메모')).not.toBeInTheDocument();
    // 담당자 선택칸을 네 번 누르는 긴 흐름이라 기본 5초로는 느린 컴퓨터에서 모자란다. 이 시험에만 시간을 넉넉히 준다.
  }, 30_000);
});
