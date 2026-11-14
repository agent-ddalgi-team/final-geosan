// 대시보드의 영업 비서 질문 칸 자리(#680): "오늘 확인할 것" 바로 아래, 일정 달력 위.
// getDashboard는 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import { getDashboard } from '../../api/dashboard';
import type { Dashboard } from '../../api/dashboardTypes';
import type { ConfigUi } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { assistantTexts } from '../../labels/ko';
import dashboardFixture from '../../test/fixtures/dashboard.json';

vi.mock('../../api/dashboard', () => ({ getDashboard: vi.fn() }));
vi.mock('../../api/dashboardMap', () => ({ getDashboardMap: vi.fn(() => new Promise(() => {})) }));

const mockedGet = vi.mocked(getDashboard);

function renderPage(config: ConfigUi | null) {
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
          canRecord: true,
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
  beforeEach(() => mockedGet.mockReset());

  it('스위치가 켜져 있으면 질문 칸이 "오늘 확인할 것" 아래, 일정 달력 위에 보인다', async () => {
    renderPage({ assistant: { enabled: true, questionMaxLength: 300 } } as unknown as ConfigUi);
    const ask = await screen.findByTestId('assistant-ask');
    expect(after(screen.getByTestId('dashboard-today'), ask)).toBe(true);
    expect(after(ask, screen.getByTestId('dashboard-calendar-section'))).toBe(true);
    expect(screen.getByTestId('assistant-ask-button')).toHaveTextContent(assistantTexts.askButton);
  });

  it('스위치가 꺼져 있으면 같은 자리에 안내 한 줄만 보인다', async () => {
    renderPage({ assistant: { enabled: false, questionMaxLength: 300 } } as unknown as ConfigUi);
    const line = await screen.findByTestId('assistant-disabled');
    expect(line).toHaveTextContent(assistantTexts.disabled);
    expect(after(screen.getByTestId('dashboard-today'), line)).toBe(true);
    expect(screen.queryByTestId('assistant-question-input')).not.toBeInTheDocument();
  });

  it('서버가 설정 값을 안 주면(옛 서버) 질문 칸도 안내도 없다', async () => {
    renderPage({} as ConfigUi);
    await screen.findByTestId('dashboard-today');
    expect(screen.queryByTestId('assistant-ask')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-disabled')).not.toBeInTheDocument();
  });
});
