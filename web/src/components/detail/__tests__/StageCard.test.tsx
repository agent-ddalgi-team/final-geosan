// #996(PM 결정 2026-11-29) 기업 상세 둘째 줄 왼쪽 "영업 단계" 칸: 지금 모양 그대로 크기만 줄인 축소판.
// 큰 단계 4칸 + 세부 단계 점(연결 전 · 연결됨 · 수요 확인 · 자료·견적 · 방문·샘플) + 끝 "성사" 점 = 점 6개,
// 지금 단계 아래 "지금 (11/7부터)", 다음 일정 한 줄. 색이 아니라 상태 값 · 글자 · 크기 값으로 확인한다(서버 호출 없음).
import { render, screen, within } from '@testing-library/react';
import type { OutcomeRecord, SalesQuestions, SalesStepView } from '../../../api/types';
import { detailLayout } from '../../../theme/tokens';
import SalesProgressBar, { PROGRESS_SIZES } from '../SalesProgressBar';
import StageCard from '../StageCard';

const questions: SalesQuestions = {
  version: 1,
  steps: [
    { code: 'NOT_REACHED', label: '연결 전', stage: 'NOT_EXECUTED' },
    { code: 'REACHED', label: '연결됨', stage: 'IN_PROGRESS' },
    { code: 'DEMAND_CONFIRMED', label: '수요 확인', stage: 'IN_PROGRESS' },
    { code: 'MATERIAL_QUOTE', label: '자료·견적', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
    { code: 'VISIT_SAMPLE', label: '방문·샘플', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
  ],
  questions: [],
};
const step: SalesStepView = {
  code: 'REACHED',
  since: '2026-11-07',
  overridden: false,
  known: [],
  openQuestions: [],
};
const outcome: OutcomeRecord = {
  version: 3,
  updatedBy: 'staff-a',
  updatedAt: '2026-11-25T09:00:00+09:00',
  status: 'IN_PROGRESS',
  nextScheduleAt: '2026-12-05',
  nextScheduleNote: '소개서 보고 견적 문의 의향 확인',
};

describe('영업 단계 칸 — 축소판 (#996)', () => {
  it('Given 접촉 단계(연결됨)인 회사 When 영업 단계 칸 Then 큰 단계 4칸 + 세부 단계 점 6개 + "지금 (11/7부터)" + 다음 일정 한 줄이 그대로 보인다', () => {
    render(<StageCard salesStep={step} outcome={outcome} contactTotal={3} questions={questions} />);
    const card = screen.getByRole('region', { name: '영업 단계' });
    const bar = within(card).getByTestId('sales-progress');
    expect(bar).toHaveAttribute('data-size', 'compact');
    expect(bar).toHaveTextContent('영업 단계');

    // 큰 단계 4칸: 지나온 칸 · 지금 칸 · 아직 두 칸.
    const bands = within(card).getAllByTestId('sales-progress-band');
    expect(bands.map((band) => band.textContent)).toEqual(['미접촉', '접촉', '견적·샘플', '성사']);
    expect(bands.map((band) => band.getAttribute('data-state'))).toEqual([
      'done',
      'current',
      'todo',
      'todo',
    ]);

    // 세부 단계 점 5개 + 끝 "성사" 점 = 6개.
    const steps = within(card).getAllByTestId('sales-progress-step');
    const end = within(card).getByTestId('sales-progress-end');
    expect([...steps, end].map((dot) => dot.textContent)).toEqual([
      '연결 전',
      '연결됨지금 (11/7부터)',
      '수요 확인',
      '자료·견적',
      '방문·샘플',
      '성사',
    ]);
    expect(steps.map((dot) => dot.getAttribute('data-state'))).toEqual([
      'done',
      'current',
      'todo',
      'todo',
      'todo',
    ]);
    // "지금"은 지금 단계 점 아래에만 있다(색만으로 알리지 않는다).
    expect(within(steps[1]).getByTestId('sales-progress-now')).toHaveTextContent(
      /^지금 \(11\/7부터\)$/,
    );
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(within(card).getAllByTestId('sales-progress-now')).toHaveLength(1);
    // 그림을 글로도 읽어 준다.
    expect(within(card).getByTestId('sales-progress-steps')).toHaveAccessibleName(
      '영업 단계: 6단계 중 2단계 연결됨 (11/7부터)',
    );

    // 다음 일정은 글 한 줄뿐이고, 이 칸에는 [일정만 바꾸기] 같은 단추가 없다.
    expect(within(card).getByTestId('sales-progress-next')).toHaveTextContent(
      /^다음 일정: 12\/5 소개서 보고 견적 문의 의향 확인$/,
    );
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(card).toHaveStyle({ padding: detailLayout.cardPadding });
  });

  it('Given 다음 일정이 없는 회사 When 영업 단계 칸 Then 일정 줄을 그리지 않는다', () => {
    render(
      <StageCard
        salesStep={step}
        outcome={{ ...outcome, nextScheduleAt: null, nextScheduleNote: null }}
        questions={questions}
      />,
    );
    expect(screen.queryByTestId('sales-progress-next')).not.toBeInTheDocument();
  });

  it('Given 같은 값 When 보통 크기와 축소판을 견주면 Then 칸 수 · 점 수 · 글은 같고 점 · 칸 · 글자 크기만 작다', () => {
    const { unmount } = render(
      <SalesProgressBar
        salesStep={step}
        outcome={outcome}
        contactTotal={3}
        questions={questions}
      />,
    );
    const normal = {
      text: screen.getByTestId('sales-progress').textContent,
      bands: screen.getAllByTestId('sales-progress-band').length,
      dots: screen.getAllByTestId('sales-progress-step').length,
      size: screen.getByTestId('sales-progress').getAttribute('data-size'),
    };
    const normalBand = screen.getAllByTestId('sales-progress-band')[0];
    expect(normalBand).toHaveStyle({ minHeight: `${PROGRESS_SIZES.normal.bandMinHeight}px` });
    const normalDot = screen
      .getAllByTestId('sales-progress-step')[0]
      .querySelector('[data-dot]') as HTMLElement;
    expect(normalDot).toHaveStyle({ width: `${PROGRESS_SIZES.normal.dot}px` });
    unmount();

    render(
      <SalesProgressBar
        salesStep={step}
        outcome={outcome}
        contactTotal={3}
        questions={questions}
        compact
      />,
    );
    expect(screen.getByTestId('sales-progress').textContent).toBe(normal.text);
    expect(screen.getAllByTestId('sales-progress-band')).toHaveLength(normal.bands);
    expect(screen.getAllByTestId('sales-progress-step')).toHaveLength(normal.dots);
    expect(normal.size).toBe('normal');
    expect(screen.getByTestId('sales-progress')).toHaveAttribute('data-size', 'compact');

    const band = screen.getAllByTestId('sales-progress-band')[0];
    expect(band).toHaveStyle({
      minHeight: `${PROGRESS_SIZES.compact.bandMinHeight}px`,
      fontSize: `${PROGRESS_SIZES.compact.bandFont}px`,
    });
    const dot = screen
      .getAllByTestId('sales-progress-step')[0]
      .querySelector('[data-dot]') as HTMLElement;
    expect(dot).toHaveStyle({ width: `${PROGRESS_SIZES.compact.dot}px` });
    for (const key of ['dot', 'row', 'bandMinHeight', 'bandFont', 'stepFont', 'gap'] as const) {
      expect(PROGRESS_SIZES.compact[key]).toBeLessThan(PROGRESS_SIZES.normal[key]);
    }
    // 좁은 칸에서도 "지금 (11/7부터)"는 한 줄이고, 점 · 이름 · "지금" 세 줄을 모든 칸이 같이 써서 옆 이름과 겹치지 않는다.
    expect(screen.getByTestId('sales-progress-now')).toHaveStyle({ whiteSpace: 'nowrap' });
    const current = screen.getAllByTestId('sales-progress-step')[1];
    expect(current.style.gridTemplateRows).toBe('subgrid');
    expect(current.style.gridRow).toBe('span 3');
    // 칸 폭은 격자 칸 그대로다: 한 줄로 둔 "지금 …"이 칸보다 넓어도 점과 이름이 옆으로 밀리지 않는다.
    expect(current.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });
});
