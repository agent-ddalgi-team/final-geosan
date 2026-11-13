// 검토사항 맨 위 "왜 추천했나"(#619): 공정 한 줄 + 위 "이 회사 한눈에" 안내. 값이 없으면 줄을 그리지 않는다.
// PM 지시 2026-11-13(#659): "공정 적합성 검토" 구역을 빼고 공정·소재·판정을 이 한 줄에 합쳤다.
import { render, screen } from '@testing-library/react';
import WhyRecommended from '../WhyRecommended';
import type { DetailHeader, ProcessLinkView, ReviewItem } from '../../../api/types';
import { reviewArea } from '../../../labels/ko';

const header = { title: '가상정밀' } as unknown as DetailHeader;
const link = (
  code: string,
  name?: string,
  more: Partial<ProcessLinkView> = {},
): ProcessLinkView => ({
  linkId: `link-${code}`,
  processCode: code,
  processName: name ?? null,
  ...more,
});

/** AI 공정 연결 제안 줄(서버 글 모양 그대로). */
const proposal = (code: string, name: string): ReviewItem =>
  ({
    itemId: `PL:${code}`,
    kind: 'PROCESS_LINK_PROPOSAL',
    source: 'AI',
    text: `AI 공정 연결 제안 · ${name} · 근거: 인용 없음`,
    checked: false,
  }) as unknown as ReviewItem;

describe('WhyRecommended', () => {
  it('공정 줄은 확정된 공정만 말한다: AI 제안 줄이 있는 공정은 뺀다(#659)', () => {
    render(
      <WhyRecommended
        header={header}
        processLinks={[link('ZINC', '아연도금'), link('ANODIZING', '아노다이징')]}
        reviewItems={[proposal('ANODIZING', '아노다이징')]}
      />,
    );
    expect(screen.getByTestId('review-why-processes')).toHaveTextContent(/^공정: 아연도금$/);
    expect(screen.queryByTestId('review-why-process-unconfirmed')).not.toBeInTheDocument();
  });

  it('확정된 공정이 없고 AI 제안만 있으면 "공정 확인 전 · AI 제안 n개" 한 줄로 바뀐다(#659)', () => {
    render(
      <WhyRecommended
        header={header}
        processLinks={[
          link('ZINC', '아연도금'),
          link('ANODIZING', '아노다이징'),
          link('BLACK', '흑착색'),
          link('CHROMATE', '크로메이트'),
        ]}
        reviewItems={[
          proposal('ZINC', '아연도금'),
          proposal('ANODIZING', '아노다이징'),
          proposal('BLACK', '흑착색'),
          proposal('CHROMATE', '크로메이트'),
          // 평가 뒤에 생겨 공정 연결 목록에는 아직 없는 제안: 줄 글에서 이름을 읽는다.
          proposal('NICKEL', '니켈도금'),
        ]}
      />,
    );
    expect(screen.queryByTestId('review-why-processes')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-why-process-unconfirmed')).toHaveTextContent(
      /^공정 확인 전 · AI 제안 5개\(아연도금, 아노다이징, 흑착색 외 2개\)$/,
    );
    expect(screen.getByTestId('review-why')).not.toHaveTextContent('공정:');
  });

  it('AI 제안이 이름 수 한도 이하이면 "외 n개" 없이 모두 적는다(#659)', () => {
    render(
      <WhyRecommended
        header={header}
        processLinks={[link('ZINC', '아연도금')]}
        reviewItems={[proposal('ZINC', '아연도금')]}
      />,
    );
    expect(screen.getByTestId('review-why-process-unconfirmed')).toHaveTextContent(
      /^공정 확인 전 · AI 제안 1개\(아연도금\)$/,
    );
  });

  it('확정된 공정이 여럿이면 첫 공정만 적고 겹치지 않게 세어 "외 n개"로 줄인다', () => {
    render(
      <WhyRecommended
        header={header}
        processLinks={[link('ZINC', '아연도금'), link('ZINC', '아연도금'), link('ANODIZING')]}
      />,
    );
    expect(screen.getByTestId('review-why')).toHaveTextContent(reviewArea.whyTitle);
    expect(screen.getByTestId('review-why-processes')).toHaveTextContent(/^공정: 아연도금 외 1개$/);
    // 나머지 공정은 마우스를 올리면 보인다(이름이 없으면 코드).
    expect(screen.getByTestId('review-why-processes')).toHaveAttribute(
      'title',
      '아연도금 / ANODIZING',
    );
    expect(screen.queryByTestId('review-why-see-glance')).not.toBeInTheDocument();
  });

  it('첫 공정의 적용 소재와 판정을 같은 줄에 적는다(빠진 구역 "공정 적합성 검토"가 보이던 값)', () => {
    render(
      <WhyRecommended
        header={header}
        processLinks={[
          link('ZINC', '아연도금(전기아연도금)', {
            appliedMaterial: 'FE',
            result: 'PASS',
            reason: '지금 단계 필수 요구 통과',
          }),
          link('ANODIZING', '아노다이징', { appliedMaterial: 'AL', result: 'EXCLUDED' }),
        ]}
      />,
    );
    const line = screen.getByTestId('review-why-processes');
    expect(line).toHaveTextContent(/^공정: 아연도금\(전기아연도금\) · 소재 철 · 통과 외 1개$/);
    expect(line).toHaveAttribute(
      'title',
      '아연도금(전기아연도금) · 소재 철 · 통과 — 지금 단계 필수 요구 통과 / 아노다이징 · 소재 알루미늄 · 제외',
    );
  });

  it('고른 이유나 공장 정보가 있으면 다시 적지 않고 위 "이 회사 한눈에"를 가리킨다', () => {
    render(
      <WhyRecommended
        header={{ ...header, pickReason: '볼트를 만들어 도금이 필요해 보임', fitLevel: 'HIGH' }}
        processLinks={[]}
      />,
    );
    expect(screen.getByTestId('review-why-see-glance')).toHaveTextContent(reviewArea.whySeeGlance);
    expect(screen.getByTestId('review-why')).not.toHaveTextContent('볼트를 만들어');
    expect(screen.queryByTestId('review-why-processes')).not.toBeInTheDocument();
  });

  it('공장 등록 정보만 있어도 위 칸을 가리킨다', () => {
    render(
      <WhyRecommended
        header={{
          ...header,
          factoryProfile: {
            rawMaterials: '철강',
            employeeCount: null,
            scale: null,
            industryName: '볼트 및 너트류 제조업',
            fileDate: '2026-10-01',
          },
        }}
        processLinks={[]}
      />,
    );
    expect(screen.getByTestId('review-why-see-glance')).toBeInTheDocument();
  });

  it('공정도 고른 이유도 공장 정보도 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <WhyRecommended
        header={{
          ...header,
          pickReason: '  ',
          factoryProfile: {
            rawMaterials: null,
            employeeCount: null,
            scale: null,
            fileDate: '2026-10-01',
          },
        }}
        processLinks={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
