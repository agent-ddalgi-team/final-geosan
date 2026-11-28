// "1. 왜 이 회사인가"(#674): 추천 근거 문장 아래에 그 문장의 근거 인용·출처를 붙이고, 조사 전 회사는 고른 이유와 공장 등록 정보만 보인다.
import { render, screen, within } from '@testing-library/react';
import type { DetailHeader, EvidenceView, ScoreItemView } from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import WhyThisCompany, { reasonLineId, splitReasonLabel } from '../WhyThisCompany';

const header = {
  ...(detailFixture.data.header as unknown as DetailHeader),
  pickReason: null,
  factoryProfile: null,
} satisfies DetailHeader;

function ev(id: string, quote: string, sourceRef: string): EvidenceView {
  return {
    evidenceId: id,
    sourceGrade: 'B',
    certainty: 'STRONG',
    isLlmProposed: true,
    quote,
    sourceRef,
    subject: 'PRODUCT',
  };
}

function item(code: string, state: string, summary: string | null, ids: string[]): ScoreItemView {
  return { itemCode: code, label: code, state, weight: 10, summary, evidenceIds: ids };
}

describe('WhyThisCompany (#674)', () => {
  it('근거 문장마다 바로 아래에 인용과 출처(새 창 링크)·확인 수준이 붙고, 안 쓰인 근거는 "그 밖의 근거 자료"로 모인다', () => {
    render(
      <WhyThisCompany
        header={header}
        reasons={{ reason: '서버 한 줄 이유', nextAction: '', questions: [] }}
        scoreItems={[
          item('NEW_PRODUCT', 'STRONG', '볼트를 만든다고 밝혔습니다.', ['ev-1', 'ev-2']),
          item('NEW_RECORD', 'UNAVAILABLE', '근거가 없어 미확보입니다.', []),
          item('SIG_BID', 'NO_SIGNAL', '공고가 없어 신호 없음입니다.', []),
        ]}
        evidence={[
          ev('ev-1', '볼트·너트 생산', '홈페이지 제품 안내 https://example.invalid/product'),
          ev('ev-2', '스크류 라인', '카탈로그 3쪽'),
          ev('ev-3', '회사 연혁', '홈페이지 연혁 https://example.invalid/history'),
        ]}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^왜 이 회사인가$/);
    // #996: "한눈에"와 한 블록 안의 큰 제목이라 앞에 세로 강조 막대가 붙는다.
    expect(screen.getByTestId('block-heading-bar')).toBeInTheDocument();
    // 근거가 없는 항목(미확보·신호 없음)의 문장은 여기에 없다(공고 "근거 없음"도 안 보인다).
    const rows = screen.getAllByTestId('detail-reason-line');
    expect(rows).toHaveLength(1);
    // #996: 줄 머리의 갈래 이름("제품", 추정이면 "제품(추정)")은 이름표로 떼어 왼쪽에 보이고 문장은 그 옆에 온다.
    // (전에는 "제품(추정): 볼트를…"이 한 글이었다.)
    expect(within(rows[0]).getByTestId('detail-reason-label')).toHaveTextContent(/^제품\(추정\)$/);
    expect(within(rows[0]).getByTestId('detail-reason-text')).toHaveTextContent(
      /^볼트를 만든다고 밝혔습니다\.$/,
    );
    // "한눈에"의 "○○ 근거 ↓"가 이 줄로 올 수 있게 줄마다 id가 있고 초점을 받을 수 있다.
    expect(rows[0]).toHaveAttribute('id', reasonLineId('NEW_PRODUCT'));
    expect(rows[0]).toHaveAttribute('tabindex', '-1');
    const quotes = within(rows[0]).getAllByTestId('evidence-item');
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toHaveTextContent('“볼트·너트 생산”');
    const link = within(quotes[0]).getByRole('link', { name: 'https://example.invalid/product' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // 추정이 확정처럼 보이지 않게 확인 수준과 AI 제안 표시가 함께 있다.
    expect(quotes[0]).toHaveTextContent('출처 등급 B');
    expect(quotes[0]).toHaveTextContent('추정(강한)');
    expect(within(quotes[0]).getByTestId('evidence-llm-tag')).toBeInTheDocument();
    expect(within(quotes[1]).queryByRole('link')).not.toBeInTheDocument();

    const others = screen.getByTestId('why-other-evidence');
    expect(within(others).getByRole('heading', { level: 3 })).toHaveTextContent(
      '그 밖의 근거 자료',
    );
    expect(within(others).getAllByTestId('evidence-item')).toHaveLength(1);
    expect(others).toHaveTextContent('회사 연혁');
    expect(screen.getByTestId('detail-reasons')).not.toHaveTextContent('미확보');
    expect(screen.getByTestId('detail-reasons')).not.toHaveTextContent('공고');
    // 읽기만 한다.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('점수 항목 요약이 없으면 서버 추천 이유 한 줄 아래에 근거 자료 목록을 둔다', () => {
    render(
      <WhyThisCompany
        header={header}
        reasons={{ reason: '공고 마감 3주 뒤', nextAction: '', questions: [] }}
        scoreItems={undefined}
        evidence={[ev('ev-1', '협력사 모집', '나라장터 공고')]}
      />,
    );
    expect(screen.getByTestId('detail-reason')).toHaveTextContent('추천 근거: 공고 마감 3주 뒤');
    expect(
      within(screen.getByTestId('why-other-evidence')).getByRole('heading', { level: 3 }),
    ).toHaveTextContent(/^근거 자료$/);
    expect(screen.getAllByTestId('evidence-item')).toHaveLength(1);
  });

  it('조사 전·홈페이지 없는 회사는 AI가 고른 이유 한 줄과 공장 등록 정보만 보인다', () => {
    const reason = '볼트·스크류 생산, 방청 도금 수요 높음';
    render(
      <WhyThisCompany
        header={{
          ...header,
          pickReason: reason,
          factoryProfile: {
            rawMaterials: '철선',
            employeeCount: 76,
            scale: '중기업',
            industryName: null,
            fileDate: '2026-11-11',
          },
        }}
        // 점수 전 회사는 서버가 고른 이유를 추천 근거 칸에도 넣는다(#555). 한 번만 보인다.
        reasons={{ reason, nextAction: '', questions: [] }}
        scoreItems={undefined}
        evidence={[]}
      />,
    );
    expect(screen.getByTestId('why-pick-reason')).toHaveTextContent(`AI가 고른 이유: ${reason}`);
    expect(screen.getByTestId('why-pick-reason')).toHaveTextContent('AI 판단');
    expect(screen.queryByTestId('detail-reason')).not.toBeInTheDocument();
    expect(screen.getByTestId('why-factory')).toHaveTextContent(
      '공장 등록 정보: 원자재 철선 · 중기업',
    );
    expect(screen.getByTestId('why-factory')).toHaveTextContent('팩토리온 11/11 기준');
    expect(screen.getByTestId('evidence-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('evidence-item')).not.toBeInTheDocument();
  });

  it('Given 링크가 있는 줄과 갈래 이름이 없는 글 When 나누면 Then 이름표는 한 번만 보이고 괄호 링크는 그대로다 (#996)', () => {
    expect(splitReasonLabel('소재: 탄소강이라 맞습니다.')).toEqual({
      label: '소재',
      body: '탄소강이라 맞습니다.',
    });
    expect(splitReasonLabel('갈래 이름이 없는 글')).toEqual({
      label: null,
      body: '갈래 이름이 없는 글',
    });
    render(
      <WhyThisCompany
        header={header}
        reasons={{ reason: '', nextAction: '', questions: [] }}
        scoreItems={[
          item('NEW_MATERIAL', 'CONFIRMED', '탄소강이라 맞습니다. (홈페이지 볼트)', ['ev-1']),
        ]}
        evidence={[ev('ev-1', '탄소강 볼트', '홈페이지 볼트 https://example.invalid/bolt')]}
      />,
    );
    const row = screen.getByTestId('detail-reason-line');
    expect(within(row).getByTestId('detail-reason-label')).toHaveTextContent(/^소재$/);
    const text = within(row).getByTestId('detail-reason-text');
    expect(text).toHaveTextContent(/^탄소강이라 맞습니다\. \(홈페이지 볼트\)$/);
    expect(within(text).getByRole('link', { name: '홈페이지 볼트' })).toHaveAttribute(
      'href',
      'https://example.invalid/bolt',
    );
    // 줄 전체 글에는 "소재"가 이름표 한 번만 있다.
    expect(row.textContent?.match(/소재/g)).toHaveLength(1);
  });
});
