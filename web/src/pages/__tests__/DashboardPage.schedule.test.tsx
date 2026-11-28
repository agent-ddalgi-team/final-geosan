// #983 영업 홈 "진행 중인 회사" 표의 다음 일정 칸에서 바로 일정 잡기 · 바꾸기, 그리고 왼쪽 메뉴 달력과 일정 나눠 쓰기.
// 시나리오(Given/When/Then)로 적는다. 서버 요청(영업 홈 집계 · 회사 상세 · 영업 결과 저장 · 질문 파일 · 설정)은
// 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 회사 이름은 모두 가상이다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import AppFrame from '../../components/frame/AppFrame';
import { FrameContext, STAFF_STORAGE_KEY } from '../../components/frame/FrameContext';
import { resetSideSchedule } from '../../components/frame/useSideSchedule';
import { resetScheduleQuestions } from '../../components/schedule/scheduleKinds';
import { SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import {
  ApiError,
  getConfigUi,
  getOpportunityDetail,
  getSalesQuestions,
  postOutcome,
} from '../../api/client';
import { getDashboard } from '../../api/dashboard';
import type { Dashboard, ProgressCompany } from '../../api/dashboardTypes';
import type { Envelope, OpportunityDetail } from '../../api/types';
import dashboardFixture from '../../test/fixtures/dashboard.json';
import configFixture from '../../test/fixtures/config-ui.json';

vi.mock('../../api/dashboard', () => ({ getDashboard: vi.fn() }));
vi.mock('../../api/dashboardMap', () => ({ getDashboardMap: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../api/salesAnalysis', () => ({
  getSalesAnalysis: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../api/menuBadges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/menuBadges')>()),
  getMenuBadges: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(() => new Promise(() => {})),
  getConfigUi: vi.fn(),
  getOpportunityDetail: vi.fn(),
  postOutcome: vi.fn(),
  getSalesQuestions: vi.fn(() => new Promise(() => {})),
}));

const mockedGet = vi.mocked(getDashboard);
const mockedDetail = vi.mocked(getOpportunityDetail);
const mockedPost = vi.mocked(postOutcome);
const fixtureData = dashboardFixture.data as unknown as Dashboard;

function company(overrides: Partial<ProgressCompany> & { oppId: string }): ProgressCompany {
  return {
    customerName: `가상 ${overrides.oppId}`,
    lastContactAt: '2026-11-20',
    nextScheduleAt: null,
    nextScheduleNote: null,
    stalled: false,
    ...overrides,
  };
}

/** 오늘은 2026-11-28(한국). 가상볼트 = 일정 없음(멈춤), 가상시플 = 지난 일정 11/18 방문. */
function dashboard(extra: Partial<Dashboard> = {}): Envelope<Dashboard> {
  return {
    data: {
      ...fixtureData,
      schedule: [
        {
          oppId: 'opp-p',
          customerName: '가상시플',
          oppTitle: '가상 건',
          dueAt: '2026-11-18',
          note: '방문',
          overdue: true,
          staffKey: 'park-lee',
        },
      ],
      progressCompanies: {
        IN_CONTACT: [
          company({ oppId: 'opp-s', customerName: '가상볼트', stalled: true }),
          company({
            oppId: 'opp-p',
            customerName: '가상시플',
            nextScheduleAt: '2026-11-18',
            nextScheduleNote: '방문',
          }),
        ],
      },
      ...extra,
    },
    meta: { hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' },
  };
}

function detailOf(status: string | null) {
  return {
    data: {
      evalId: 'eval-3',
      records: {
        outcome: status
          ? { version: 2, updatedBy: 'park-lee', updatedAt: '2026-11-20T09:00:00+09:00', status }
          : null,
      },
    } as unknown as OpportunityDetail,
    meta: {},
  } as Awaited<ReturnType<typeof getOpportunityDetail>>;
}

function savedReply() {
  return {
    data: {
      status: 'IN_PROGRESS',
      version: 3,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-28T10:00:00+09:00',
    },
    meta: {},
  } as unknown as Awaited<ReturnType<typeof postOutcome>>;
}

function renderPage(frame: { staffKey: string | null; canRecord: boolean }) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: frame.staffKey,
          setStaffKey: () => {},
          canRecord: frame.canRecord,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <Routes>
          <Route path="/" element={<DashboardPage />} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

const PARK = { staffKey: 'park-lee', canRecord: true };

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;
const scheduleButton = (name: string) =>
  within(rowOf(name)).getByTestId('dashboard-progress-schedule-button');

let events: string[] = [];
const onEvent = (event: Event) => events.push((event as CustomEvent<string>).detail);

beforeEach(() => {
  window.localStorage.clear();
  resetSideSchedule();
  resetScheduleQuestions();
  mockedGet.mockReset();
  mockedDetail.mockReset();
  mockedPost.mockReset();
  vi.mocked(getSalesQuestions).mockClear();
  events = [];
  window.addEventListener(SCHEDULE_CHANGED_EVENT, onEvent);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T03:00:00Z'));
});

afterEach(() => {
  window.removeEventListener(SCHEDULE_CHANGED_EVENT, onEvent);
  vi.useRealTimers();
});

describe('진행 중인 회사 표에서 바로 일정 잡기 (#983)', () => {
  it('Given 일정이 없는 회사 When [일정 잡기] → 날짜 · 종류 · 내용 → [저장] Then 그 회사 상세를 읽고 지금 단계 그대로 일정을 한 번 저장한 뒤, 영업 홈을 다시 읽어 표에 새 일정이 보인다', async () => {
    mockedGet.mockResolvedValueOnce(dashboard());
    // 저장 뒤 다시 읽은 응답: 가상볼트에 12/2 일정이 잡혔다.
    mockedGet.mockResolvedValueOnce(
      dashboard({
        progressCompanies: {
          IN_CONTACT: [
            company({
              oppId: 'opp-s',
              customerName: '가상볼트',
              nextScheduleAt: '2026-12-02',
              nextScheduleNote: '전화 · 샘플 결과',
            }),
            company({
              oppId: 'opp-p',
              customerName: '가상시플',
              nextScheduleAt: '2026-11-18',
              nextScheduleNote: '방문',
            }),
          ],
        },
      }),
    );
    mockedDetail.mockResolvedValueOnce(detailOf('IN_PROGRESS'));
    mockedPost.mockResolvedValueOnce(savedReply());
    renderPage(PARK);
    await screen.findByTestId('dashboard-progress-table');
    expect(within(rowOf('가상볼트')).getByTestId('dashboard-progress-next-text')).toHaveTextContent(
      /^일정 없음$/,
    );
    expect(scheduleButton('가상볼트')).toHaveTextContent(/^일정 잡기$/);
    expect(scheduleButton('가상시플')).toHaveTextContent(/^바꾸기$/);

    await userEvent.click(scheduleButton('가상볼트'));
    const editor = within(rowOf('가상볼트')).getByTestId('schedule-quick-edit');
    fireEvent.change(within(editor).getByTestId('schedule-quick-date'), {
      target: { value: '2026-12-02' },
    });
    await userEvent.selectOptions(within(editor).getByTestId('schedule-quick-kind'), '전화');
    await userEvent.type(within(editor).getByTestId('schedule-quick-note'), ' · 샘플 결과');
    await userEvent.click(within(editor).getByTestId('schedule-quick-save'));

    // 다시 읽은 표에 새 일정이 보이고, 일정 잡기 칸은 닫혀 있다.
    await waitFor(() =>
      expect(
        within(rowOf('가상볼트')).getByTestId('dashboard-progress-next-text'),
      ).toHaveTextContent(/^12\/2 전화 · 샘플 결과$/),
    );
    expect(scheduleButton('가상볼트')).toHaveTextContent(/^바꾸기$/);
    expect(screen.queryByTestId('schedule-quick-edit')).not.toBeInTheDocument();
    // 상세 읽기 한 번, 저장 한 번(기업 상세의 [일정 잡기]와 같은 본문).
    expect(mockedDetail).toHaveBeenCalledTimes(1);
    expect(mockedDetail).toHaveBeenCalledWith('opp-s');
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      'opp-s',
      {
        evalId: 'eval-3',
        status: 'IN_PROGRESS',
        nextScheduleAt: '2026-12-02',
        nextScheduleNote: '전화 · 샘플 결과',
      },
      'park-lee',
    );
    // 영업 홈은 저장 뒤 한 번만 다시 읽고(처음 1 + 다시 1), 창에 일정이 바뀌었다고 한 번 알린다(왼쪽 달력 · 메뉴 숫자용).
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['opp-s']);
  });

  it('Given 지난 일정이 남은 회사 When [바꾸기] → 새 날짜 → [저장] Then 지금 내용은 그대로 두고 날짜만 바꿔 보낸다', async () => {
    mockedGet.mockResolvedValue(dashboard());
    mockedDetail.mockResolvedValueOnce(detailOf('IN_PROGRESS'));
    mockedPost.mockResolvedValueOnce(savedReply());
    renderPage(PARK);
    await screen.findByTestId('dashboard-progress-table');
    await userEvent.click(scheduleButton('가상시플'));
    const editor = within(rowOf('가상시플')).getByTestId('schedule-quick-edit');
    expect(within(editor).getByTestId('schedule-quick-current')).toHaveTextContent(
      '지금 일정: 11/18 방문 (지남) → 저장하면 이 일정으로 바뀌고 달력에도 바로 보입니다',
    );
    fireEvent.change(within(editor).getByTestId('schedule-quick-date'), {
      target: { value: '2026-12-05' },
    });
    await userEvent.click(within(editor).getByTestId('schedule-quick-save'));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(
      'opp-p',
      {
        evalId: 'eval-3',
        status: 'IN_PROGRESS',
        nextScheduleAt: '2026-12-05',
        nextScheduleNote: '방문',
      },
      'park-lee',
    );
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });

  it('Given 저장이 실패 When [저장] Then 그 줄에 이유를 알리고 입력을 그대로 두며, 영업 홈을 다시 읽지 않고 일정이 바뀌었다고 알리지도 않는다', async () => {
    mockedGet.mockResolvedValue(dashboard());
    mockedDetail.mockResolvedValueOnce(detailOf('IN_PROGRESS'));
    mockedPost.mockRejectedValueOnce(
      new ApiError(500, {
        message: '저장하는 중 문제가 생겼습니다.',
        nextAction: '잠시 뒤 다시 시도해 주세요.',
        ref: 'r-5',
        kind: 'INTERNAL_ERROR',
      }),
    );
    renderPage(PARK);
    await screen.findByTestId('dashboard-progress-table');
    await userEvent.click(scheduleButton('가상볼트'));
    const editor = within(rowOf('가상볼트')).getByTestId('schedule-quick-edit');
    fireEvent.change(within(editor).getByTestId('schedule-quick-date'), {
      target: { value: '2026-12-02' },
    });
    await userEvent.click(within(editor).getByTestId('schedule-quick-save'));
    expect(await within(editor).findByTestId('schedule-quick-error')).toHaveTextContent(
      /^저장하지 못했습니다\. 다시 시도 \(저장하는 중 문제가 생겼습니다\.\)$/,
    );
    // 칸은 그대로 펴져 있고 입력도 그대로다.
    expect(within(editor).getByTestId('schedule-quick-date')).toHaveValue('2026-12-02');
    expect(within(rowOf('가상볼트')).getByTestId('dashboard-progress-next-text')).toHaveTextContent(
      /^일정 없음$/,
    );
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it('Given 그 사이 다른 기록이 저장돼 서버가 막음(409) When [저장] Then 서버 안내를 보이고 [다시 읽기]를 누르면 영업 홈을 다시 읽는다', async () => {
    mockedGet.mockResolvedValue(dashboard());
    mockedDetail.mockResolvedValueOnce(detailOf('IN_PROGRESS'));
    mockedPost.mockRejectedValueOnce(
      new ApiError(409, {
        message: '그 사이 다른 기록이 저장됐습니다.',
        nextAction: '새로 불러온 뒤 다시 저장해 주세요.',
        ref: 'r-6',
        kind: 'STALE_VALUE',
      }),
    );
    renderPage(PARK);
    await screen.findByTestId('dashboard-progress-table');
    await userEvent.click(scheduleButton('가상볼트'));
    const editor = within(rowOf('가상볼트')).getByTestId('schedule-quick-edit');
    fireEvent.change(within(editor).getByTestId('schedule-quick-date'), {
      target: { value: '2026-12-02' },
    });
    await userEvent.click(within(editor).getByTestId('schedule-quick-save'));
    const alert = await within(editor).findByTestId('schedule-quick-error');
    expect(alert).toHaveTextContent(
      '그 사이 다른 기록이 저장됐습니다. 새로 불러온 뒤 다시 저장해 주세요.',
    );
    expect(alert).not.toHaveTextContent('STALE_VALUE');
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    await userEvent.click(within(alert).getByTestId('schedule-quick-reload'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    // 다시 읽은 표가 보인다(저장은 다시 보내지 않았다).
    expect(await screen.findByTestId('dashboard-progress-table')).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['보기 전용', { staffKey: 'viewer', canRecord: false }],
    ['담당자 미선택', { staffKey: null, canRecord: false }],
  ])(
    'Given %s When 영업 홈 Then 일정 단추가 눌리지 않고 "먼저 담당자를 고르세요"가 보인다',
    async (_name, frame) => {
      mockedGet.mockResolvedValue(dashboard());
      renderPage(frame);
      await screen.findByTestId('dashboard-progress-table');
      expect(screen.getByTestId('dashboard-progress-pick-staff')).toHaveTextContent(
        /^먼저 담당자를 고르세요$/,
      );
      for (const name of ['가상볼트', '가상시플']) {
        expect(scheduleButton(name)).toBeDisabled();
        await userEvent.click(scheduleButton(name));
      }
      expect(screen.queryByTestId('schedule-quick-edit')).not.toBeInTheDocument();
      expect(mockedDetail).not.toHaveBeenCalled();
      expect(mockedPost).not.toHaveBeenCalled();
    },
  );
});

describe('영업 홈 + 공통 틀: 왼쪽 메뉴 달력이 영업 홈이 읽은 일정을 같이 쓴다 (#983)', () => {
  const STAFF = [
    { key: 'park-lee', displayName: '영업 담당' },
    { key: 'viewer', displayName: '보기 전용' },
  ];

  function renderApp() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <AppFrame title="영업 홈" ownHeading>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
          </Routes>
        </AppFrame>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    window.localStorage.setItem(STAFF_STORAGE_KEY, 'park-lee');
    vi.mocked(getConfigUi).mockReset();
    vi.mocked(getConfigUi).mockResolvedValue({
      data: { ...configFixture.data, staff: STAFF },
      meta: {},
    } as unknown as Awaited<ReturnType<typeof getConfigUi>>);
  });

  it('Given 넓은 화면 When 영업 홈을 연다 Then 집계 요청은 한 번만 나가고, 그 일정이 왼쪽 메뉴 달력에 보이며 본문에는 달력이 없다', async () => {
    mockedGet.mockResolvedValue(dashboard());
    renderApp();
    const side = await screen.findByTestId('side-calendar');
    const day = await within(side).findByTestId('dashboard-calendar-day-2026-11-18');
    expect(day).toHaveAttribute('aria-label', '11월 18일, 일정 1건, 지난 일정 있음');
    expect(screen.getByRole('navigation')).toContainElement(side);
    expect(screen.getByRole('main')).not.toContainElement(side);
    expect(within(screen.getByRole('main')).queryByTestId('dashboard-calendar')).toBeNull();
    // 담당자 설정을 읽기 전 한 번(키 없음) + 읽은 뒤 한 번(영업 담당): 달력 때문에 늘어난 요청은 없다.
    await waitFor(() => expect(mockedGet.mock.calls.at(-1)?.[1]).toBe('park-lee'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const keys = mockedGet.mock.calls.map((call) => call[1] ?? null);
    expect(keys.filter((key) => key === 'park-lee')).toHaveLength(1);
    expect(keys.filter((key) => key === null).length).toBeLessThanOrEqual(1);
  });

  it('Given 표에서 일정을 저장 When 영업 홈이 다시 읽는다 Then 왼쪽 달력에도 새 일정 날짜가 칸 색으로 보인다(달력이 따로 요청을 보내지 않는다)', async () => {
    mockedGet.mockResolvedValueOnce(dashboard());
    mockedGet.mockResolvedValueOnce(dashboard());
    mockedGet.mockResolvedValueOnce(
      dashboard({
        schedule: [
          {
            oppId: 'opp-s',
            customerName: '가상볼트',
            oppTitle: '가상 건',
            dueAt: '2026-11-30',
            note: '전화',
            overdue: false,
            staffKey: 'park-lee',
          },
        ],
      }),
    );
    mockedDetail.mockResolvedValueOnce(detailOf(null));
    mockedPost.mockResolvedValueOnce(savedReply());
    renderApp();
    const side = await screen.findByTestId('side-calendar');
    await waitFor(() => expect(mockedGet.mock.calls.at(-1)?.[1]).toBe('park-lee'));
    await within(side).findByTestId('dashboard-calendar-day-2026-11-30');
    expect(within(side).getByTestId('dashboard-calendar-day-2026-11-30')).toHaveAttribute(
      'aria-label',
      '11월 30일, 일정 없음',
    );
    const before = mockedGet.mock.calls.length;
    await userEvent.click(await screen.findByRole('button', { name: '가상볼트 일정 잡기' }));
    const editor = screen.getByTestId('schedule-quick-edit');
    fireEvent.change(within(editor).getByTestId('schedule-quick-date'), {
      target: { value: '2026-11-30' },
    });
    await userEvent.selectOptions(within(editor).getByTestId('schedule-quick-kind'), '전화');
    await userEvent.click(within(editor).getByTestId('schedule-quick-save'));
    await waitFor(() =>
      expect(within(side).getByTestId('dashboard-calendar-day-2026-11-30')).toHaveAttribute(
        'aria-label',
        '11월 30일, 일정 1건',
      ),
    );
    // 영업 기록이 없던 회사라 단계는 NOT_EXECUTED로 보낸다.
    expect(mockedPost).toHaveBeenCalledWith(
      'opp-s',
      {
        evalId: 'eval-3',
        status: 'NOT_EXECUTED',
        nextScheduleAt: '2026-11-30',
        nextScheduleNote: '전화',
      },
      'park-lee',
    );
    // 저장 뒤 집계 요청은 영업 홈의 다시 읽기 한 번뿐이다.
    expect(mockedGet.mock.calls.length - before).toBe(1);
  }, 30_000);
});
