// 활동 타임라인: 최근 순, 시각·작성자·종류·내용, 빈 상태, 오류와 다시 불러오기, 저장 뒤 새로 불러오기.
// 서버 호출(getActivity)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ActivityTimeline, { sortRecentFirst } from '../ActivityTimeline';
import { ApiError, getActivity } from '../../../api/client';
import type { ActivityItem, ConfigUi, Envelope } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { timelineArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getActivity: vi.fn(),
}));

const mockedGet = vi.mocked(getActivity);

const older: ActivityItem = {
  at: '2026-11-05T09:00:00+09:00',
  actor: 'system',
  kind: 'CLASSIFICATION',
  summary: '분류가 바뀜',
};
const newer: ActivityItem = {
  at: '2026-11-06T14:20:00+09:00',
  actor: 'park-lee',
  kind: 'CONTACT_ATTEMPT',
  summary: "전화 · 부재 '담당자 외근'",
};
const note: ActivityItem = {
  at: '2026-11-06T10:00:00+09:00',
  actor: 'unknown-key',
  kind: 'NOTE',
  summary: '공정 문의 메모',
};

const config = { staff: [{ key: 'park-lee', displayName: '박 이사' }] } as unknown as ConfigUi;

function reply(data: ActivityItem[]): Envelope<ActivityItem[]> {
  return { data, meta: { updatedAt: '2026-11-06T14:30:00+09:00' } };
}

function renderTimeline(refreshKey = 0) {
  const tree = (key: number) => (
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
      <ActivityTimeline oppId="opp-1" refreshKey={key} />
    </FrameContext.Provider>
  );
  const view = render(tree(refreshKey));
  return { rerender: (key: number) => view.rerender(tree(key)) };
}

describe('ActivityTimeline', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('서버 순서와 상관없이 최근 것이 위에 오도록 정렬한다', () => {
    expect(sortRecentFirst([older, newer, note]).map((item) => item.summary)).toEqual([
      newer.summary,
      note.summary,
      older.summary,
    ]);
  });

  it('같은 시각이면 늦게 쌓인 줄이 위로 온다', () => {
    const a = { ...older, summary: 'a' };
    const b = { ...older, summary: 'b' };
    expect(sortRecentFirst([a, b]).map((item) => item.summary)).toEqual(['b', 'a']);
  });

  it('줄마다 시각·작성자·종류·내용이 보이고 담당자 이름과 시스템이 쉬운 말로 바뀐다', async () => {
    mockedGet.mockResolvedValueOnce(reply([older, newer, note]));
    renderTimeline();
    const rows = await screen.findAllByTestId('timeline-item');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByTestId('timeline-time')).toHaveTextContent('11/06 14:20');
    expect(within(rows[0]).getByTestId('timeline-actor')).toHaveTextContent('박 이사');
    expect(within(rows[0]).getByTestId('timeline-kind')).toHaveTextContent('접촉 시도');
    expect(within(rows[0]).getByTestId('timeline-summary')).toHaveTextContent(newer.summary);
    // 설정에 없는 키는 키 그대로, system은 "시스템".
    expect(within(rows[1]).getByTestId('timeline-actor')).toHaveTextContent('unknown-key');
    expect(within(rows[1]).getByTestId('timeline-kind')).toHaveTextContent('메모');
    expect(within(rows[2]).getByTestId('timeline-actor')).toHaveTextContent(timelineArea.system);
    expect(mockedGet).toHaveBeenCalledWith('opp-1', 50, expect.any(AbortSignal));
  });

  it('기록이 하나도 없으면 안내 문구를 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([]));
    renderTimeline();
    expect(await screen.findByTestId('timeline-empty')).toHaveTextContent(timelineArea.empty);
    expect(screen.queryByTestId('timeline-item')).not.toBeInTheDocument();
  });

  it('불러오지 못하면 쉬운 말 오류와 [다시 불러오기]가 보이고 누르면 다시 불러온다', async () => {
    mockedGet.mockRejectedValueOnce(
      new ApiError(500, { message: '서버 오류', nextAction: '잠시 뒤', ref: 'r-1' }),
    );
    mockedGet.mockResolvedValueOnce(reply([newer]));
    renderTimeline();
    const alert = await screen.findByTestId('timeline-error');
    expect(alert).toHaveTextContent(timelineArea.loadFailed);
    expect(alert).not.toHaveTextContent('500');
    fireEvent.click(screen.getByRole('button', { name: timelineArea.retry }));
    expect(await screen.findByTestId('timeline-item')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-error')).not.toBeInTheDocument();
  });

  it('새로 불러오기 값이 바뀌면 다시 불러오고 새 줄이 위에 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([older]));
    mockedGet.mockResolvedValueOnce(reply([older, newer]));
    const { rerender } = renderTimeline(0);
    expect(await screen.findAllByTestId('timeline-item')).toHaveLength(1);
    rerender(1);
    await waitFor(() => expect(screen.getAllByTestId('timeline-item')).toHaveLength(2));
    expect(screen.getAllByTestId('timeline-summary')[0]).toHaveTextContent(newer.summary);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
