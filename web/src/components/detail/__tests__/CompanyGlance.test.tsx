// 상세 맨 위 "이 회사 한눈에"(#563): ① 홈페이지(없으면 대신할 링크) ② 소개(없으면 공장 자료) ③ 왜 이 회사·적합도.
// 저장된 값만 보이는 화면 부품 시험이다(서버 호출 없음).
import { render, screen, within } from '@testing-library/react';
import CompanyGlance, { pickGlanceLink } from '../CompanyGlance';
import type { DetailHeader, EvidenceView } from '../../../api/types';
import { companyGlance, factoryProfileLabels } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';

const base = {
  ...(detailFixture.data.header as unknown as DetailHeader),
  homepageUrl: null,
  homepageStatus: null,
  summaryLine: null,
  researchSource: null,
  pickReason: null,
  fitLevel: null,
  discoverySourceUrl: null,
  industries: [],
  opportunityItem: '볼트,스크류',
} satisfies DetailHeader;

function evidence(sourceRef: string, sourceGrade: EvidenceView['sourceGrade']): EvidenceView {
  return {
    evidenceId: `ev-${sourceGrade}-${sourceRef}`,
    sourceGrade,
    certainty: 'STRONG',
    isLlmProposed: true,
    quote: '문장',
    sourceRef,
    subject: 'PRODUCT',
  };
}

describe('이 회사 한눈에(#563)', () => {
  it('찾은 회사는 홈페이지·AI 소개·적합도와 고른 이유를 한 칸에 보인다', () => {
    render(
      <CompanyGlance
        header={{
          ...base,
          homepageUrl: 'http://www.jinhap.com/',
          homepageStatus: 'AI_FOUND',
          summaryLine: '볼트·스크류 등 체결 부품 기업',
          researchSource: 'AI',
          fitLevel: 'HIGH',
          pickReason: '볼트·스크류 생산, 방청 도금·피막처리 수요 높음',
        }}
      />,
    );
    const box = within(screen.getByTestId('company-glance'));
    const link = box.getByRole('link', { name: /기업 소개 페이지/ });
    expect(link).toHaveAttribute('href', 'http://www.jinhap.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(box.getByTestId('company-summary-line')).toHaveTextContent(
      '소개볼트·스크류 등 체결 부품 기업AI 제안',
    );
    const why = within(box.getByTestId('glance-why'));
    expect(why.getByText(companyGlance.fit.HIGH)).toBeInTheDocument();
    expect(why.getByTestId('glance-pick-reason')).toHaveTextContent('방청 도금·피막처리 수요 높음');
    expect(box.queryByText(companyGlance.needsConfirm)).not.toBeInTheDocument();
  });

  it('확신이 낮은 홈페이지에는 "확인 필요"가 붙는다', () => {
    render(
      <CompanyGlance
        header={{
          ...base,
          homepageUrl: 'https://a.example/',
          homepageStatus: 'NEEDS_CONFIRMATION',
        }}
      />,
    );
    expect(screen.getByTestId('glance-homepage')).toHaveTextContent(companyGlance.needsConfirm);
  });

  it('홈페이지가 없으면 검색에서 찾은 페이지, 그것도 없으면 등급이 가장 높은 근거 페이지를 보인다', () => {
    const rows = [
      evidence('https://news.example/c', 'C'),
      evidence('카탈로그', 'A'),
      evidence('https://b.example/b', 'B'),
    ];
    expect(pickGlanceLink({ ...base, discoverySourceUrl: 'https://found.example/' }, rows)).toEqual(
      { kind: 'search', url: 'https://found.example/' },
    );
    expect(pickGlanceLink(base, rows)).toEqual({ kind: 'evidence', url: 'https://b.example/b' });
    expect(pickGlanceLink({ ...base, homepageUrl: 'javascript:alert(1)' }, [])).toBeNull();

    render(<CompanyGlance header={base} evidence={rows} />);
    const fallback = screen.getByTestId('glance-fallback-link');
    expect(fallback).toHaveAttribute('data-kind', 'evidence');
    expect(fallback).toHaveTextContent(`${companyGlance.evidencePage} ↗ https://b.example/b`);
    expect(screen.queryByTestId('detail-homepage')).not.toBeInTheDocument();
  });

  it('링크가 하나도 없으면 "홈페이지를 찾지 못했습니다"만 보인다', () => {
    render(<CompanyGlance header={base} />);
    expect(screen.getByTestId('glance-no-homepage')).toHaveTextContent(companyGlance.noHomepage);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('조사한 소개가 없으면 공장 자료(생산품·업종)로 소개를 만들고 출처를 밝힌다', () => {
    render(<CompanyGlance header={{ ...base, industries: ['기계·설비'] }} />);
    expect(screen.getByTestId('glance-factory-intro')).toHaveTextContent(
      `볼트,스크류 생산 · 기계·설비(${companyGlance.factoryBasis})`,
    );
    expect(screen.queryByTestId('company-summary-line')).not.toBeInTheDocument();
  });

  it('사례 파일 회사(고른 이유·적합도 없음)는 "왜 이 회사" 줄이 없고 소개에 AI 표시가 없다', () => {
    render(
      <CompanyGlance
        header={{ ...base, summaryLine: '가상 기업 소개', researchSource: 'CASE_FILE' }}
      />,
    );
    expect(screen.queryByTestId('glance-why')).not.toBeInTheDocument();
    expect(screen.getByTestId('company-summary-line')).not.toHaveTextContent('AI 제안');
  });
  it('공장 정보가 붙었으면 원자재·종업원 수(추정)·규모와 자료 기준일을 보인다(#573)', () => {
    render(
      <CompanyGlance
        header={{
          ...base,
          factoryProfile: {
            rawMaterials: '철선',
            employeeCount: 76,
            scale: '중기업',
            fileDate: '2026-11-11',
          },
        }}
      />,
    );
    const row = within(screen.getByTestId('glance-factory-profile'));
    expect(row.getByText(factoryProfileLabels.row)).toBeInTheDocument();
    expect(row.getByText('원자재 철선 · 종업원 약 76명(추정) · 중기업')).toBeInTheDocument();
    expect(row.getByText('(팩토리온 11/11 기준)')).toBeInTheDocument();
  });

  it('공장 정보가 없으면 줄을 그리지 않는다(#573)', () => {
    render(<CompanyGlance header={{ ...base, factoryProfile: null }} />);
    expect(screen.queryByTestId('glance-factory-profile')).not.toBeInTheDocument();
  });
});
