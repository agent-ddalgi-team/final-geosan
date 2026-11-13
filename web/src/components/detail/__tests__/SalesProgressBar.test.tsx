// 상세 맨 위 단계 진행 막대(#674): 진행 중·거절·보류·성사·기록 없음. 색이 아니라 점 상태 값·글자·낭독 글로 확인한다.
import { render, screen } from '@testing-library/react';
import type { OutcomeRecord, SalesQuestions, SalesStepView } from '../../../api/types';
import SalesProgressBar, { salesProgressOf } from '../SalesProgressBar';

const questions: SalesQuestions = {
  version: 1,
  steps: [
    { code: 'NOT_REACHED', label: '연결 전', stage: 'IN_PROGRESS' },
    { code: 'REACHED', label: '연결됨', stage: 'IN_PROGRESS' },
    { code: 'DEMAND_CONFIRMED', label: '수요 확인', stage: 'IN_PROGRESS' },
    { code: 'MATERIAL_QUOTE', label: '자료·견적', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
    { code: 'VISIT_SAMPLE', label: '방문·샘플', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
  ],
  questions: [
    {
      questionId: 'WHO_TALKED',
      text: '누구와 이야기했나요?',
      step: 'NOT_REACHED',
      answers: [{ answerId: 'RIGHT_PERSON', label: '담당 부서', reaches: 'REACHED' }],
    },
    {
      questionId: 'PLATING_NOW',
      text: '지금 도금은 어떻게 하나요?',
      step: 'REACHED',
      answers: [{ answerId: 'OUTSOURCED', label: '외주 줌', reaches: 'DEMAND_CONFIRMED' }],
    },
  ],
};

function step(patch: Partial<SalesStepView>): SalesStepView {
  return { code: null, since: null, overridden: false, known: [], openQuestions: [], ...patch };
}

function outcome(patch: Partial<OutcomeRecord>): OutcomeRecord {
  return { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-12T09:00:00+09:00', ...patch };
}

const known = [
  {
    questionId: 'WHO_TALKED',
    question: '누구와 이야기했나요?',
    answerId: 'RIGHT_PERSON',
    answer: '담당 부서',
    at: '2026-11-10',
    by: 'park-lee',
  },
  {
    questionId: 'PLATING_NOW',
    question: '지금 도금은 어떻게 하나요?',
    answerId: 'OUTSOURCED',
    answer: '외주 줌',
    at: '2026-11-12',
    by: 'park-lee',
  },
];

function states() {
  return screen.getAllByTestId('sales-progress-step').map((el) => el.getAttribute('data-state'));
}

describe('SalesProgressBar', () => {
  it('진행 중: 지나온 단계는 채운 점, 지금 단계는 "지금 (11/12부터)", 아직인 단계는 빈 점이고 글로도 알린다', () => {
    render(
      <SalesProgressBar
        salesStep={step({ code: 'DEMAND_CONFIRMED', since: '2026-11-12' })}
        outcome={outcome({
          status: 'IN_PROGRESS',
          nextScheduleAt: '2026-11-20',
          nextScheduleNote: '견적 보내기',
        })}
        contactTotal={3}
        questions={questions}
      />,
    );
    expect(states()).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    const steps = screen.getAllByTestId('sales-progress-step');
    expect(steps.map((el) => el.textContent)).toEqual([
      '✓연결 전',
      '✓연결됨',
      '●수요 확인▲ 지금 (11/12부터)',
      '자료·견적',
      '방문·샘플',
    ]);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('sales-progress-now')).toHaveTextContent('지금 (11/12부터)');
    expect(screen.getByTestId('sales-progress-end')).toHaveAttribute('data-state', 'todo');
    expect(screen.getByTestId('sales-progress-end-text')).toHaveTextContent(/^성사$/);
    expect(screen.getByRole('list')).toHaveAccessibleName(
      '영업 단계: 6단계 중 3단계 수요 확인 (11/12부터)',
    );
    expect(screen.getByTestId('sales-progress-next')).toHaveTextContent(
      '다음 일정: 11/20 견적 보내기',
    );
    expect(screen.queryByTestId('sales-progress-empty')).not.toBeInTheDocument();
    // 읽기만 하는 그림이다: 단추가 없다.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('거절: 멈춘 자리(알아낸 답이 닿은 가장 먼 단계)까지 채우고 끝에 "✕ 거절 (가격)"이 보인다', () => {
    render(
      <SalesProgressBar
        salesStep={step({ known })}
        outcome={outcome({ status: 'LOST', lostReasonCode: 'PRICE' })}
        contactTotal={2}
        questions={questions}
      />,
    );
    expect(states()).toEqual(['done', 'done', 'done', 'todo', 'todo']);
    expect(screen.getByTestId('sales-progress')).toHaveAttribute('data-end', 'lost');
    expect(screen.getByTestId('sales-progress-end-text')).toHaveTextContent('✕ 거절 (가격)');
    expect(screen.queryByTestId('sales-progress-now')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveAccessibleName(
      '영업 단계: 6단계 중 3단계 수요 확인에서 거절 (가격)',
    );
  });

  it('보류: 답이 없고 접촉만 있었으면 첫 단계까지 채우고 끝에 "⏸ 보류"가 보인다', () => {
    render(
      <SalesProgressBar
        salesStep={step({})}
        outcome={outcome({ status: 'ON_HOLD' })}
        contactTotal={1}
        questions={questions}
      />,
    );
    expect(states()).toEqual(['done', 'todo', 'todo', 'todo', 'todo']);
    expect(screen.getByTestId('sales-progress-end')).toHaveAttribute('data-state', 'hold');
    expect(screen.getByTestId('sales-progress-end-text')).toHaveTextContent('⏸ 보류');
    expect(screen.getByRole('list')).toHaveAccessibleName(
      '영업 단계: 6단계 중 1단계 연결 전에서 보류',
    );
  });

  it('성사: 끝까지 채우고 끝 칸이 "✓ 성사"다', () => {
    render(
      <SalesProgressBar
        salesStep={step({})}
        outcome={outcome({ status: 'WON' })}
        contactTotal={4}
        questions={questions}
      />,
    );
    expect(states()).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(screen.getByTestId('sales-progress-end')).toHaveAttribute('data-state', 'won');
    expect(screen.getByTestId('sales-progress-end-text')).toHaveTextContent('✓ 성사');
    expect(screen.getByRole('list')).toHaveAccessibleName('영업 단계: 6단계 모두 지나 성사');
  });

  it('접촉 기록이 없으면 모두 빈 점이고 "아직 접촉 기록이 없습니다"가 보인다', () => {
    render(
      <SalesProgressBar
        salesStep={step({})}
        outcome={null}
        contactTotal={0}
        questions={questions}
      />,
    );
    expect(states()).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
    expect(screen.getByTestId('sales-progress-empty')).toHaveTextContent(
      '아직 접촉 기록이 없습니다',
    );
    expect(screen.getByRole('list')).toHaveAccessibleName(
      '영업 단계: 6단계 중 시작 전 · 아직 접촉 기록이 없습니다',
    );
    expect(screen.queryByTestId('sales-progress-next')).not.toBeInTheDocument();
  });

  it('질문 파일을 못 받아도 코드표 순서와 쉬운 말로 다섯 단계를 그린다', () => {
    render(
      <SalesProgressBar
        salesStep={step({ code: 'REACHED', since: '2026-11-05' })}
        outcome={outcome({ status: 'IN_PROGRESS' })}
        contactTotal={1}
        questions={null}
      />,
    );
    expect(states()).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
    expect(screen.getAllByTestId('sales-progress-step')[4]).toHaveTextContent('방문·샘플');
  });

  it('거절인데 접촉도 답도 없으면 채운 점이 없다', () => {
    const progress = salesProgressOf(step({}), outcome({ status: 'LOST' }), 0, questions);
    expect(progress.reachedIndex).toBe(-1);
    expect(progress.end).toBe('lost');
    expect(progress.noContact).toBe(false);
  });
});
