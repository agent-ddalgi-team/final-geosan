// 상세 맨 위 단계 진행 막대(#674): 진행 중·거절·보류·성사·기록 없음. 색이 아니라 점 상태 값·글자·낭독 글로 확인한다.
// #972 새 시안: 큰 단계 칸 아래에 그 칸의 세부 단계 점을 놓고 한 줄 선으로 잇는다(자리·색·선 길이도 확인한다).
import { render, screen } from '@testing-library/react';
import type { OutcomeRecord, SalesQuestions, SalesStepView } from '../../../api/types';
import { accent, neutralChip, progressTheme, statusPalette, warn } from '../../../theme/tokens';
import SalesProgressBar, { salesProgressOf, stepPlacementsOf } from '../SalesProgressBar';

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
      // #972: 지나온 점 안의 ✓ 그림은 새 시안에 없어 뺐다(점 위에 글자를 올리지 않는다). 상태는 위 data-state로 확인한다.
      '연결 전',
      '연결됨',
      // #759: 지금 점은 흰 가운데 + 고리 모양이라 점 안 글자(●)가 없다. 지금 단계는 aria-current와 "지금" 글로 알린다.
      // #972: 점 아래 "지금" 글 앞의 ▲ 그림은 새 시안에 없어 뺐다(글자는 그대로).
      '수요 확인지금 (11/12부터)',
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

  describe('큰 단계 띠 (#759)', () => {
    const bandStates = () =>
      screen.getAllByTestId('sales-progress-band').map((el) => el.getAttribute('data-state'));
    const bandTexts = () =>
      screen.getAllByTestId('sales-progress-band').map((el) => el.textContent);

    it('진행 중이면 서버의 큰 단계가 지금 칸이고 앞 칸은 지나온 칸, 읽어 주는 글도 있다', () => {
      render(
        <SalesProgressBar
          salesStep={step({ code: 'DEMAND_CONFIRMED', since: '2026-11-12' })}
          outcome={outcome({ status: 'IN_PROGRESS' })}
          contactTotal={2}
          questions={questions}
        />,
      );
      expect(bandTexts()).toEqual(['미접촉', '접촉', '견적·샘플', '성사']);
      expect(bandStates()).toEqual(['done', 'current', 'todo', 'todo']);
      expect(screen.getByTestId('sales-progress-bands')).toHaveAccessibleName('큰 단계: 접촉');
    });

    it('큰 단계가 없으면 세부 단계로 짐작한다: 자료·견적부터는 견적·샘플, 접촉 기록이 없으면 미접촉', () => {
      const { unmount } = render(
        <SalesProgressBar
          salesStep={step({ code: 'MATERIAL_QUOTE' })}
          outcome={null}
          contactTotal={3}
          questions={questions}
        />,
      );
      expect(bandStates()).toEqual(['done', 'done', 'current', 'todo']);
      unmount();
      render(
        <SalesProgressBar salesStep={null} outcome={null} contactTotal={0} questions={questions} />,
      );
      expect(bandStates()).toEqual(['current', 'todo', 'todo', 'todo']);
    });

    it('거절이면 마지막 칸이 "거절 (가격)"이 되고 멈춘 곳까지만 지나온 칸이다', () => {
      render(
        <SalesProgressBar
          salesStep={step({ known })}
          outcome={outcome({ status: 'LOST', lostReasonCode: 'PRICE' })}
          contactTotal={2}
          questions={questions}
        />,
      );
      expect(bandStates()).toEqual(['done', 'done', 'todo', 'lost']);
      expect(bandTexts()[3]).toBe('거절 (가격)');
    });

    it('보류면 마지막 칸이 "보류", 성사면 모든 칸을 지나 성사 칸이 지금 칸이다', () => {
      const { unmount } = render(
        <SalesProgressBar
          salesStep={null}
          outcome={outcome({ status: 'ON_HOLD' })}
          contactTotal={1}
          questions={questions}
        />,
      );
      // #898(PM 결정 2026-11-23 "연결 전은 미접촉"): 연결되지 않은 접촉만 있고 보류면 접촉 칸까지 가지 않았다.
      expect(bandStates()).toEqual(['done', 'todo', 'todo', 'hold']);
      expect(bandTexts()[3]).toBe('보류');
      unmount();
      render(
        <SalesProgressBar
          salesStep={null}
          outcome={outcome({ status: 'WON' })}
          contactTotal={3}
          questions={questions}
        />,
      );
      expect(bandStates()).toEqual(['done', 'done', 'done', 'current']);
    });
  });

  describe('큰 칸 아래 세부 단계 (#972 새 시안)', () => {
    const inProgress = (
      <SalesProgressBar
        salesStep={step({ code: 'MATERIAL_QUOTE', since: '2026-11-13' })}
        outcome={outcome({ status: 'SAMPLE_OR_REGISTRATION_APPROVED' })}
        contactTotal={1}
        questions={questions}
      />
    );
    /** 큰 단계 칸마다 그 아래에 놓인 점의 글자. */
    function dotsByBand(): Record<string, string[]> {
      const dots = [
        ...screen.getAllByTestId('sales-progress-step'),
        screen.getByTestId('sales-progress-end'),
      ];
      const groups: Record<string, string[]> = {};
      for (const dot of dots) {
        const band = dot.getAttribute('data-band') ?? '';
        const label = dot.querySelector('span:not([aria-hidden])')?.textContent ?? '';
        groups[band] = [...(groups[band] ?? []), label];
      }
      return groups;
    }

    it('큰 단계 칸마다 자기 세부 단계가 그 칸 바로 아래에 놓인다', () => {
      render(inProgress);
      expect(dotsByBand()).toEqual({
        NOT_EXECUTED: ['연결 전'],
        IN_PROGRESS: ['연결됨', '수요 확인'],
        SAMPLE_OR_REGISTRATION_APPROVED: ['자료·견적', '방문·샘플'],
        WON: ['성사'],
      });
      // 큰 칸 4개는 같은 너비이고, 점 격자는 큰 칸 하나를 둘로 나눈 8칸이다.
      expect(screen.getByTestId('sales-progress-bands')).toHaveStyle({
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      });
      expect(screen.getByTestId('sales-progress-steps')).toHaveStyle({
        gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
      });
      // 점 하나뿐인 칸은 칸 전체(가운데), 둘인 칸은 반씩 차지한다.
      const columns = [
        ...screen.getAllByTestId('sales-progress-step'),
        screen.getByTestId('sales-progress-end'),
      ].map((el) => el.style.gridColumn);
      expect(columns).toEqual([
        '1 / span 2',
        '3 / span 1',
        '4 / span 1',
        '5 / span 1',
        '6 / span 1',
        '7 / span 2',
      ]);
    });

    it('지나온 칸은 강조 연한 바탕, 지금 칸은 강조 바탕 + 흰 글자, 아직인 칸은 중립이다', () => {
      render(inProgress);
      const [first, second, third, fourth] = screen.getAllByTestId('sales-progress-band');
      expect(first).toHaveAttribute('data-state', 'done');
      expect(first).toHaveStyle({ background: accent.soft, color: accent.text });
      expect(second).toHaveStyle({ background: accent.soft, color: accent.text });
      expect(third).toHaveAttribute('data-state', 'current');
      expect(third).toHaveStyle({ background: accent.bg, color: accent.onBg });
      expect(fourth).toHaveAttribute('data-state', 'todo');
      expect(fourth).toHaveStyle({ background: neutralChip.bg, color: neutralChip.text });
    });

    it('지나온 점은 채운 점, 지금 점은 흰 가운데 + 강조 고리 + "지금" 글, 아직인 점은 옅은 점이다', () => {
      render(inProgress);
      const dotOf = (el: HTMLElement) => el.querySelector('[aria-hidden="true"]') as HTMLElement;
      const steps = screen.getAllByTestId('sales-progress-step');
      expect(states()).toEqual(['done', 'done', 'done', 'current', 'todo']);
      expect(dotOf(steps[0])).toHaveStyle({ background: accent.bright });
      expect(dotOf(steps[0])).toHaveTextContent('');
      expect(dotOf(steps[3])).toHaveStyle({ border: `3px solid ${accent.bg}` });
      expect(dotOf(steps[3])).toHaveTextContent('');
      expect(steps[3]).toHaveAttribute('aria-current', 'step');
      expect(screen.getByTestId('sales-progress-now')).toHaveTextContent('지금 (11/13부터)');
      // "지금" 글은 지금 점 아래(자료·견적 칸)에만 있다.
      expect(steps[3]).toContainElement(screen.getByTestId('sales-progress-now'));
      expect(dotOf(steps[4])).toHaveStyle({ background: progressTheme.dotTodo });
      expect(dotOf(screen.getByTestId('sales-progress-end'))).toHaveStyle({
        background: progressTheme.dotTodo,
      });
    });

    it('선은 처음 점부터 끝 점까지 한 줄이고, 지나온 구간(지금 점까지)만 강조 흐린 선이다', () => {
      render(inProgress);
      // 처음 점은 첫 칸 가운데(12.5%), 끝 점은 마지막 칸 가운데(87.5%).
      expect(screen.getByTestId('sales-progress-line')).toHaveStyle({
        left: '12.5%',
        width: '75%',
        background: progressTheme.line,
      });
      // 자료·견적 점은 셋째 칸의 1/4 자리(56.25%)다.
      expect(screen.getByTestId('sales-progress-line-done')).toHaveStyle({
        left: '12.5%',
        width: '43.75%',
        background: accent.line,
      });
    });

    it('첫 단계(연결 전)에 머물러 있거나 접촉 기록이 없으면 지나온 선이 없다', () => {
      const { unmount } = render(
        <SalesProgressBar
          salesStep={step({ code: 'NOT_REACHED', since: '2026-11-13' })}
          outcome={outcome({ status: 'NOT_EXECUTED' })}
          contactTotal={1}
          questions={questions}
        />,
      );
      expect(screen.getByTestId('sales-progress-line')).toBeInTheDocument();
      expect(screen.queryByTestId('sales-progress-line-done')).not.toBeInTheDocument();
      // "연결 전"은 미접촉 칸 아래에서 지금 단계다.
      expect(screen.getAllByTestId('sales-progress-step')[0]).toHaveAttribute(
        'data-band',
        'NOT_EXECUTED',
      );
      expect(screen.getAllByTestId('sales-progress-band')[0]).toHaveAttribute(
        'data-state',
        'current',
      );
      unmount();
      render(
        <SalesProgressBar salesStep={null} outcome={null} contactTotal={0} questions={questions} />,
      );
      expect(screen.queryByTestId('sales-progress-line-done')).not.toBeInTheDocument();
    });

    it('거절로 끝나면 멈춘 점까지만 회색으로 채우고, 끝 점과 마지막 칸이 거절을 알린다', () => {
      render(
        <SalesProgressBar
          salesStep={step({ known })}
          outcome={outcome({ status: 'LOST', lostReasonCode: 'PRICE' })}
          contactTotal={2}
          questions={questions}
        />,
      );
      // 멈춘 자리 "수요 확인"은 둘째 칸의 3/4 자리(43.75%)다.
      expect(screen.getByTestId('sales-progress-line-done')).toHaveStyle({
        left: '12.5%',
        width: '31.25%',
        background: statusPalette.neutral.fg,
      });
      const end = screen.getByTestId('sales-progress-end');
      expect(end).toHaveAttribute('data-state', 'lost');
      expect(end).toHaveAttribute('data-band', 'WON');
      expect(end.querySelector('[aria-hidden="true"]')).toHaveStyle({
        background: statusPalette.neutral.fg,
      });
      const lastBand = screen.getAllByTestId('sales-progress-band')[3];
      expect(lastBand).toHaveTextContent('거절 (가격)');
      expect(lastBand).toHaveStyle({ color: statusPalette.neutral.fg, fontWeight: 700 });
      expect(screen.queryByTestId('sales-progress-now')).not.toBeInTheDocument();
    });

    it('보류로 끝나면 지나온 점이 주의색이고 마지막 칸이 "보류"다. 성사는 끝 점까지 선을 채운다', () => {
      const { unmount } = render(
        <SalesProgressBar
          salesStep={step({ known })}
          outcome={outcome({ status: 'ON_HOLD' })}
          contactTotal={2}
          questions={questions}
        />,
      );
      expect(screen.getByTestId('sales-progress-line-done')).toHaveStyle({
        width: '31.25%',
        background: warn.dot,
      });
      expect(
        screen.getAllByTestId('sales-progress-step')[0].querySelector('[aria-hidden="true"]'),
      ).toHaveStyle({ background: warn.dot });
      const holdBand = screen.getAllByTestId('sales-progress-band')[3];
      expect(holdBand).toHaveTextContent('보류');
      expect(holdBand).toHaveStyle({ color: statusPalette.recheck.fg });
      unmount();
      render(
        <SalesProgressBar
          salesStep={step({})}
          outcome={outcome({ status: 'WON' })}
          contactTotal={4}
          questions={questions}
        />,
      );
      expect(screen.getByTestId('sales-progress-line-done')).toHaveStyle({
        left: '12.5%',
        width: '75%',
        background: accent.line,
      });
      expect(
        screen.getByTestId('sales-progress-end').querySelector('[aria-hidden="true"]'),
      ).toHaveStyle({ background: accent.bright });
      expect(screen.getByTestId('sales-progress-end-text')).toHaveTextContent('✓ 성사');
    });

    it('세부 단계 수가 달라도 큰 칸마다 점을 고르게 나눠 놓는다', () => {
      // 세부 단계 6개: 미접촉 1 · 접촉 2 · 견적·샘플 3 · 성사 1 → 칸 하나를 6으로 나눈 24칸.
      const { columns, dots } = stepPlacementsOf(6);
      expect(columns).toBe(24);
      expect(dots.map((dot) => dot.band)).toEqual([0, 1, 1, 2, 2, 2, 3]);
      expect(dots.map((dot) => `${dot.start}/${dot.span}`)).toEqual([
        '1/6',
        '7/3',
        '10/3',
        '13/2',
        '15/2',
        '17/2',
        '19/6',
      ]);
      expect(dots[0].center).toBe(12.5);
      expect(dots[6].center).toBe(87.5);
    });

    it('hideTitle을 주면 제목 글만 숨기고 그림과 읽어 주는 글은 그대로다', () => {
      const { unmount } = render(inProgress);
      expect(screen.getByText('영업 단계')).toBeInTheDocument();
      unmount();
      render(
        <SalesProgressBar
          salesStep={step({ code: 'MATERIAL_QUOTE', since: '2026-11-13' })}
          outcome={outcome({ status: 'SAMPLE_OR_REGISTRATION_APPROVED' })}
          contactTotal={1}
          questions={questions}
          hideTitle
        />,
      );
      expect(screen.queryByText('영업 단계')).not.toBeInTheDocument();
      expect(screen.getByRole('list')).toHaveAccessibleName(
        '영업 단계: 6단계 중 4단계 자료·견적 (11/13부터)',
      );
      expect(screen.getAllByTestId('sales-progress-band')).toHaveLength(4);
    });
  });
});
