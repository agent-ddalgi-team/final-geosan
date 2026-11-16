// #770 왼쪽 메뉴 숫자 훅. 요청 함수는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SCHEDULE_CHANGED_EVENT } from '../../../api/assistant';
import { getMenuBadges, MENU_SEEN_STORAGE_PREFIX, readMenuSeen } from '../../../api/menuBadges';
import type { ConfigUi } from '../../../api/types';
import { FrameContext } from '../FrameContext';
import { useMenuBadges } from '../useMenuBadges';

vi.mock('../../../api/menuBadges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/menuBadges')>()),
  getMenuBadges: vi.fn(),
}));

const mockedGet = vi.mocked(getMenuBadges);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FrameContext.Provider
      value={{
        config: {} as ConfigUi,
        staffKey: 'park-lee',
        canRecord: true,
        setStaffKey: () => {},
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      {children}
    </FrameContext.Provider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockedGet.mockReset();
  mockedGet.mockResolvedValue({ data: { dashboard: 3, list: 12, bookmarks: 2 }, meta: {} });
});

describe('useMenuBadges (#770)', () => {
  it('처음 쓰는 브라우저는 지금부터 센다(두 시각을 지금으로 기억하고 보낸다)', async () => {
    const { result } = renderHook(() => useMenuBadges('/'), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ dashboard: 3, list: 12, bookmarks: 2 }));
    const seen = readMenuSeen('park-lee');
    expect(seen.list).not.toBeNull();
    expect(seen.bookmarks).not.toBeNull();
    expect(mockedGet).toHaveBeenCalledWith(seen, 'park-lee', expect.any(AbortSignal));
  });

  it('신규 거래처 찾기를 열면 그 시각만 지금으로 바꾸고, 관심 기업 시각은 그대로 둔다', async () => {
    window.localStorage.setItem(
      `${MENU_SEEN_STORAGE_PREFIX}park-lee`,
      JSON.stringify({ list: '2026-11-01T00:00:00.000Z', bookmarks: '2026-11-02T00:00:00.000Z' }),
    );
    renderHook(() => useMenuBadges('/opportunities'), { wrapper });
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    const seen = readMenuSeen('park-lee');
    expect(seen.bookmarks).toBe('2026-11-02T00:00:00.000Z');
    expect(seen.list).not.toBe('2026-11-01T00:00:00.000Z');
  });

  it('영업 코치 [넣기]로 일정이 바뀌면 숫자를 다시 읽는다', async () => {
    renderHook(() => useMenuBadges('/'), { wrapper });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT));
    });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });

  it('숫자를 못 읽으면 숫자를 붙이지 않는다(null)', async () => {
    mockedGet.mockReset();
    mockedGet.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useMenuBadges('/'), { wrapper });
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
