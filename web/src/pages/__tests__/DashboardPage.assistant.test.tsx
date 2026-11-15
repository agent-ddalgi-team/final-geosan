// 대시보드의 영업 비서 질문 칸 자리(#680): "오늘 확인할 것" 바로 아래, 일정 달력 위.
// getDashboard는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import { getDashboard } from '../../api/dashboard';
import { getAssistantDaily, SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import type { Dashboard } from '../../api/dashboardTypes';
import type { ConfigUi } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { assistantTexts } from '../../labels/ko';
import dashboardFixture from '../../test/fixtures/dashboard.json';

vi.mock('../../api/dashboard', () => ({ getDashboard: vi.fn() }));
vi.mock('../../api/dashboardMap', () => ({ getDashboardMap: vi.fn(() => new Promise(() => {})) }));
// 오늘 정리(#743): 스위치가 켜져 있으면 대시보드가 저절로 부른다. 실제 서버를 부르지 않게 가짜로 바꾼다.
vi.mock('../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/assistant')>()),
  getAssistantDaily: vi.fn(),
}));

const mockedGet = vi.mocked(getDashboard);
const mockedDaily = vi.mocked(getAssistantDaily);

function renderPage(config: ConfigUi | null, canRecord = true) {
  mockedGet.mockResolvedValue({
    data: dashboardFixture.data as unknown as Dashboard,
    meta: { hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' },
  });
  render(
    <MemoryRouter initialEntries={['/']}>
      <FrameContext.Provider
        value={{
          config,
          staffKey: 'park-lee',
          setStaffKey: () => {},
          canRecord,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <DashboardPage />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

const after = (a: HTMLElement, b: HTMLElement) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('대시보드 › 영업 비서 질문 칸 (#680)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedDaily.mockReset();
    mockedDaily.mockReturnValue(new Promise(() => {}));
  });

  it('#773: 질문 칸은 대시보드 본문이 아니라 오른쪽 "💬 영업 코치" 칸(AppFrame dock)에 있다', async () => {
    renderPage({ assistant: { enabled: true, questionMaxLength: 300 } } as unknown as ConfigUi);
    await screen.findByTestId('dashboard-today');
    expect(screen.queryByTestId('assistant-ask')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-disabled')).not.toBeInTheDocument();
  });

  it('서버가 설정 값을 안 주면(옛 서버) 질문 칸도 안내도 없다', async () => {
    renderPage({} as ConfigUi);
    await screen.findByTestId('dashboard-today');
    expect(screen.queryByTestId('assistant-ask')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-disabled')).not.toBeInTheDocument();
  });
});

describe('대시보드 › 오늘 정리 (#743)', () => {
  const ON = { assistant: { enabled: true, questionMaxLength: 300 } } as unknown as ConfigUi;

  beforeEach(() => {
    mockedGet.mockReset();
    mockedDaily.mockReset();
  });

  it('스위치가 켜져 있으면 "오늘 확인할 것" 제목 아래·줄 목록 위에 AI가 쓴 오늘 정리가 보인다', async () => {
    mockedDaily.mockResolvedValue({
      data: {
        summary: '- 화 11/18 A정밀 방문 → 근처 1.5km B금속(관심)도 들르세요',
        sources: [{ oppId: 'opp-1', name: 'A정밀' }],
        aiGenerated: true,
        day: '2026-11-14',
        generatedAt: '2026-11-14T00:00:00Z',
        reused: false,
      },
      meta: {},
    });
    renderPage(ON);
    const brief = await screen.findByTestId('assistant-daily');
    const today = screen.getByTestId('dashboard-today');
    expect(today).toContainElement(brief);
    expect(brief).toHaveTextContent('B금속(관심)');
    expect(brief).toHaveTextContent(assistantTexts.dailyMark);
    const firstRow = screen.getAllByTestId('dashboard-today-row')[0];
    expect(after(brief, firstRow)).toBe(true);
    expect(mockedDaily).toHaveBeenCalledTimes(1);
    expect(mockedDaily.mock.calls[0][0]).toBe('park-lee');
  });

  it('스위치가 꺼져 있으면 부르지 않고 자리도 없다', async () => {
    renderPage({ assistant: { enabled: false, questionMaxLength: 300 } } as unknown as ConfigUi);
    await screen.findByTestId('dashboard-today');
    expect(screen.queryByTestId('dashboard-today-assistant')).not.toBeInTheDocument();
    expect(mockedDaily).not.toHaveBeenCalled();
  });

  it('담당자를 고르지 않았으면(기록할 수 없음) 부르지 않는다', async () => {
    renderPage(ON, false);
    await screen.findByTestId('dashboard-today');
    expect(screen.queryByTestId('dashboard-today-assistant')).not.toBeInTheDocument();
    expect(mockedDaily).not.toHaveBeenCalled();
  });
});

describe('대시보드 › 영업 코치 [넣기] 뒤 (#774)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedDaily.mockReset();
    mockedDaily.mockReturnValue(new Promise(() => {}));
  });

  it('오른쪽 칸에서 일정을 넣었다는 알림이 오면 대시보드를 다시 읽는다', async () => {
    renderPage({ assistant: { enabled: false, questionMaxLength: 300 } } as unknown as ConfigUi);
    await screen.findByTestId('dashboard-today');
    expect(mockedGet).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: 'opp-1' }));
    });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('dashboard-today')).toBeInTheDocument();
  });
});
