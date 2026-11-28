// 상세 "한눈에"(#674 → #996, PM 결정 2026-11-29): 핵심 줄(어떤 회사 · 맞는 점 · 특징 · 확인할 점) + 위치 + 근거 상태 작은 줄.
// 핵심 줄 수는 고정이 아니다: 근거가 많은 회사(줄 여러 개 + "더 보기"), 적은 회사(한두 줄), 없는 회사(갈래 생략)를 각각 본다.
// 저장된 값만 보이는 화면 부품 시험이다(서버 호출 없음).
// #996에서 자리가 바뀐 기대는 그 자리의 시험으로 옮겼다: 공정 · 소재 · 산업 · 거리 · 홈페이지 → `DetailSummaryRow.test.tsx`,
// 대표번호 · 대표명 → `ContactCard.test.tsx`, 접촉 횟수 → 페이지 시험("기록" 칸 제목 옆).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  DetailHeader,
  EvidenceView,
  ProcessLinkView,
  ReviewItem,
  ScoreItemView,
} from '../../../api/types';
import { detailCompose } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import { statusPalette } from '../../../theme/tokens';
import DetailGlance, { detailCheckWordsOf } from '../DetailGlance';
import { FrameContext } from '../../frame/FrameContext';
import WhyThisCompany, { reasonLineId } from '../WhyThisCompany';

const texts = detailCompose.glance;
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

function item(
  code: string,
  state: string,
  score: number | null,
  summary: string | null,
  ids: string[],
): ScoreItemView {
  return { itemCode: code, label: code, state, weight: 10, score, summary, evidenceIds: ids };
}

/** 근거가 많은 회사의 점수 항목(가상): 맞는 점 2 · 확인할 점(근거 줄) 2 · 시점 신호 4. */
const ITEMS: ScoreItemView[] = [
  item('NEW_PRODUCT', 'CONFIRMED', 25, '볼트를 단조로 만들고 생산공정에 도금이 있습니다.', [
    'ev-0',
  ]),
  item(
    'NEW_MATERIAL',
    'CONFIRMED',
    20,
    '탄소강·합금강이라 아연도금 소재와 맞습니다. 스테인리스 제품도 함께 만듭니다. (홈페이지 볼트)',
    ['ev-1'],
  ),
  item('NEW_RECORD', 'CONFIRMED', 0, '납품 산업이 거산 소개서와 달라 가점이 없습니다.', ['ev-2']),
  item('NEW_PERF', 'UNAVAILABLE', null, '처리 목적이 적혀 있지 않아 미확보입니다.', ['ev-2']),
  item('SIG_EXPAND', 'UNAVAILABLE', null, '2010년 공장을 넓혔습니다. 날짜는 모릅니다.', ['ev-3']),
  item('SIG_ORDER', 'UNAVAILABLE', null, '2026년 인증을 받았습니다.', ['ev-4']),
  item('SIG_BID', 'CONFIRMED', 7, '견적을 요청했습니다.', ['ev-4']),
  item('SIG_HIRE', 'CONFIRMED', 5, '소개서를 받아 보겠다고 했습니다.', ['ev-4']),
];

const question = (text: string): ReviewItem => ({
  itemId: `Q:${text}`,
  kind: 'QUESTION',
  source: 'AI',
  text,
  checked: false,
});

/** 갈래 하나에 지금 보이는 줄 글. */
function shownLines(testId: string): string[] {
  return within(screen.getByTestId(testId))
    .getAllByTestId('glance-key-text')
    .map((line) => line.textContent ?? '');
}

describe('DetailGlance — 근거가 많은 회사 (#996)', () => {
  function renderRich() {
    render(
      <DetailGlance
        header={full}
        processLinks={[link]}
        evidence={evidence(5)}
        reviewItems={[
          question('도금을 자체 설비로 하는지 외주인지'),
          question('철계 볼트의 전기아연도금 물량이 있는지'),
        ]}
        requirements={[]}
        scoreItems={ITEMS}
        now={NOW}
      />,
    );
  }

  it('Given 근거 줄이 많은 회사 When 한눈에 Then 갈래마다 값이 있는 만큼 줄이 보이고 이름표는 갈래에 한 번씩만 있다', () => {
    renderRich();
    const box = screen.getByTestId('detail-glance');
    expect(within(box).getByRole('heading', { level: 2 })).toHaveTextContent(/^한눈에$/);
    expect(within(box).getByTestId('block-heading-bar')).toBeInTheDocument();
    // 이름표(갈래)는 넷, 줄은 그보다 많다. 줄 수는 고정이 아니다.
    const labels = within(within(box).getByTestId('glance-keys')).getAllByRole('term');
    expect(labels.map((label) => label.textContent)).toEqual([
      '어떤 회사',
      texts.fit,
      texts.feature,
      texts.check,
    ]);
    expect(
      ['glance-company', 'glance-key-fit', 'glance-key-feature', 'glance-key-check'].map((id) =>
        screen.getByTestId(id).getAttribute('data-lines'),
      ),
    ).toEqual(['1', '2', '4', '3']);
    // 확인 질문 둘을 넘겼지만 한눈에에는 그 글이 없다(영업 코치 "확인사항"에만 있다, PM 결정 2026-11-29 후속).
    expect(box).not.toHaveTextContent('도금을 자체 설비로 하는지 외주인지');
    expect(box).not.toHaveTextContent('철계 볼트의 전기아연도금 물량이 있는지');

    const company = within(box).getByTestId('glance-company');
    expect(within(company).getByTestId('company-summary-line')).toHaveTextContent(
      '산업용 기계부품을 절삭가공하는 회사',
    );
    // AI가 조사해 적은 한 줄 소개에는 "AI 제안"이 붙는다.
    expect(company).toHaveTextContent('AI 제안');

    // 맞는 점(초록 이름표) 2줄: 확인되고 점수를 얻은 근거 줄마다 첫 문장, 저마다 자기 근거 줄로 잇는다.
    const fit = within(box).getByTestId('glance-key-fit');
    expect(fit).toHaveAttribute('data-tone', 'good');
    expect(within(fit).getByRole('term')).toHaveStyle({ background: statusPalette.ok.bg });
    expect(shownLines('glance-key-fit')).toEqual([
      '탄소강·합금강이라 아연도금 소재와 맞습니다.',
      '볼트를 단조로 만들고 생산공정에 도금이 있습니다.',
    ]);
    expect(
      within(fit)
        .getAllByTestId('glance-key-link')
        .map((el) => el.textContent),
    ).toEqual(['소재 근거 ↓', '제품 근거 ↓']);
    expect(within(fit).queryByTestId('glance-key-more')).not.toBeInTheDocument();
  });

  it('Given 줄이 3줄을 넘는 갈래 When 한눈에 Then 앞 3줄만 보이고 "더 보기 n줄"을 누르면 다 펴지며 다시 누르면 접힌다', async () => {
    const user = userEvent.setup();
    // 확인할 점이 3줄을 넘도록 제품 근거를 "추정(확인 전)"으로 둔다: 낱말 줄 1 + 확보 못 한 근거 줄 3(제품 · 처리 목적 · 납품실적).
    // (확인 질문은 확인할 점에 넣지 않으므로 근거 줄로 줄 수를 채운다, PM 결정 2026-11-29 후속.)
    const manyChecks = ITEMS.map((row) =>
      row.itemCode === 'NEW_PRODUCT' ? { ...row, state: 'STRONG' } : row,
    );
    render(
      <DetailGlance
        header={full}
        processLinks={[link]}
        evidence={evidence(5)}
        reviewItems={[question('도금을 자체 설비로 하는지 외주인지')]}
        requirements={[]}
        scoreItems={manyChecks}
        now={NOW}
      />,
    );
    // 특징 4줄(저장된 특징이 없으니 증설 · 수주 · 구매·외주 의향 · 관심 근거 줄) → 3줄 + 더 보기 1줄.
    const feature = screen.getByTestId('glance-key-feature');
    expect(feature).toHaveAttribute('data-tone', 'neutral');
    expect(shownLines('glance-key-feature')).toEqual([
      '2010년 공장을 넓혔습니다.',
      '2026년 인증을 받았습니다.',
      '견적을 요청했습니다.',
    ]);
    const featureMore = within(feature).getByTestId('glance-key-more');
    expect(featureMore).toHaveTextContent(/^더 보기 1줄$/);
    expect(featureMore).toHaveAttribute('aria-expanded', 'false');

    // 확인할 점(주황 이름표) 4줄: "확인 전" 낱말 줄 + 확보 못 한 근거 줄 3 → 3줄 + 더 보기 1줄.
    const check = screen.getByTestId('glance-key-check');
    expect(check).toHaveAttribute('data-tone', 'warn');
    expect(check).toHaveAttribute('data-lines', '4');
    expect(within(check).getByRole('term')).toHaveStyle({ background: statusPalette.wait.bg });
    expect(shownLines('glance-key-check')).toEqual([
      '확인 전: 근거 부족',
      '볼트를 단조로 만들고 생산공정에 도금이 있습니다.',
      '처리 목적이 적혀 있지 않아 미확보입니다.',
    ]);
    const checkMore = within(check).getByTestId('glance-key-more');
    expect(checkMore).toHaveTextContent(/^더 보기 1줄$/);

    await user.click(checkMore);
    expect(checkMore).toHaveAttribute('aria-expanded', 'true');
    expect(checkMore).toHaveTextContent(/^접기$/);
    expect(shownLines('glance-key-check')).toEqual([
      '확인 전: 근거 부족',
      '볼트를 단조로 만들고 생산공정에 도금이 있습니다.',
      '처리 목적이 적혀 있지 않아 미확보입니다.',
      '납품 산업이 거산 소개서와 달라 가점이 없습니다.',
    ]);
    // 근거 문장에서 온 줄에만 "○○ 근거 ↓"가 붙는다(낱말 줄에는 없다).
    expect(
      within(check)
        .getAllByTestId('glance-key-link')
        .map((el) => el.textContent),
    ).toEqual(['제품 근거 ↓', '처리 목적 근거 ↓', '납품실적 근거 ↓']);
    // 다 펴도 확인 질문은 없다.
    expect(check).not.toHaveTextContent('도금을 자체 설비로 하는지 외주인지');
    // 다른 갈래는 그대로 접혀 있다.
    expect(shownLines('glance-key-feature')).toHaveLength(3);

    await user.click(checkMore);
    expect(shownLines('glance-key-check')).toHaveLength(3);
    expect(checkMore).toHaveTextContent(/^더 보기 1줄$/);

    await user.click(featureMore);
    expect(shownLines('glance-key-feature')).toEqual([
      '2010년 공장을 넓혔습니다.',
      '2026년 인증을 받았습니다.',
      '견적을 요청했습니다.',
      '소개서를 받아 보겠다고 했습니다.',
    ]);
  });

  it('Given 핵심 줄의 "소재 근거 ↓" When 누르면 Then 아래 "왜 이 회사인가"의 소재 줄로 스크롤하고 초점을 옮긴다', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <>
        <DetailGlance
          header={full}
          processLinks={[link]}
          evidence={evidence(5)}
          scoreItems={ITEMS}
          now={NOW}
        />
        <WhyThisCompany
          header={full}
          reasons={{ reason: '', nextAction: '', questions: [] }}
          scoreItems={ITEMS}
          evidence={evidence(5)}
        />
      </>,
    );
    const links = within(screen.getByTestId('glance-key-fit')).getAllByTestId('glance-key-link');
    expect(links[0]).toHaveAttribute('href', `#${reasonLineId('NEW_MATERIAL')}`);
    await user.click(links[0]);
    const target = document.getElementById(reasonLineId('NEW_MATERIAL')) as HTMLElement;
    expect(target).toHaveAttribute('data-testid', 'detail-reason-line');
    expect(within(target).getByTestId('detail-reason-label')).toHaveTextContent(/^소재$/);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(target);
    expect(target).toHaveFocus();
    // 줄마다 자기 근거 줄로 간다: 특징의 둘째 줄(수주).
    await user.click(
      within(screen.getByTestId('glance-key-feature')).getAllByTestId('glance-key-link')[1],
    );
    expect(document.getElementById(reasonLineId('SIG_ORDER'))).toHaveFocus();
  });
});

describe('DetailGlance — 근거가 적은 회사 (#996)', () => {
  it('Given 근거 문장은 없지만 확정 공정 · 통과한 소재가 있고 확인할 것이 없음 When 한눈에 Then 어떤 회사 1줄 · 맞는 점 1줄뿐이고 특징 · 확인할 점 갈래는 없다', () => {
    render(
      <DetailGlance
        header={{ ...full, coreEvidenceRecheck: false }}
        processLinks={[link]}
        evidence={evidence(1)}
        now={NOW}
      />,
    );
    const labels = within(screen.getByTestId('glance-keys')).getAllByRole('term');
    expect(labels.map((label) => label.textContent)).toEqual(['어떤 회사', texts.fit]);
    expect(shownLines('glance-key-fit')).toEqual([
      '공정 아연도금(전기아연도금) 확인됨 · 소재 철 통과',
    ]);
    expect(screen.queryByTestId('glance-key-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('glance-key-more')).not.toBeInTheDocument();
    expect(screen.queryByTestId('glance-key-check')).not.toBeInTheDocument();
    expect(screen.queryByTestId('glance-key-feature')).not.toBeInTheDocument();
    // 줄이 하나인 갈래는 점 목록이 아니다.
    expect(within(screen.getByTestId('glance-key-fit')).getByRole('list')).toHaveStyle({
      listStyle: 'none',
    });
  });

  it('Given 저장된 회사 특징 둘 When 한눈에 Then 특징 갈래에 특징마다 한 줄과 "AI 제안"이 보이고 점 목록으로 그린다', () => {
    render(
      <DetailGlance
        header={{ ...full, highlights: ['아연도금 외주 물량 있음', '2공장 운영'] }}
        processLinks={[link]}
        evidence={[]}
        now={NOW}
      />,
    );
    const feature = screen.getByTestId('glance-key-feature');
    const highlights = within(feature).getByTestId('company-highlights');
    expect(shownLines('glance-key-feature')).toEqual(['아연도금 외주 물량 있음', '2공장 운영']);
    expect(within(highlights).getAllByText('AI 제안')).toHaveLength(2);
    expect(highlights).toHaveStyle({ listStyle: 'disc' });
    expect(within(feature).queryByTestId('glance-key-link')).not.toBeInTheDocument();
  });

  it('Given 한 줄 소개가 없고 생산품만 아는 회사 When 한눈에 Then 공장 자료 기준 소개로 대신한다', () => {
    render(
      <DetailGlance
        header={{ ...full, summaryLine: null, opportunityItem: '육각볼트' }}
        processLinks={[link]}
        evidence={[]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('glance-factory-intro')).toHaveTextContent(
      '육각볼트 생산 (공장 자료 기준)',
    );
  });
});

describe('DetailGlance — 근거가 없는 회사 (#996)', () => {
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
    industries: [],
    industriesSource: null,
    distanceKm: null,
    fitLevel: null,
    coreEvidenceRecheck: false,
  };

  it('Given 평가 전이고 AI 공정 제안뿐인 회사 When 한눈에 Then 어떤 회사는 "아직 조사 전", 맞는 점 · 특징 갈래는 없고 확인할 점 한 줄만 있다', () => {
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
        now={NOW}
      />,
    );
    const box = screen.getByTestId('detail-glance');
    expect(within(box).getByTestId('glance-not-researched')).toHaveTextContent('아직 조사 전');
    expect(within(box).queryByTestId('glance-key-fit')).not.toBeInTheDocument();
    expect(within(box).queryByTestId('glance-key-feature')).not.toBeInTheDocument();
    // 평가 전 회사는 공정 · 소재 · 근거가 모두 확인 전이다.
    expect(shownLines('glance-key-check')).toEqual(['확인 전: 공정 · 소재 · 근거 부족']);
    expect(within(box).queryByTestId('glance-key-link')).not.toBeInTheDocument();
    // 주소도 공장 정보도 고치기도 없으면 위치 줄이 없다.
    expect(within(box).queryByTestId('glance-location')).not.toBeInTheDocument();
    expect(within(box).queryByTestId('glance-factory-profile')).not.toBeInTheDocument();
    expect(within(box).getByTestId('glance-evidence-text')).toHaveTextContent(
      /^근거 없음 · 아직 조사 전$/,
    );
  });

  it('Given 확정 공정도 근거도 확인할 것도 없는 회사 When 한눈에 Then "어떤 회사" 한 줄만 있다(지어내지 않는다)', () => {
    render(
      <DetailGlance
        header={{ ...empty, classificationCode: 'CONDITIONAL_WAIT' }}
        processLinks={[]}
        evidence={[]}
        reviewItems={[]}
        requirements={[]}
        now={NOW}
      />,
    );
    const labels = within(screen.getByTestId('glance-keys')).getAllByRole('term');
    expect(labels.map((label) => label.textContent)).toEqual(['어떤 회사']);
    expect(
      within(screen.getByTestId('glance-keys')).getAllByTestId('glance-key-line'),
    ).toHaveLength(1);
    expect(shownLines('glance-company')).toEqual(['아직 조사 전']);
  });
});

describe('DetailGlance — 위치 (#996)', () => {
  it('Given 주소 · 공장 정보가 있는 회사 When 한눈에 Then 위치 줄에 주소 전체 · 공장 정보 · 지도 링크 둘이 있고 거리 숫자는 여기 없다', () => {
    render(<DetailGlance header={full} processLinks={[link]} evidence={evidence(1)} now={NOW} />);
    const location = screen.getByTestId('glance-location');
    expect(location).toHaveTextContent(texts.location);
    const profile = within(location).getByTestId('glance-factory-profile');
    expect(profile).toHaveTextContent(
      '대전광역시 대덕구 대화로 1 · 업종 절삭가공 및 유사처리업 · 원자재 강판 · 소기업',
    );
    expect(within(profile).getByTestId('detail-map-naver')).toHaveAttribute('target', '_blank');
    expect(within(profile).getByTestId('detail-map-kakao')).toHaveAttribute(
      'rel',
      expect.stringContaining('noopener'),
    );
    // 거리 글("거산에서 42km")은 머리의 요약 줄 한 곳에만 있다. 지도를 못 그릴 때의 거리 그림은 남는다.
    expect(within(location).queryByTestId('detail-distance')).not.toBeInTheDocument();
    expect(within(location).getByTestId('glance-distance-line')).toHaveTextContent('42.0km');
    // 읽기만 한다: 고치기 값을 넘기지 않으면 단추·입력이 없다.
    expect(within(screen.getByTestId('detail-glance')).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId('detail-glance')).queryByRole('textbox')).toBeNull();
  });

  it('Given 고치기 값을 넘김 When 한눈에 Then 위치 줄에 [주소 고치기]가 있고, 주소가 없으면 [주소 넣기]만 보인다', () => {
    const frame = {
      config: null,
      staffKey: 'staff-a',
      setStaffKey: () => {},
      canRecord: true,
      setBannerMeta: () => {},
      setPageTitle: () => {},
    };
    const { unmount } = render(
      <FrameContext.Provider value={frame}>
        <DetailGlance
          header={full}
          processLinks={[link]}
          evidence={evidence(1)}
          now={NOW}
          companyInfo={{ oppId: 'opp-1', onSaved: () => {} }}
        />
      </FrameContext.Provider>,
    );
    expect(
      within(screen.getByTestId('glance-location')).getByTestId('company-address-edit-button'),
    ).toHaveTextContent('주소 고치기');
    unmount();
    render(
      <FrameContext.Provider value={frame}>
        <DetailGlance
          header={{ ...full, address: null, factoryProfile: null }}
          processLinks={[link]}
          evidence={evidence(1)}
          now={NOW}
          companyInfo={{ oppId: 'opp-1', onSaved: () => {} }}
        />
      </FrameContext.Provider>,
    );
    const location = screen.getByTestId('glance-location');
    expect(within(location).getByTestId('company-address-edit-button')).toHaveTextContent(
      '주소 넣기',
    );
    expect(within(location).queryByTestId('detail-map-links')).not.toBeInTheDocument();
  });
});

describe('DetailGlance — 근거 상태 작은 줄 (#674 → #996에서 맨 아래로)', () => {
  it('근거 수 · 홈페이지 · 적합도 · 조사일을 한 줄로 적는다', () => {
    render(<DetailGlance header={full} processLinks={[link]} evidence={evidence(5)} now={NOW} />);
    const line = screen.getByTestId('glance-evidence');
    expect(line).toHaveTextContent(texts.evidenceState);
    expect(within(line).getByTestId('glance-evidence-text')).toHaveTextContent(
      '근거 5건 · 홈페이지 있음 · 적합도 상 · 조사 11/10 (3일 전)',
    );
  });

  it('홈페이지를 못 찾은 회사는 "근거 없음 · 홈페이지 못 찾음"을 적는다', () => {
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
  });

  it('조사한 지 오래됐거나 다시 조사할 때면 꼬리표가 붙는다(낡은 평가 안내)', () => {
    render(
      <DetailGlance
        header={{ ...full, researchStale: true, researchSuggestAgain: true }}
        processLinks={[link]}
        evidence={evidence(1)}
        now={NOW}
      />,
    );
    const line = screen.getByTestId('glance-evidence');
    expect(within(line).getByTestId('company-stale-tag')).toHaveTextContent('오래됨');
    expect(within(line).getByTestId('company-suggest-again-tag')).toHaveTextContent(
      '다시 조사할 때',
    );
  });
});

describe('한눈에서 빠진 것 (#996)', () => {
  it('공정 · 소재 · 산업 · 홈페이지 · 대표번호 · 확인할 것 · 영업 상태 줄은 이 상자에 없다', () => {
    render(
      <DetailGlance
        header={full}
        processLinks={[link]}
        evidence={evidence(5)}
        scoreItems={ITEMS}
        now={NOW}
      />,
    );
    const box = screen.getByTestId('detail-glance');
    for (const id of [
      'glance-fit-process',
      'glance-fit-material',
      'glance-fit-industry',
      'glance-homepage',
      'company-phone',
      'company-representative',
      'glance-check-text',
      'glance-sales',
      'detail-contact-count',
    ]) {
      expect(within(box).queryByTestId(id)).not.toBeInTheDocument();
    }
  });
});

describe('detailCheckWordsOf', () => {
  it('확인할 것이 없으면 모두 거짓, 확인이 필요한 요구는 이름 그대로 돌려준다', () => {
    const header = { ...full, coreEvidenceRecheck: false };
    expect(detailCheckWordsOf(header, [link], [], [])).toEqual({
      process: false,
      material: false,
      evidence: false,
      names: [],
    });
    expect(
      detailCheckWordsOf(
        header,
        [{ ...link, appliedMaterial: null, result: 'PENDING' }],
        [],
        [
          {
            reqId: 'r1',
            name: 'RoHS',
            reqLevel: 'REQUIRED',
            neededStage: 'NOW',
            result: 'QUESTION_NEEDED',
            reason: '확인 필요',
          },
        ],
      ),
    ).toEqual({ process: false, material: true, evidence: false, names: ['RoHS'] });
  });
});
