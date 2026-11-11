// 점수 한 줄의 꼬리표(#498): PENDING의 이유로 "거래 확인 전"과 "AI 제안 · 확인 전"을 가른다.
// 서버 응답이 아니라 화면 부품만 확인한다(실제 서버 연결 확인 아님).
import { render, screen } from '@testing-library/react';
import type { ClassificationCode, ScoreState } from '../../../api/types';
import { scoreTags } from '../../../labels/ko';
import ScoreLine from '../ScoreLine';

function renderLine(scoreState: ScoreState, classificationCode?: ClassificationCode) {
  render(
    <ScoreLine
      scoreDisplay="72점 · 5/8"
      scoreState={scoreState}
      classificationCode={classificationCode}
      testId="line"
    />,
  );
}

describe('ScoreLine 꼬리표 (#498)', () => {
  it('확정 전인데 분류가 필수조건 확인 대기면 "거래 확인 전"이다', () => {
    renderLine('PENDING', 'FILTER_PENDING');
    expect(screen.getByTestId('line-pending-tag')).toHaveTextContent(scoreTags.pending);
    expect(screen.queryByTestId('line-ai-proposal-tag')).not.toBeInTheDocument();
  });

  it('확정 전인데 분류가 역량 확인 대기여도 "거래 확인 전"이다', () => {
    renderLine('PENDING', 'OPS_PENDING');
    expect(screen.getByTestId('line-pending-tag')).toHaveTextContent(scoreTags.pending);
    expect(screen.queryByTestId('line-ai-proposal-tag')).not.toBeInTheDocument();
  });

  it('확정 전이고 분류가 확인 대기가 아니면 AI 제안으로 계산된 점수라 "AI 제안 · 확인 전"이다', () => {
    renderLine('PENDING', 'CONTACT_URGENT');
    expect(screen.getByTestId('line-ai-proposal-tag')).toHaveTextContent('AI 제안 · 확인 전');
    expect(screen.queryByTestId('line-pending-tag')).not.toBeInTheDocument();
  });

  it('AI 제안 점수도 거래 확인 전 점수처럼 흐리게 보인다(같은 흐림 표시 재사용)', () => {
    renderLine('PENDING', 'CONTACT_REVIEW');
    expect(screen.getByTestId('line')).toHaveAttribute('data-score-state', 'PENDING');
  });

  it('분류를 넘기지 않으면 예전처럼 "거래 확인 전"이다', () => {
    renderLine('PENDING');
    expect(screen.getByTestId('line-pending-tag')).toHaveTextContent(scoreTags.pending);
    expect(screen.queryByTestId('line-ai-proposal-tag')).not.toBeInTheDocument();
  });

  it('확정이면 어떤 분류여도 꼬리표가 없다(확정·고치기 뒤 다시 불러오면 또렷해진다)', () => {
    renderLine('CONFIRMED', 'CONTACT_URGENT');
    expect(screen.queryByTestId('line-pending-tag')).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-ai-proposal-tag')).not.toBeInTheDocument();
  });

  it('점수가 없으면(NONE) 꼬리표가 없다', () => {
    renderLine('NONE', 'CONTACT_URGENT');
    expect(screen.queryByTestId('line-pending-tag')).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-ai-proposal-tag')).not.toBeInTheDocument();
  });
});
