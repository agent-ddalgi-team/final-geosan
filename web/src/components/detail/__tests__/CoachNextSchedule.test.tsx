// #980(PM 결정 2026-11-28): 기업 상세 영업 코치 맨 위 "다음 일정" 칸.
// 펼치면 공용 일정 칸(ScheduleQuickEdit, #983)이 열린다. 그 부품의 저장은 자기 시험이 보므로 여기서는 가짜로 바꾼다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CoachNextSchedule from '../CoachNextSchedule';
import type { OutcomeRecord } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../schedule/ScheduleQuickEdit', () => ({
  default: ({
    currentScheduleAt,
    onSaved,
    onCancel,
  }: {
    currentScheduleAt: string | null;
    onSaved: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="fake-quick-edit" data-current={currentScheduleAt ?? ''}>
      <button type="button" onClick={() => onSaved()}>
        가짜 저장
      </button>
      <button type="button" onClick={() => onCancel()}>
        가짜 취소
      </button>
    </div>
  ),
}));

function frame(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config: null,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...overrides,
  };
}

function outcome(partial: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    version: 3,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-28T01:00:00Z',
    status: 'IN_PROGRESS',
    ...partial,
  };
}

function renderBox(current: OutcomeRecord | null, onSaved = vi.fn(), value = frame()) {
  render(
    <FrameContext.Provider value={value}>
      <CoachNextSchedule oppId="opp-1" outcome={current} onSaved={onSaved} />
    </FrameContext.Provider>,
  );
  return onSaved;
}

describe('기업 상세 › 영업 코치 › 다음 일정 (#980)', () => {
  it('Given 일정이 없음 When 보면 Then "일정 없음 [일정 잡기]"', () => {
    renderBox(null);
    expect(screen.getByTestId('coach-next-schedule-line')).toHaveTextContent('일정 없음');
    expect(screen.getByTestId('coach-next-schedule-open')).toHaveTextContent('일정 잡기');
  });

  it('Given 앞으로 잡힌 일정 When 보면 Then 날짜 · 내용 한 줄과 [바꾸기]', () => {
    renderBox(outcome({ nextScheduleAt: '2099-12-02', nextScheduleNote: '방문 · 샘플 전달' }));
    expect(screen.getByTestId('coach-next-schedule-line')).toHaveTextContent('12/2');
    expect(screen.getByTestId('coach-next-schedule-line')).toHaveTextContent('방문 · 샘플 전달');
    expect(screen.getByTestId('coach-next-schedule-open')).toHaveTextContent('바꾸기');
  });

  it('Given 지난 일정 When 보면 Then "지난 일정"이 붙는다', () => {
    renderBox(outcome({ nextScheduleAt: '2020-01-02', nextScheduleNote: '전화' }));
    expect(screen.getByTestId('coach-next-schedule-line')).toHaveTextContent('지난 일정 1/2');
  });

  it('Given 보기 전용 When 보면 Then 단추가 잠겨 있다', () => {
    renderBox(null, vi.fn(), frame({ canRecord: false, staffKey: 'viewer' }));
    expect(screen.getByTestId('coach-next-schedule-open')).toBeDisabled();
  });

  it('Given [바꾸기] When 공용 칸에서 저장 Then 칸이 닫히고 상세를 다시 읽게 알린다. 취소하면 그냥 닫힌다', async () => {
    const user = userEvent.setup();
    const onSaved = renderBox(outcome({ nextScheduleAt: '2099-12-02' }));
    await user.click(screen.getByTestId('coach-next-schedule-open'));
    expect(screen.getByTestId('fake-quick-edit')).toHaveAttribute('data-current', '2099-12-02');
    await user.click(screen.getByRole('button', { name: '가짜 취소' }));
    expect(screen.queryByTestId('fake-quick-edit')).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('coach-next-schedule-open'));
    await user.click(screen.getByRole('button', { name: '가짜 저장' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('fake-quick-edit')).not.toBeInTheDocument();
  });
});
