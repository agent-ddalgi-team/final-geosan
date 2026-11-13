// 활동 타임라인: 최근 순, 시각·작성자·종류·내용, 빈 상태, 오류와 다시 불러오기, 저장 뒤 새로 불러오기.
// 서버 호출(getActivity)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ActivityTimeline, { sortRecentFirst, summaryText } from '../ActivityTimeline';
import { ApiError, getActivity, postRecordCancel } from '../../../api/client';
import type { ActivityItem, ConfigUi, Envelope } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { activityGroupLabels, timelineArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getActivity: vi.fn(),
  postRecordCancel: vi.fn(),
}));

const mockedGet = vi.mocked(getActivity);
const mockedCancel = vi.mocked(postRecordCancel);

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

const relation: ActivityItem = {
  at: '2026-11-06T11:00:00+09:00',
  actor: 'park-lee',
  kind: 'RELATION_CONFIRMED',
  summary: '거래 관계: 확인 전 → 거래 없음',
  previousValue: 'UNCONFIRMED',
};
const opinion: ActivityItem = {
  at: '2026-11-06T12:00:00+09:00',
  actor: 'park-lee',
  kind: 'OPINION',
  summary: '영업 대상',
  evalId: 'eval-1',
};

const config = { staff: [{ key: 'park-lee', displayName: '박 이사' }] } as unknown as ConfigUi;

function reply(data: ActivityItem[]): Envelope<ActivityItem[]> {
  return { data, meta: { updatedAt: '2026-11-06T14:30:00+09:00' } };
}

interface RenderOptions {
  staffKey?: string | null;
  canRecord?: boolean;
  config?: ConfigUi;
  onCancelled?: () => void;
}

function renderTimeline(refreshKey = 0, options: RenderOptions = {}) {
  const tree = (key: number) => (
    <FrameContext.Provider
      value={{
        config: options.config ?? config,
        staffKey: options.staffKey === undefined ? 'park-lee' : options.staffKey,
        setStaffKey: () => {},
        canRecord: options.canRecord ?? true,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <ActivityTimeline oppId="opp-1" refreshKey={key} onCancelled={options.onCancelled} />
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

  it('검토 의견 줄은 서버가 준 코드("NEED_CHECK")를 쉬운 말로 보이고, 대응표에 없는 글은 그대로 둔다 (#691)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        { ...opinion, at: '2026-11-06T13:00:00+09:00', summary: 'NEED_CHECK' },
        { ...opinion, at: '2026-11-06T12:30:00+09:00', summary: 'NOT_TARGET' },
        opinion,
        // 메모에 같은 글자가 있어도 메모는 바꾸지 않는다.
        { ...note, summary: 'NEED_CHECK' },
      ]),
    );
    renderTimeline();
    const rows = await screen.findAllByTestId('timeline-item');
    const texts = rows.map((row) => within(row).getByTestId('timeline-summary').textContent);
    expect(texts).toEqual(['검토 중', '제외', '영업 대상', 'NEED_CHECK']);
    expect(summaryText({ ...opinion, summary: 'WORTH_REVIEW' })).toBe('영업 대상');
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

  it('종류 태그는 묶음별로 색이 다르다: 영업 활동 회색, 사실 파랑, 의견 노랑', async () => {
    mockedGet.mockResolvedValueOnce(reply([newer, relation, opinion, older, note]));
    renderTimeline();
    const kinds = await screen.findAllByTestId('timeline-kind');
    const toneOf = (label: string) =>
      kinds.find((el) => el.textContent === label)?.getAttribute('data-tone');
    expect(toneOf('접촉 시도')).toBe('neutral');
    expect(toneOf('메모')).toBe('neutral');
    expect(toneOf('거래 관계')).toBe('ask');
    expect(toneOf('의견')).toBe('wait');
    expect(toneOf('분류')).toBe('wait');
  });

  it('묶음 단추로 한 묶음만 보고 전체로 돌아온다. 기본은 전체', async () => {
    mockedGet.mockResolvedValueOnce(reply([newer, relation, opinion, older, note]));
    renderTimeline();
    expect(await screen.findAllByTestId('timeline-item')).toHaveLength(5);
    expect(screen.getByTestId('timeline-group-ALL')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: activityGroupLabels.FACT }));
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(1);
    expect(screen.getByTestId('timeline-summary')).toHaveTextContent(relation.summary);

    fireEvent.click(screen.getByRole('button', { name: activityGroupLabels.SALES }));
    expect(screen.getAllByTestId('timeline-summary').map((el) => el.textContent)).toEqual([
      newer.summary,
      note.summary,
    ]);

    fireEvent.click(screen.getByRole('button', { name: activityGroupLabels.FEEDBACK }));
    expect(screen.getAllByTestId('timeline-summary').map((el) => el.textContent)).toEqual([
      opinion.summary,
      older.summary,
    ]);

    fireEvent.click(screen.getByRole('button', { name: timelineArea.groupAll }));
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(5);
    expect(mockedGet).toHaveBeenCalledTimes(1); // 거르기는 화면에서만, 다시 불러오지 않는다
  });

  it('고른 묶음에 줄이 없으면 안내 한 줄을 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([newer]));
    renderTimeline();
    await screen.findByTestId('timeline-item');
    fireEvent.click(screen.getByRole('button', { name: activityGroupLabels.FEEDBACK }));
    expect(screen.queryByTestId('timeline-item')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-group-empty')).toHaveTextContent(
      timelineArea.groupEmpty(activityGroupLabels.FEEDBACK),
    );
  });

  it('기록이 전혀 없으면 묶음 단추도 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply([]));
    renderTimeline();
    await screen.findByTestId('timeline-empty');
    expect(screen.queryByTestId('timeline-group-filter')).not.toBeInTheDocument();
  });
});

// ---------- 기록 취소 [잘못 입력] (#254). 서버 호출(postRecordCancel)은 가짜로 바꾼 확인이다. ----------

const myNote: ActivityItem = {
  at: '2026-11-06T10:00:00+09:00',
  actor: 'park-lee',
  kind: 'NOTE',
  summary: '다른 회사에 적은 메모',
  recordId: 'note-1',
  recordKind: 'NOTE',
  cancelled: false,
};
const myOutcome: ActivityItem = {
  at: '2026-11-06T11:00:00+09:00',
  actor: 'park-lee',
  kind: 'OUTCOME',
  summary: '영업 단계: 접촉 중',
  recordId: 'outcome-1',
  recordKind: 'OUTCOME',
  cancelled: false,
};
const othersNote: ActivityItem = {
  at: '2026-11-06T12:00:00+09:00',
  actor: 'kim-gwajang',
  kind: 'NOTE',
  summary: '김 과장 메모',
  recordId: 'note-2',
  recordKind: 'NOTE',
  cancelled: false,
};
const cancelledNote: ActivityItem = {
  at: '2026-11-05T10:00:00+09:00',
  actor: 'park-lee',
  kind: 'NOTE',
  summary: '(취소된 메모)',
  recordId: 'note-0',
  recordKind: 'NOTE',
  cancelled: true,
  cancelledBy: 'park-lee',
  cancelledAt: '2026-11-06T15:00:00+09:00',
};
const cancelLine: ActivityItem = {
  at: '2026-11-06T15:00:00+09:00',
  actor: 'park-lee',
  kind: 'RECORD_CANCELLED',
  summary: '취소 · 박 이사 · 11/06',
  recordId: null,
};

const cancelConfig = {
  staff: [
    { key: 'park-lee', displayName: '박 이사' },
    { key: 'kim-gwajang', displayName: '김 과장' },
  ],
  records: { approvalEnabled: false, noteMaxLength: 200, cancelByAnyStaff: true },
} as unknown as ConfigUi;

describe('ActivityTimeline — 기록 취소 [잘못 입력]', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedCancel.mockReset();
  });

  it('내 기록 줄에만 [잘못 입력]이 보이고 남의 기록·시스템 줄·취소 줄에는 없다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([older, myNote, myOutcome, othersNote, cancelledNote, cancelLine]),
    );
    renderTimeline(0, {
      config: {
        staff: [
          { key: 'park-lee', displayName: '박 이사' },
          { key: 'kim-gwajang', displayName: '김 과장' },
        ],
      } as unknown as ConfigUi,
    });
    await screen.findAllByTestId('timeline-item');
    const buttons = screen.getAllByTestId('timeline-cancel-open');
    expect(buttons.map((el) => el.getAttribute('aria-label'))).toEqual([
      timelineArea.cancelButtonLabel(myOutcome.summary),
      timelineArea.cancelButtonLabel(myNote.summary),
    ]);
  });

  it('설정이 남의 기록 취소를 허용하면 남의 줄에도 단추가 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([myNote, othersNote]));
    renderTimeline(0, { config: cancelConfig });
    await screen.findAllByTestId('timeline-item');
    expect(screen.getAllByTestId('timeline-cancel-open')).toHaveLength(2);
  });

  it('담당자를 고르지 않았거나 기록할 수 없으면 단추가 없다', async () => {
    mockedGet.mockResolvedValue(reply([myNote, myOutcome]));
    renderTimeline(0, { staffKey: null, canRecord: false });
    await screen.findAllByTestId('timeline-item');
    expect(screen.queryByTestId('timeline-cancel-open')).not.toBeInTheDocument();
  });

  it('보기 전용 담당자는 자기 기록이 없으므로 단추가 없다', async () => {
    mockedGet.mockResolvedValue(reply([myNote]));
    renderTimeline(0, { staffKey: 'viewer', canRecord: false });
    await screen.findAllByTestId('timeline-item');
    expect(screen.queryByTestId('timeline-cancel-open')).not.toBeInTheDocument();
  });

  it('[잘못 입력]을 누르면 줄 아래에 확인 한 줄이 열리고(모달 없음) [닫기]로 닫힌다', async () => {
    mockedGet.mockResolvedValueOnce(reply([myNote]));
    renderTimeline();
    await screen.findByTestId('timeline-item');
    fireEvent.click(screen.getByTestId('timeline-cancel-open'));
    const form = screen.getByTestId('timeline-cancel-form');
    expect(form).toHaveTextContent(timelineArea.cancelPrompt);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-cancel-open')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('timeline-cancel-close'));
    expect(screen.queryByTestId('timeline-cancel-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-cancel-open')).toBeInTheDocument();
    expect(mockedCancel).not.toHaveBeenCalled();
  });

  it('[표시]를 누르면 기록 번호와 이유로 취소를 보내고 활동 이력을 다시 불러온다', async () => {
    const onCancelled = vi.fn();
    mockedGet.mockResolvedValueOnce(reply([myNote]));
    mockedGet.mockResolvedValueOnce(
      reply([
        {
          ...myNote,
          cancelled: true,
          cancelledBy: 'park-lee',
          cancelledAt: '2026-11-06T15:00:00+09:00',
          summary: '(취소된 메모)',
        },
        cancelLine,
      ]),
    );
    mockedCancel.mockResolvedValueOnce({
      data: {
        recordId: 'note-1',
        recordKind: 'NOTE',
        cancelledBy: 'park-lee',
        cancelledAt: '2026-11-06T15:00:00+09:00',
      },
      meta: { updatedAt: '2026-11-06T15:00:00+09:00' },
    });
    renderTimeline(0, { onCancelled });
    await screen.findByTestId('timeline-item');
    fireEvent.click(screen.getByTestId('timeline-cancel-open'));
    fireEvent.change(screen.getByTestId('timeline-cancel-reason'), {
      target: { value: '다른 회사에 적음' },
    });
    fireEvent.click(screen.getByTestId('timeline-cancel-confirm'));

    await waitFor(() => expect(mockedCancel).toHaveBeenCalledTimes(1));
    expect(mockedCancel).toHaveBeenCalledWith(
      'opp-1',
      'note-1',
      { reason: '다른 회사에 적음' },
      'park-lee',
    );
    expect(onCancelled).toHaveBeenCalledTimes(1);
    // 저장 뒤 활동 이력을 새로 불러와 줄 긋기와 취소 줄이 보인다.
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId('timeline-item')).toHaveLength(2));
    expect(screen.queryByTestId('timeline-cancel-form')).not.toBeInTheDocument();
  });

  it('이유를 비워 두면 이유 없이 보낸다', async () => {
    mockedGet.mockResolvedValue(reply([myOutcome]));
    mockedCancel.mockResolvedValueOnce({
      data: {
        recordId: 'outcome-1',
        recordKind: 'OUTCOME',
        cancelledBy: 'park-lee',
        cancelledAt: '2026-11-06T15:00:00+09:00',
      },
      meta: { updatedAt: '2026-11-06T15:00:00+09:00' },
    });
    renderTimeline();
    await screen.findByTestId('timeline-item');
    fireEvent.click(screen.getByTestId('timeline-cancel-open'));
    fireEvent.click(screen.getByTestId('timeline-cancel-confirm'));
    await waitFor(() => expect(mockedCancel).toHaveBeenCalledTimes(1));
    expect(mockedCancel).toHaveBeenCalledWith('opp-1', 'outcome-1', {}, 'park-lee');
  });

  it('취소된 줄은 줄이 그어지고 "취소 · 박 이사 · 11/06"이 붙고 단추는 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply([cancelledNote, cancelLine]));
    renderTimeline();
    const rows = await screen.findAllByTestId('timeline-item');
    // 최근 순: 취소 줄(15:00)이 위, 취소된 메모가 아래.
    expect(within(rows[0]).getByTestId('timeline-kind')).toHaveTextContent('기록 취소');
    expect(within(rows[0]).getByTestId('timeline-summary')).toHaveTextContent(cancelLine.summary);
    expect(within(rows[0]).getByTestId('timeline-summary')).not.toHaveStyle({
      textDecoration: 'line-through',
    });
    expect(rows[1]).toHaveAttribute('data-cancelled', 'true');
    expect(within(rows[1]).getByTestId('timeline-summary')).toHaveTextContent('(취소된 메모)');
    expect(within(rows[1]).getByTestId('timeline-summary')).toHaveStyle({
      textDecoration: 'line-through',
    });
    expect(within(rows[1]).getByTestId('timeline-cancelled-note')).toHaveTextContent(
      '취소 · 박 이사 · 11/06',
    );
    expect(screen.queryByTestId('timeline-cancel-open')).not.toBeInTheDocument();
  });

  it('남의 기록이라 서버가 403을 주면 서버 문구를 줄 아래에 보이고 확인 한 줄은 열려 있다', async () => {
    mockedGet.mockResolvedValueOnce(reply([othersNote]));
    mockedCancel.mockRejectedValueOnce(
      new ApiError(403, {
        message: '다른 담당자의 기록은 표시할 수 없습니다',
        nextAction: '본인 기록만 표시할 수 있습니다',
        ref: 'r-403',
      }),
    );
    renderTimeline(0, { config: cancelConfig });
    await screen.findByTestId('timeline-item');
    fireEvent.click(screen.getByTestId('timeline-cancel-open'));
    fireEvent.click(screen.getByTestId('timeline-cancel-confirm'));
    const alert = await screen.findByTestId('timeline-cancel-error');
    expect(alert).toHaveTextContent(timelineArea.cancelFailed);
    expect(alert).toHaveTextContent('다른 담당자의 기록은 표시할 수 없습니다');
    expect(screen.getByTestId('timeline-cancel-form')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(1); // 실패하면 다시 불러오지 않는다
  });

  it('이미 취소된 기록이면(409) 서버 문구를 보이고 단계·횟수를 되돌리라고 알리지 않는다', async () => {
    const onCancelled = vi.fn();
    mockedGet.mockResolvedValueOnce(reply([myNote]));
    mockedCancel.mockRejectedValueOnce(
      new ApiError(409, {
        message: '이미 잘못 입력으로 표시된 기록입니다',
        nextAction: '활동 이력을 새로 불러오세요',
        ref: 'r-409',
      }),
    );
    renderTimeline(0, { onCancelled });
    await screen.findByTestId('timeline-item');
    fireEvent.click(screen.getByTestId('timeline-cancel-open'));
    fireEvent.click(screen.getByTestId('timeline-cancel-confirm'));
    expect(await screen.findByTestId('timeline-cancel-error')).toHaveTextContent(
      '이미 잘못 입력으로 표시된 기록입니다',
    );
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('이유 칸은 200자까지만 받는다', async () => {
    mockedGet.mockResolvedValueOnce(reply([myNote]));
    renderTimeline();
    await screen.findByTestId('timeline-item');
    fireEvent.click(screen.getByTestId('timeline-cancel-open'));
    expect(screen.getByTestId('timeline-cancel-reason')).toHaveAttribute('maxlength', '200');
  });
});
