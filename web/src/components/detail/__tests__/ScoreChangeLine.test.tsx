// #942 되먹임 ①: 상세 "지난 평가와 달라진 것" 상자. 서버 값(가짜 응답)으로 글자만 본다.
import { render, screen } from '@testing-library/react';
import ScoreChangeLine from '../ScoreChangeLine';
import type { ScoreChange } from '../../../api/types';

const change: ScoreChange = {
  changedAt: '2026-11-20T05:02:00Z',
  sinceEvalId: 'eval-old',
  scoreBefore: 70,
  scoreAfter: 77,
  classificationBefore: 'CONTACT_PLANNED',
  classificationAfter: 'CONTACT_URGENT',
  ruleVersionChanged: false,
  items: [
    {
      itemCode: 'SIG_BID',
      label: '구매·외주 의향',
      before: null,
      after: 7,
      factJudged: '통화에서 확인(11/20) · 견적 요청',
    },
  ],
  records: [
    {
      at: '2026-11-20T05:01:00Z',
      kind: 'CONTACT_ATTEMPT',
      method: 'CALL',
      attemptedAt: '2026-11-20',
      summary: '견적 요청',
    },
    {
      at: '2026-11-20T05:01:00Z',
      kind: 'CHANGE',
      method: null,
      attemptedAt: null,
      summary: '공정 변경 · 아노다이징 → 아연도금',
    },
  ],
};

it('서버가 null을 주면 아무것도 그리지 않는다', () => {
  const { container } = render(<ScoreChangeLine change={null} />);
  expect(container).toBeEmptyDOMElement();
});

it('점수·분류·항목과 그 사이 기록을 쉬운 말로 보인다(점수 글자 E는 쓰지 않는다)', () => {
  render(<ScoreChangeLine change={change} />);
  expect(screen.getByRole('heading', { name: '지난 평가와 달라진 것' })).toBeInTheDocument();
  expect(screen.getByText(/11\/20 14:02 다시 평가 · 남긴 기록이/)).toBeInTheDocument();
  const head = screen.getByTestId('score-change-head');
  expect(head).toHaveTextContent('평가점수 70 → 77 · 분류');
  expect(head).not.toHaveTextContent('E ');
  expect(screen.getByTestId('score-change-item')).toHaveTextContent(
    '구매·외주 의향 -- → 7점 · 통화에서 확인(11/20) · 견적 요청',
  );
  expect(screen.getByTestId('score-change-records')).toHaveTextContent(
    '이 사이 남긴 기록: 11/20 전화 · 견적 요청 / 11/20 공정 변경 · 아노다이징 → 아연도금',
  );
  expect(screen.queryByTestId('score-change-rule')).not.toBeInTheDocument();
});

it('점수·분류가 그대로면 머리 줄을 빼고, 규칙이 바뀐 재평가는 그 말을 붙인다', () => {
  render(
    <ScoreChangeLine
      change={{
        ...change,
        scoreAfter: 70,
        classificationAfter: 'CONTACT_PLANNED',
        ruleVersionChanged: true,
        records: [],
      }}
    />,
  );
  expect(screen.queryByTestId('score-change-head')).not.toBeInTheDocument();
  expect(screen.queryByTestId('score-change-records')).not.toBeInTheDocument();
  // 남긴 기록이 없으면 기록 덕분이라고 말하지 않는다.
  expect(screen.getByText(/이 사이 남긴 기록은 없고/)).toBeInTheDocument();
  expect(screen.getByTestId('score-change-rule')).toHaveTextContent(
    '지난 평가 뒤 규칙 설정도 바뀌었습니다. 차이의 일부는 규칙 때문일 수 있습니다.',
  );
});

it('설정이 바꾼 분류 이름을 따른다', () => {
  render(
    <ScoreChangeLine change={change} classificationOverrides={{ CONTACT_URGENT: '지금 연락' }} />,
  );
  expect(screen.getByTestId('score-change-head')).toHaveTextContent('→ 지금 연락');
});
