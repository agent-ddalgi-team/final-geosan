// 상세 "한눈에" 상자(#674): 다섯 묶음(어떤 회사 / 거산과 맞는 점 / 근거 상태 / 확인할 것 / 영업 상태).
// 값이 있을 때와 없을 때. 저장된 값만 보이는 화면 부품 시험이다(서버 호출 없음).
import { render, screen, within } from '@testing-library/react';
import type { DetailHeader, EvidenceView, ProcessLinkView, ReviewItem } from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import DetailGlance, { detailCheckWordsOf } from '../DetailGlance';

const fixtureHeader = detailFixture.data.header as unknown as DetailHeader;
const NOW = new Date('2026-11-13T12:00:00+09:00');

const full: DetailHeader = {
  ...fixtureHeader,
  classificationCode: 'CONDITIONAL_WAIT',
  summaryLine: '산업용 기계부품을 절삭가공하는 회사',
  researchSource: 'AI',
  researchedAt: '2026-11-10T09:00:00+09:00',
  homepageUrl: 'https://example.invalid/',
  homepageStatus: 'AI_FOUND',
  address: '대전광역시 대덕구 대화로 1',
  factoryProfile: {
    rawMaterials: '강판',
    employeeCount: 12,
    scale: '소기업',
    industryName: '절삭가공 및 유사처리업',
    fileDate: '2026-11-11',
  },
  mainPhone: '042-000-0000',
  mainPhoneSource: 'CSV',
  mainPhoneSourceUrl: null,
  highlights: [],
  industries: ['기계·설비'],
  industriesSource: 'STAFF',
  distanceKm: 42,
  fitLevel: 'HIGH',
  coreEvidenceRecheck: true,
};

const link: ProcessLinkView = {
  linkId: 'link-1',
  processCode: 'ZINC_PLATING',
  processName: '아연도금(전기아연도금)',
  appliedMaterial: 'FE',
  result: 'PASS',
};

function evidence(n: number): EvidenceView[] {
  return Array.from({ length: n }, (_, index) => ({
    evidenceId: `ev-${index}`,
    sourceGrade: 'B',
    certainty: 'CONFIRMED',
    isLlmProposed: false,
    quote: `인용 ${index}`,
    sourceRef: '홈페이지',
    subject: 'PRODUCT',
  }));
}

function proposal(code: string, name: string): ReviewItem {
  return {
    itemId: `PL:${code}`,
    kind: 'PROCESS_LINK_PROPOSAL',
    source: 'AI',
    text: `AI 공정 연결 제안 · ${name} · 근거: 인용 없음`,
    checked: false,
  };
}

describe('DetailGlance (#674)', () => {
  it('값이 있으면 다섯 묶음에 회사 설명·맞는 점·근거 상태·확인할 것·영업 상태가 한눈에 보인다', () => {
    render(
      <DetailGlance
        header={full}
        processLinks={[link]}
        evidence={evidence(5)}
        reviewItems={[]}
        requirements={[]}
        contactCount={{ total: 3, call: 2, email: 0, visit: 1 }}
        lastContactAt="2026-11-12"
        now={NOW}
      />,
    );
    const box = screen.getByTestId('detail-glance');
    expect(within(box).getByRole('heading', { level: 2 })).toHaveTextContent('한눈에');

    const company = within(box).getByTestId('glance-company');
    expect(company).toHaveTextContent('어떤 회사');
    expect(company).toHaveTextContent('산업용 기계부품을 절삭가공하는 회사');
    expect(within(company).getByTestId('glance-factory-profile')).toHaveTextContent(
      '대전광역시 대덕구 대화로 1 · 업종 절삭가공 및 유사처리업 · 원자재 강판 · 소기업',
    );
    const homepage = within(company).getByRole('link', { name: /기업 소개 페이지/ });
    expect(homepage).toHaveAttribute('href', 'https://example.invalid/');
    expect(homepage).toHaveAttribute('target', '_blank');
    expect(within(company).getByTestId('company-phone-link')).toHaveTextContent('042-000-0000');
    expect(within(company).getByTestId('company-phone-source')).toHaveTextContent(
      '출처: 공장현황 자료',
    );

    expect(within(box).getByTestId('glance-fit-process')).toHaveTextContent(
      /^공정아연도금\(전기아연도금\) · 확정$/,
    );
    expect(within(box).getByTestId('glance-fit-material')).toHaveTextContent(/^소재철 · 통과$/);
    expect(within(box).getByTestId('glance-fit-industry')).toHaveTextContent(
      /^산업기계·설비 · 확정$/,
    );
    expect(within(box).getByTestId('company-distance')).toHaveTextContent('거산에서 42km');

    expect(within(box).getByTestId('glance-evidence-text')).toHaveTextContent(
      '근거 5건 · 홈페이지 있음 · 적합도 상 · 조사 11/10 (3일 전)',
    );
    expect(within(box).getByTestId('glance-check-text')).toHaveTextContent(/^근거 부족$/);
    expect(within(box).getByTestId('detail-contact-count')).toHaveTextContent(
      '접촉 3회 (전화 2 · 방문 1) · 마지막 접촉 11/12',
    );
    // 읽기만 한다: 단추·입력이 없다(전의 대표번호 [맞음] 단추도 없다).
    expect(within(box).queryByRole('button')).not.toBeInTheDocument();
    expect(within(box).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(box).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('값이 없으면 "아직 조사 전"·"확인 전"·"근거 없음"으로 적고 없는 줄은 줄째 뺀다', () => {
    const empty: DetailHeader = {
      ...full,
      classificationCode: 'NOT_EVALUATED',
      summaryLine: null,
      opportunityItem: '',
      researchSource: null,
      researchedAt: null,
      homepageUrl: null,
      homepageStatus: null,
      address: null,
      factoryProfile: null,
      mainPhone: null,
      industries: [],
      industriesSource: null,
      distanceKm: null,
      fitLevel: null,
      coreEvidenceRecheck: false,
    };
    render(
      <DetailGlance
        header={empty}
        processLinks={[
          { linkId: 'l1', processCode: 'ZINC_PLATING', processName: '아연도금', result: 'PENDING' },
          { linkId: 'l2', processCode: 'ANODIZING', processName: '아노다이징', result: 'PENDING' },
        ]}
        evidence={[]}
        reviewItems={[proposal('ZINC_PLATING', '아연도금'), proposal('ANODIZING', '아노다이징')]}
        requirements={[]}
        contactCount={{ total: 0, call: 0, email: 0, visit: 0 }}
        lastContactAt={null}
        now={NOW}
      />,
    );
    const box = screen.getByTestId('detail-glance');
    expect(within(box).getByTestId('glance-not-researched')).toHaveTextContent('아직 조사 전');
    expect(within(box).queryByTestId('glance-factory-profile')).not.toBeInTheDocument();
    expect(within(box).queryByTestId('company-phone')).not.toBeInTheDocument();
    expect(within(box).queryByTestId('company-distance')).not.toBeInTheDocument();
    expect(within(box).getByTestId('glance-fit-process')).toHaveTextContent(
      '확인 전 · AI 제안 2개(아연도금, 아노다이징)',
    );
    expect(within(box).getByTestId('glance-fit-material')).toHaveTextContent(/^소재확인 전$/);
    expect(within(box).getByTestId('glance-fit-industry')).toHaveTextContent(/^산업확인 전$/);
    expect(within(box).getByTestId('glance-evidence-text')).toHaveTextContent(
      /^근거 없음 · 아직 조사 전$/,
    );
    expect(within(box).getByTestId('glance-check-text')).toHaveTextContent(
      /^공정 · 소재 · 근거 부족$/,
    );
    expect(within(box).getByTestId('detail-contact-count')).toHaveTextContent(/^접촉 없음$/);
  });

  it('홈페이지를 못 찾은 회사는 근거 상태에 "홈페이지 못 찾음 · 근거 없음"을 적는다', () => {
    render(
      <DetailGlance
        header={{ ...full, homepageUrl: null, homepageStatus: 'NOT_FOUND', fitLevel: null }}
        processLinks={[link]}
        evidence={[]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('glance-evidence-text')).toHaveTextContent(
      '근거 없음 · 홈페이지 못 찾음',
    );
    expect(screen.getByTestId('glance-no-homepage')).toBeInTheDocument();
    // 서버가 접촉 횟수를 안 주면 영업 상태 줄은 없다.
    expect(screen.queryByTestId('glance-sales')).not.toBeInTheDocument();
  });

  it('확인할 것이 없으면 "지금 확인할 것 없음", 확인이 필요한 요구는 이름 그대로 붙인다', () => {
    const header = { ...full, coreEvidenceRecheck: false };
    expect(detailCheckWordsOf(header, [link], [], [])).toEqual({
      process: false,
      material: false,
      evidence: false,
      names: [],
    });
    const { rerender } = render(
      <DetailGlance header={header} processLinks={[link]} evidence={evidence(1)} now={NOW} />,
    );
    expect(screen.getByTestId('glance-check-text')).toHaveTextContent('지금 확인할 것 없음');
    rerender(
      <DetailGlance
        header={header}
        processLinks={[{ ...link, appliedMaterial: null, result: 'PENDING' }]}
        evidence={evidence(1)}
        requirements={[
          {
            reqId: 'r1',
            name: 'RoHS',
            reqLevel: 'REQUIRED',
            neededStage: 'NOW',
            result: 'QUESTION_NEEDED',
            reason: '확인 필요',
          },
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('glance-check-text')).toHaveTextContent(/^소재 · RoHS$/);
  });
});
