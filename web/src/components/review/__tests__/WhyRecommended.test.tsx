// 검토사항 맨 위 "왜 추천했나"(#619): 연결된 공정 이름 + 위 "이 회사 한눈에" 안내. 값이 없으면 줄을 그리지 않는다.
import { render, screen } from '@testing-library/react';
import WhyRecommended from '../WhyRecommended';
import type { DetailHeader, ProcessLinkView } from '../../../api/types';
import { reviewArea } from '../../../labels/ko';

const header = { title: '가상정밀' } as unknown as DetailHeader;
const link = (code: string, name?: string): ProcessLinkView => ({
  linkId: `link-${code}`,
  processCode: code,
  processName: name ?? null,
});

describe('WhyRecommended', () => {
  it('연결된 공정 이름을 겹치지 않게 모아 한 줄로 보인다(이름이 없으면 코드)', () => {
    render(
      <WhyRecommended
        header={header}
        processLinks={[link('ZINC', '아연도금'), link('ZINC', '아연도금'), link('ANODIZING')]}
      />,
    );
    expect(screen.getByTestId('review-why')).toHaveTextContent(reviewArea.whyTitle);
    expect(screen.getByTestId('review-why-processes')).toHaveTextContent(
      '연결된 공정: 아연도금, ANODIZING',
    );
    expect(screen.queryByTestId('review-why-see-glance')).not.toBeInTheDocument();
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
