// 상세 "한눈에"(#793): 홈페이지로 다시 정한 적합도와 닫힌 홈페이지 이유를 보인다(서버 호출 없음, 가상 값).
import { render, screen } from '@testing-library/react';
import type { DetailHeader } from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import DetailGlance from '../DetailGlance';

const fixtureHeader = detailFixture.data.header as unknown as DetailHeader;
const NOW = new Date('2026-11-17T12:00:00+09:00');
const base: DetailHeader = {
  ...fixtureHeader,
  researchSource: 'AI',
  researchedAt: '2026-11-17T09:00:00+09:00',
  homepageUrl: 'https://example.invalid/',
  homepageStatus: 'AI_FOUND',
  fitLevel: 'HIGH',
};

function renderWith(header: DetailHeader) {
  render(<DetailGlance header={header} processLinks={[]} evidence={[]} now={NOW} />);
}

describe('DetailGlance 홈페이지로 다시 정한 적합도 (#793)', () => {
  it('처음과 다르면 "적합도 상 (홈페이지 기준 · 처음엔 생산품 기준 중)"', () => {
    renderWith({ ...base, fitBasis: 'HOMEPAGE', previousFitLevel: 'MEDIUM' });
    expect(screen.getByTestId('glance-evidence-text')).toHaveTextContent(
      '근거 없음 · 홈페이지 있음 · 적합도 상 (홈페이지 기준 · 처음엔 생산품 기준 중)',
    );
  });

  it('처음과 같으면 "적합도 상 (홈페이지 기준)"', () => {
    renderWith({ ...base, fitBasis: 'HOMEPAGE', previousFitLevel: 'HIGH' });
    expect(screen.getByTestId('glance-evidence-text')).toHaveTextContent(
      /적합도 상 \(홈페이지 기준\)( · |$)/,
    );
  });

  it('생산품 기준이면 지금처럼 "적합도 상"만', () => {
    renderWith({ ...base, fitBasis: 'PRODUCT', previousFitLevel: null });
    const text = screen.getByTestId('glance-evidence-text').textContent ?? '';
    expect(text).toContain('적합도 상');
    expect(text).not.toContain('홈페이지 기준');
  });
});

// #996(PM 결정 2026-11-29): 홈페이지 줄은 머리의 요약 줄로 옮겨 갔다. 닫힌 이유 글("홈페이지가 닫혀 있습니다(…)")의 기대는
// `DetailSummaryRow.test.tsx`로 옮겼고, 여기에는 "한눈에" 맨 아래 근거 상태 줄에 남는 글만 본다.
describe('DetailGlance 닫힌 홈페이지 (#793)', () => {
  it('근거 상태 줄에 닫힌 이유를 보인다', () => {
    renderWith({
      ...base,
      homepageUrl: null,
      homepageStatus: 'NOT_FOUND',
      homepageClosedReason: '호스팅 만료',
    });
    expect(screen.getByTestId('glance-evidence-text')).toHaveTextContent(
      '근거 없음 · 홈페이지 닫힘 (호스팅 만료)',
    );
  });

  it('닫힌 이유가 없으면 지금처럼 "홈페이지 못 찾음"', () => {
    renderWith({ ...base, homepageUrl: null, homepageStatus: 'NOT_FOUND' });
    expect(screen.getByTestId('glance-evidence-text')).toHaveTextContent(
      '근거 없음 · 홈페이지 못 찾음',
    );
  });
});
