// 상세 "한눈에"(#860): 공급망 위치 줄. 통화 답("도금 업체는 누가 정하나요?")이 있으면 AI 추정보다 먼저.
// 서버 호출 없음, 가상 값.
import { render, screen } from '@testing-library/react';
import type { DetailHeader, KnownSalesAnswer } from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import DetailGlance from '../DetailGlance';

const fixtureHeader = detailFixture.data.header as unknown as DetailHeader;
const NOW = new Date('2026-11-20T12:00:00+09:00');

function renderWith(header: Partial<DetailHeader>, plateDecider: KnownSalesAnswer | null = null) {
  render(
    <DetailGlance
      header={{ ...fixtureHeader, ...header }}
      processLinks={[]}
      evidence={[]}
      now={NOW}
      plateDecider={plateDecider}
    />,
  );
}

const called: KnownSalesAnswer = {
  questionId: 'PLATER_DECIDER',
  question: '도금 업체는 누가 정하나요?',
  answerId: 'CLIENT',
  answer: '발주처가 지정',
  at: '2026-11-19',
  by: '박 이사',
};

describe('DetailGlance 공급망 위치 줄 (#860)', () => {
  it('1차면 위치 · "협력 가공사를 물어볼 곳" · 근거와 출처', () => {
    renderWith({
      supplyTier: 'TIER1',
      supplyTierBasis: '철도차량 완성품 조립 납품',
      supplyTierSource: 'PRODUCT',
    });
    const line = screen.getByTestId('glance-supply-tier');
    expect(line).toHaveTextContent(
      '공급망 위치1차 완성품·조립 업체 · 협력 가공사를 물어볼 곳 · 철도차량 완성품 조립 납품(생산품 기준 AI 추정 · 확인 전)',
    );
    expect(screen.queryByTestId('glance-supply-tier-call')).not.toBeInTheDocument();
  });

  it('홈페이지로 정했으면 출처가 "홈페이지 기준"', () => {
    renderWith({
      supplyTier: 'TIER2_3',
      supplyTierBasis: '브라켓을 직접 가공',
      supplyTierSource: 'HOMEPAGE',
    });
    expect(screen.getByTestId('glance-supply-tier-ai')).toHaveTextContent(
      '2·3차 가공업체 · 브라켓을 직접 가공',
    );
    expect(screen.getByTestId('glance-supply-tier')).toHaveTextContent(
      '(홈페이지 기준 AI 추정 · 확인 전)',
    );
  });

  it('통화 답이 있으면 답이 먼저 보이고 AI 추정은 뒤에', () => {
    renderWith(
      { supplyTier: 'TIER2_3', supplyTierBasis: '볼트 가공', supplyTierSource: 'PRODUCT' },
      called,
    );
    const call = screen.getByTestId('glance-supply-tier-call');
    expect(call).toHaveTextContent('도금 업체: 발주처가 지정 · 통화 11/19');
    expect(call.compareDocumentPosition(screen.getByTestId('glance-supply-tier-ai'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('AI 추정이 없어도 통화 답만으로 줄이 보인다', () => {
    renderWith({ supplyTier: null }, called);
    expect(screen.getByTestId('glance-supply-tier-call')).toBeInTheDocument();
    expect(screen.queryByTestId('glance-supply-tier-ai')).not.toBeInTheDocument();
  });

  it('판단 전이고 통화 답도 없으면 줄이 없다', () => {
    renderWith({ supplyTier: null });
    expect(screen.queryByTestId('glance-supply-tier')).not.toBeInTheDocument();
  });

  // #890(PM 결정 2026-11-22): 분명하지 않은(모름) 회사는 검토할 일로 보인다. 전에는 줄이 없었다.
  it('모름이면 "확인 필요 · 이유 — 통화에서 확인"이 보인다', () => {
    renderWith({
      supplyTier: 'UNKNOWN',
      supplyTierBasis: '회사명은 변압기 완제품, 생산품은 변압기 부품',
      supplyTierSource: 'PRODUCT',
    });
    const line = screen.getByTestId('glance-supply-tier-unclear');
    expect(line).toHaveTextContent('확인 필요 · 회사명은 변압기 완제품, 생산품은 변압기 부품');
    expect(line).toHaveTextContent('통화에서 "도금 업체는 누가 정하나요?"로 확인');
    expect(screen.queryByTestId('glance-supply-tier-ai')).not.toBeInTheDocument();
  });

  it('모름인데 이유가 없으면 기본 문장', () => {
    renderWith({ supplyTier: 'UNKNOWN', supplyTierBasis: null });
    expect(screen.getByTestId('glance-supply-tier-unclear')).toHaveTextContent(
      '확인 필요 · 1차인지 2·3차인지 생산품만으로는 알 수 없음',
    );
  });

  it('모름이어도 통화 답이 있으면 답만 보인다', () => {
    renderWith({ supplyTier: 'UNKNOWN', supplyTierBasis: '애매함' }, called);
    expect(screen.getByTestId('glance-supply-tier-call')).toBeInTheDocument();
    expect(screen.queryByTestId('glance-supply-tier-unclear')).not.toBeInTheDocument();
  });
});
