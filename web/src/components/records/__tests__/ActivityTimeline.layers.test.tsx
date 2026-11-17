// #849 활동 이력 3층(흐름 줄 · 접촉 카드 · AI 피드백). 서버 호출(getActivity)은 가짜로 바꾼 확인이며
// 실제 서버 연결 확인이 아니다. 서버가 영업 기록 줄에 단계·방법·결과를, 메모 줄에 저장 종류를 따로 실어 준다.
import { fireEvent, render, screen, within } from '@testing-library/react';
import ActivityTimeline, { dateLabel, summaryText } from '../ActivityTimeline';
import { flowChanges } from '../activityLayers';
import { getActivity, postRecordCancel } from '../../../api/client';
import type { ActivityItem, ConfigUi, Envelope } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { timelineArea, timelineLayers } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getActivity: vi.fn(),
  postRecordCancel: vi.fn(),
}));

const mockedGet = vi.mocked(getActivity);
const mockedCancel = vi.mocked(postRecordCancel);
const config = { staff: [{ key: 'park-lee', displayName: '박 이사' }] } as unknown as ConfigUi;

function contact(at: string, extra: Partial<ActivityItem> = {}): ActivityItem {
  return {
    at,
    actor: 'park-lee',
    kind: 'CONTACT_ATTEMPT',
    summary: `접촉 · ${at.slice(0, 10)} 전화 연결됨`,
    recordId: `outcome-${at}`,
    recordKind: 'OUTCOME',
    cancelled: false,
    status: 'IN_PROGRESS',
    method: 'CALL',
    result: 'REACHED',
    attemptedAt: at.slice(0, 10),
    nextScheduleAt: null,
    nextScheduleNote: null,
    lostReasonCode: null,
    firstMover: null,
    memo: null,
    ...extra,
  };
}

function advice(at: string, text: string, noteKind = 'ADVICE'): ActivityItem {
  const prefix = noteKind === 'CALL_PREP' ? '다음 통화 준비' : '남긴 피드백';
  return {
    at,
    actor: 'park-lee',
    kind: 'ADVICE',
    summary: `${prefix} · ${text.split('\n').join(' · ')}`,
    recordId: `note-${at}-${noteKind}`,
    recordKind: 'NOTE',
    cancelled: false,
    noteKind,
    text,
  };
}

function reply(data: ActivityItem[]): Envelope<ActivityItem[]> {
  return { data, meta: { updatedAt: '2026-11-17T14:30:00+09:00' } };
}

function renderTimeline() {
  render(
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
      <ActivityTimeline oppId="opp-1" />
    </FrameContext.Provider>,
  );
}

const first = contact('2026-11-10T10:00:00+09:00', { memo: '담당 부서 연결(가상)' });
const same = contact('2026-11-12T10:00:00+09:00', {
  firstMover: '상대가',
  memo: '샘플 이야기(가상)',
});
const moved = contact('2026-11-14T10:00:00+09:00', {
  status: 'SAMPLE_OR_REGISTRATION_APPROVED',
  method: 'VISIT',
  nextScheduleAt: '2026-11-18',
  nextScheduleNote: '방문',
});

describe('활동 이력 3층(#849)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedCancel.mockReset();
  });

  it('Given 같은 단계 접촉 두 번과 단계가 바뀐 접촉 When 보면 Then 흐름 줄은 단계가 바뀐 때만 보이고 접촉은 모두 카드다', async () => {
    mockedGet.mockResolvedValueOnce(reply([first, same, moved]));
    renderTimeline();
    const cards = await screen.findAllByTestId('timeline-card');
    expect(cards).toHaveLength(3);
    const flows = screen.getAllByTestId('timeline-flow').map((el) => el.textContent);
    expect(flows).toEqual(['📈접촉 → 견적·샘플 · 다음 일정 11/18 방문', '📈미접촉 → 접촉']);
    // 카드 제목은 "무슨 일", 본문은 그때 쓴 메모, 속성은 칩.
    const titles = screen.getAllByTestId('timeline-card-title').map((el) => el.textContent);
    expect(titles).toEqual(['방문 연결됨', '전화 연결됨', '전화 연결됨']);
    expect(within(cards[1]).getByTestId('timeline-card-memo')).toHaveTextContent(
      '샘플 이야기(가상)',
    );
    expect(within(cards[1]).getByTestId('timeline-chip')).toHaveTextContent('상대가 먼저');
  });

  it('Given 흐름만 고름 When 보면 Then 단계가 바뀐 줄만 흐름 줄로 보이고 카드는 숨는다', async () => {
    mockedGet.mockResolvedValueOnce(reply([first, same, moved]));
    renderTimeline();
    await screen.findAllByTestId('timeline-card');
    fireEvent.click(screen.getByRole('button', { name: timelineLayers.filters.FLOW }));
    expect(screen.getAllByTestId('timeline-flow')).toHaveLength(2);
    expect(screen.queryByTestId('timeline-card')).not.toBeInTheDocument();
  });

  it('Given 같은 저장 묶음의 접촉과 AI 피드백 When 보면 Then 피드백은 접촉 카드 안에 접혀 있고 펴면 앞머리 없이 보인다', async () => {
    const at = '2026-11-16T09:30:00+09:00';
    mockedGet.mockResolvedValueOnce(
      reply([
        contact(at),
        advice(at, '납기 걱정에 답을 아직 못 줬어요(가상).'),
        advice(at, '샘플이 필요한지 물어보세요.\n담당 부서를 확인하세요.', 'CALL_PREP'),
      ]),
    );
    renderTimeline();
    const card = await screen.findByTestId('timeline-card');
    expect(screen.queryByTestId('timeline-ai-nested')).not.toBeInTheDocument();
    const toggle = within(card).getByTestId('timeline-ai-toggle');
    expect(toggle).toHaveTextContent(timelineLayers.aiToggle(2, false));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const nested = within(card).getAllByTestId('timeline-ai-nested');
    expect(nested.map((el) => within(el).getByTestId('timeline-summary').textContent)).toEqual([
      // 같은 시각이면 늦게 저장된 것이 위(이력 전체와 같은 순서).
      '샘플이 필요한지 물어보세요. · 담당 부서를 확인하세요.',
      '납기 걱정에 답을 아직 못 줬어요(가상).',
    ]);
    expect(within(nested[0]).getByTestId('timeline-kind')).toHaveTextContent('다음 통화 준비');
    // 메뉴 이름에도 앞머리("다음 통화 준비 · ")가 겹치지 않는다.
    expect(within(nested[0]).getByTestId('timeline-menu-open')).toHaveAttribute(
      'aria-label',
      timelineLayers.menuLabel('샘플이 필요한지 물어보세요. · 담당 부서를 확인하세요.'),
    );
    // 따로 한 줄로는 보이지 않는다(원인 → 결과 순서, 한 곳에만).
    expect(screen.queryByTestId('timeline-ai')).not.toBeInTheDocument();
  });

  it('Given 다른 시각에 남긴 AI 피드백 When 보면 Then 어느 접촉에도 붙이지 않고 따로 한 줄로 보인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        contact('2026-11-16T09:30:00+09:00'),
        advice('2026-11-16T11:00:00+09:00', '혼자 남은 피드백(가상)'),
      ]),
    );
    renderTimeline();
    const alone = await screen.findByTestId('timeline-ai');
    expect(within(alone).getByTestId('timeline-summary')).toHaveTextContent(
      '혼자 남은 피드백(가상)',
    );
    expect(within(alone).getByTestId('timeline-kind')).toHaveTextContent(timelineLayers.aiTag);
    expect(screen.queryByTestId('timeline-ai-toggle')).not.toBeInTheDocument();
  });

  it('Given 접촉 카드 When ··· 메뉴를 열면 Then 그 안의 [잘못 입력]으로 확인 한 줄이 열린다', async () => {
    mockedGet.mockResolvedValueOnce(reply([first]));
    renderTimeline();
    const card = await screen.findByTestId('timeline-card');
    expect(screen.queryByTestId('timeline-cancel-open')).not.toBeInTheDocument();
    const menu = within(card).getByTestId('timeline-menu-open');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByTestId('timeline-cancel-open'));
    expect(screen.getByTestId('timeline-cancel-form')).toHaveTextContent(timelineArea.cancelPrompt);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Given 잘못 입력으로 표시된 단계 변경 When 흐름을 셈 Then 그 줄은 건너뛰고 다음 줄이 바뀐 것으로 보인다', () => {
    const cancelled = { ...moved, cancelled: true };
    const later = contact('2026-11-15T10:00:00+09:00', {
      status: 'SAMPLE_OR_REGISTRATION_APPROVED',
    });
    const changes = flowChanges([later, cancelled, first]);
    expect(changes.has(cancelled)).toBe(false);
    expect(changes.get(later)?.from).toBe('IN_PROGRESS');
  });

  it('날짜 구분선은 "11월 17일 (화) · 오늘", 하루 전은 "어제"를 붙인다', () => {
    const now = new Date('2026-11-17T12:00:00+09:00');
    expect(dateLabel('2026-11-17T09:00:00+09:00', now)).toBe('11월 17일 (화) · 오늘');
    expect(dateLabel('2026-11-16T23:59:00+09:00', now)).toBe('11월 16일 (월) · 어제');
    expect(dateLabel('2026-11-06T14:20:00+09:00', now)).toBe('11월 6일 (금)');
  });

  it('꼬리표와 같은 말이 글 앞에 붙어 오면 한 번만 보인다', () => {
    expect(
      summaryText({
        at: '2026-11-16T09:30:00+09:00',
        actor: 'park-lee',
        kind: 'ADVICE',
        summary: '남긴 피드백 · 답을 아직 못 줬어요',
      }),
    ).toBe('답을 아직 못 줬어요');
  });
});
