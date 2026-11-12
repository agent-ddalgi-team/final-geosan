// 추천 목록의 [엑셀 내려받기](#217): 단추가 목록을 부른 조건 그대로(쪽 번호 없이) 내려받기를 부른다 /
// 보기 전용도 쓸 수 있다(읽기) / 빈 목록·불러오지 못한 목록에는 단추가 없다.
// 서버 호출(getOpportunities·getListXlsx)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { ApiError, getOpportunities } from '../../api/client';
import { getListXlsx, saveFile } from '../../api/exportXlsx';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));
vi.mock('../../api/exportXlsx', () => ({ getListXlsx: vi.fn(), saveFile: vi.fn() }));

const mockedList = vi.mocked(getOpportunities);
const mockedXlsx = vi.mocked(getListXlsx);
const mockedSave = vi.mocked(saveFile);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;
const FILE = { blob: new Blob(['x']), fileName: '거산_추천목록_20261113.xlsx' };
const TABS = [
  { processCode: 'ZINC_PLATING', processName: '전기아연도금', count: 9 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 10 },
];

function reply(items: OpportunityCard[], meta = {}): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length, ...meta } };
}

function renderPage(initial: string, staffKey: string | null = 'park-lee') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey,
          setStaffKey: () => {},
          canRecord: staffKey !== null && staffKey !== 'viewer',
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <OpportunityListPage />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('OpportunityListPage [엑셀 내려받기] (#217)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedList.mockReset();
    mockedXlsx.mockReset();
    mockedSave.mockReset();
    mockedXlsx.mockResolvedValue(FILE);
  });

  it('공정·지역·정렬로 걸러 본 목록에서 누르면 목록을 부른 조건과 같은 조건으로 내려받는다', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/opportunities?process=ANODIZING&region=%EC%95%84%EC%82%B0%EC%8B%9C&sort=recent');
    await screen.findByTestId('opportunity-card');
    await user.click(screen.getByTestId('list-export-button'));
    await screen.findByTestId('list-export-done');
    const listFilters = mockedList.mock.calls.at(-1)?.[3];
    expect(mockedXlsx).toHaveBeenCalledTimes(1);
    expect(mockedXlsx.mock.calls[0][0]).toEqual(listFilters);
    expect(mockedXlsx.mock.calls[0][0]).toMatchObject({
      process: 'ANODIZING',
      region: '아산시',
      sort: 'recent',
    });
    expect(mockedSave).toHaveBeenCalledWith(FILE);
  });

  it('관심 기업 보기의 검토 의견 거르기와 대시보드 칸 조건도 그대로 보낸다', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true&opinion=NEED_CHECK&filter=SCHEDULE_DUE');
    await screen.findByTestId('opportunity-card');
    await user.click(screen.getByTestId('list-export-button'));
    await waitFor(() => expect(mockedXlsx).toHaveBeenCalledTimes(1));
    expect(mockedXlsx.mock.calls[0][0]).toEqual(mockedList.mock.calls.at(-1)?.[3]);
    expect(mockedXlsx.mock.calls[0][0]).toMatchObject({
      bookmarked: 'true',
      opinion: 'NEED_CHECK',
      filter: 'SCHEDULE_DUE',
    });
  });

  it('검색 결과에서 누르면 검색어만 보낸다', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?q=A%EC%A0%95%EB%B0%80&process=ANODIZING');
    await screen.findByTestId('opportunity-card');
    await user.click(screen.getByTestId('list-export-button'));
    await waitFor(() => expect(mockedXlsx).toHaveBeenCalledTimes(1));
    expect(mockedXlsx.mock.calls[0][0]).toMatchObject({ q: 'A정밀', process: null });
  });

  it('보기 전용·담당자 미선택도 내려받을 수 있다(읽기라 담당자 키가 필요 없다)', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue(reply([apjeong]));
    for (const staffKey of ['viewer', null]) {
      const view = renderPage('/opportunities?stage=IN_PROGRESS', staffKey);
      await screen.findByTestId('opportunity-card');
      expect(screen.getByTestId('list-export-button')).toBeEnabled();
      await user.click(screen.getByTestId('list-export-button'));
      await screen.findByTestId('list-export-done');
      view.unmount();
    }
    expect(mockedXlsx).toHaveBeenCalledTimes(2);
  });

  it('내려받기가 실패하면 목록은 그대로 두고 단추 옆에 안내를 보인다', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue(reply([apjeong]));
    mockedXlsx.mockRejectedValue(
      new ApiError(422, {
        message: '내보낼 수 없는 항목이 있어 엑셀 파일을 만들지 않았습니다.',
        nextAction: '아래 번호와 함께 운영자에게 알려 주세요.',
        ref: 'abc12345',
        kind: 'EXPORT_REJECTED',
      }),
    );
    renderPage('/opportunities?stage=IN_PROGRESS');
    await screen.findByTestId('opportunity-card');
    await user.click(screen.getByTestId('list-export-button'));
    expect(await screen.findByTestId('list-export-error')).toHaveTextContent(
      '내보낼 수 없는 항목이 있어 엑셀 파일을 만들지 않았습니다.',
    );
    expect(screen.getByTestId('opportunity-card')).toBeInTheDocument();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('빈 목록과 불러오지 못한 목록에는 단추가 없다', async () => {
    mockedList.mockResolvedValue(reply([]));
    const empty = renderPage('/opportunities?stage=IN_PROGRESS');
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument());
    expect(screen.queryByTestId('list-export-button')).not.toBeInTheDocument();
    empty.unmount();
    mockedList.mockRejectedValue(new Error('down'));
    renderPage('/opportunities?stage=IN_PROGRESS');
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('list-export-button')).not.toBeInTheDocument();
  });
});
