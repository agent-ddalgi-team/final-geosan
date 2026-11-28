// #980(PM 결정 2026-11-28): 가린 메모 [가린 번호 보기], 영업 홈 보관 기한 줄, 운영 관리 열람 기록.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버는 tests/unit/u3/test_contact_persons.py).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ActivityTimeline from '../../records/ActivityTimeline';
import TodayChecks from '../../dashboard/TodayChecks';
import OperationsPage from '../../../pages/OperationsPage';
import { getActivity, revealNote } from '../../../api/client';
import { getOperations } from '../../../api/operations';
import type { Operations } from '../../../api/operations';
import type { ActivityItem, ConfigUi } from '../../../api/types';
import type { TodayCheckRow } from '../../../api/dashboardTypes';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getActivity: vi.fn(),
  revealNote: vi.fn(),
}));
vi.mock('../../../api/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/operations')>()),
  getOperations: vi.fn(),
}));

const config = { staff: [{ key: 'park-lee', displayName: '박 이사' }] } as unknown as ConfigUi;

function frame(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...overrides,
  };
}

function renderIn(children: React.ReactNode, value = frame()) {
  render(
    <MemoryRouter>
      <FrameContext.Provider value={value}>{children}</FrameContext.Provider>
    </MemoryRouter>,
  );
}

const masked: ActivityItem = {
  at: '2026-11-28T10:00:00+09:00',
  actor: 'park-lee',
  kind: 'NOTE',
  summary: '김과장 [번호 가림] 통화',
  recordId: 'note-1',
  recordKind: 'NOTE',
  noteKind: 'MEMO',
  text: '김과장 [번호 가림] 통화',
  textMasked: true,
};

beforeEach(() => {
  vi.mocked(getActivity).mockReset();
  vi.mocked(revealNote).mockReset();
  vi.mocked(getOperations).mockReset();
});

describe('가린 메모 [가린 번호 보기] (#980)', () => {
  it('Given 번호를 가린 메모 When 확인 문구에 체크하고 열면 Then 원래 글이 그 줄에 보인다', async () => {
    const user = userEvent.setup();
    vi.mocked(getActivity).mockResolvedValueOnce({ data: [masked], meta: {} });
    vi.mocked(revealNote).mockResolvedValueOnce({
      data: { noteId: 'note-1', text: '김과장 010-1234-5678 통화' },
      meta: {},
    });
    renderIn(<ActivityTimeline oppId="opp-1" refreshKey={0} />);
    expect(await screen.findByTestId('timeline-summary')).toHaveTextContent('[번호 가림]');
    await user.click(screen.getByTestId('timeline-reveal-note'));
    expect(screen.getByTestId('timeline-reveal-open-button')).toBeDisabled();
    await user.click(screen.getByTestId('timeline-reveal-ack'));
    await user.click(screen.getByTestId('timeline-reveal-open-button'));
    expect(revealNote).toHaveBeenCalledWith('note-1', 'park-lee');
    expect(await screen.findByTestId('timeline-summary')).toHaveTextContent('010-1234-5678');
    await user.click(screen.getByTestId('timeline-hide-note'));
    expect(screen.getByTestId('timeline-summary')).toHaveTextContent('[번호 가림]');
  });

  it('Given 보기 전용 When 가린 메모를 보면 Then [가린 번호 보기]가 없다', async () => {
    vi.mocked(getActivity).mockResolvedValueOnce({ data: [masked], meta: {} });
    renderIn(
      <ActivityTimeline oppId="opp-1" refreshKey={0} />,
      frame({ canRecord: false, staffKey: 'viewer' }),
    );
    expect(await screen.findByTestId('timeline-summary')).toHaveTextContent('[번호 가림]');
    expect(screen.queryByTestId('timeline-reveal-note')).not.toBeInTheDocument();
  });
});

describe('영업 홈 보관 기한 줄 (#980)', () => {
  it('Given 보관 기한이 다가온 연락처 When 영업 홈 Then 회사 이름과 기한만 보이고 누르면 상세로 간다', () => {
    const row: TodayCheckRow = {
      kind: 'CONTACT_RETENTION_DUE',
      count: 1,
      items: [{ oppId: 'opp-7', customerName: '가상정밀', dueAt: '2026-12-05', note: null }],
      listFilter: null,
    };
    renderIn(<TodayChecks rows={[row]} />);
    expect(screen.getByTestId('dashboard-today-count-CONTACT_RETENTION_DUE')).toHaveTextContent(
      '상대 담당자 연락처 · 지울지 확인 1곳',
    );
    const items = screen.getByTestId('dashboard-today-items-CONTACT_RETENTION_DUE');
    expect(items).toHaveTextContent('가상정밀');
    expect(items).toHaveTextContent('12/5');
    expect(screen.getByRole('link', { name: '가상정밀' })).toHaveAttribute(
      'href',
      '/opportunities/opp-7',
    );
  });
});

describe('운영 관리 열람 기록 (#980)', () => {
  it('Given 연락처를 연 기록 When 운영 관리 Then 누가·언제·어느 회사만 보이고 연 값은 없다', async () => {
    const data = {
      usage: {
        month: '2026-11',
        calls: 0,
        callLimit: 1000,
        costUsd: 0,
        costLimitUsd: 20,
        alertRatio: 0.8,
        groups: [],
        daily: [],
        autoResearchToday: { usedUsd: 0, limitUsd: 1 },
      },
      sources: [],
      blocked: [],
      contactReveals: [
        {
          at: '2026-11-28T01:00:00Z',
          staffKey: 'park-lee',
          staffName: '박 이사',
          oppId: 'opp-7',
          customerName: '가상정밀',
          kind: 'CONTACT',
        },
      ],
    } satisfies Operations;
    vi.mocked(getOperations).mockResolvedValueOnce({ data, meta: {} });
    renderIn(<OperationsPage />, frame({ staffKey: 'choi-pm' }));
    const row = await screen.findByTestId('ops-reveal-row');
    expect(row).toHaveTextContent('박 이사');
    expect(row).toHaveTextContent('가상정밀');
    expect(row).toHaveTextContent('상대 담당자 연락처');
  });
});
