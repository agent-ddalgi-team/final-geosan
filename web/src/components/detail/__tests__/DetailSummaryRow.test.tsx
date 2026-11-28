// #996(PM 결정 2026-11-29) 기업 상세 머리의 요약 줄: 산업 · 공정 · 소재 · 위치와 거리 · 홈페이지 + [정보 고치기].
// 값과 확인 표시는 전의 "한눈에 › 거산과 맞는 점"과 같다(전에 `DetailGlance.test.tsx`에 있던 기대를 이 자리로 옮겼다).
// 서버 호출(postProcesses · postMaterial)은 가짜로 바꾼 확인이다(실제 서버 연결 확인 아님). 회사 · 주소는 가상이다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { postMaterial, postProcesses } from '../../../api/client';
import type { DetailHeader, EvidenceView, ProcessLinkView, ReviewItem } from '../../../api/types';
import { detailCompose } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import { detailLayout } from '../../../theme/tokens';
import { FrameContext } from '../../frame/FrameContext';
import DetailSummaryRow, { shortLocationOf } from '../DetailSummaryRow';
import type { DetailSummaryRowProps } from '../DetailSummaryRow';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postProcesses: vi.fn(),
  postMaterial: vi.fn(),
}));

const texts = detailCompose.summary;
const fixtureHeader = detailFixture.data.header as unknown as DetailHeader;

const full: DetailHeader = {
  ...fixtureHeader,
  classificationCode: 'CONDITIONAL_WAIT',
  researchSource: 'AI',
  researchedAt: '2026-11-10T09:00:00+09:00',
  homepageUrl: 'https://example.invalid/',
  homepageStatus: 'AI_FOUND',
  address: '충청남도 천안시 동남구 가상면 가상4길 1',
  industries: ['기계·설비', '건설·건축자재'],
  industriesSource: 'STAFF',
  distanceKm: 15.4,
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

const PROCESS_OPTIONS = [
  { code: 'ZINC_PLATING', name: '아연도금(전기아연도금)' },
  { code: 'NICKEL_PLATING', name: '니켈도금' },
];
const MATERIAL_OPTIONS = [
  { code: 'FE', name: '철' },
  { code: 'AL', name: '알루미늄' },
];

function renderRow(props: Partial<DetailSummaryRowProps> = {}, canRecord = true) {
  const onSaved = vi.fn();
  render(
    <FrameContext.Provider
      value={{
        config: null,
        staffKey: canRecord ? 'staff-a' : 'viewer',
        setStaffKey: () => {},
        canRecord,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <DetailSummaryRow
        oppId="opp-1"
        evalId="eval-1"
        header={full}
        processLinks={[link]}
        evidence={evidence(1)}
        reviewItems={[]}
        onSaved={onSaved}
        {...props}
      />
    </FrameContext.Provider>,
  );
  return onSaved;
}

beforeEach(() => {
  vi.mocked(postProcesses).mockReset();
  vi.mocked(postMaterial).mockReset();
});

describe('shortLocationOf — 요약 줄의 짧은 위치', () => {
  it.each([
    ['충청남도 천안시 동남구 가상면 가상4길 1', '천안시 동남구'],
    ['경기도 화성시 가상읍 가상로 10', '화성시'],
    ['서울특별시 강남구 가상로 1', '서울특별시 강남구'],
    ['충남 천안시 서북구 가상로 1', '천안시 서북구'],
    ['서울 강남구 가상로 1', '서울 강남구'],
    ['충청북도 가상군 가상면 가상길 3', '가상군'],
    // 시·군·구를 알아볼 수 없는 주소는 받은 그대로 보인다(지어내지 않는다).
    ['가상로 10', '가상로 10'],
    ['충청남도', '충청남도'],
  ])('"%s" → "%s"', (address, expected) => {
    expect(shortLocationOf(address)).toBe(expected);
  });
});

describe('요약 줄 — 값과 확인 표시 (#996)', () => {
  it('Given 확인된 산업 · 확정 공정 · 통과한 소재 · 주소와 거리 · 홈페이지 When 요약 줄 Then 한 칸에 다섯 가지가 값과 표시로 보인다', () => {
    renderRow();
    const row = screen.getByRole('group', { name: texts.aria });
    expect(row).toHaveStyle({ background: detailLayout.summaryBg });

    // 사람이 확인한 값(사례 파일·담당자 확정)에만 초록 ✓가 붙는다. 색이 아니라 표시 종류와 글자로 확인한다.
    const industry = within(row).getByTestId('glance-fit-industry');
    expect(industry).toHaveTextContent(/^산업기계·설비 · 건설·건축자재 ✓확인됨$/);
    expect(within(industry).getByTestId('glance-fit-mark')).toHaveAttribute(
      'data-mark',
      'confirmed',
    );
    const process = within(row).getByTestId('glance-fit-process');
    expect(process).toHaveTextContent(/^공정아연도금\(전기아연도금\) ✓확인됨$/);
    expect(within(process).getByRole('img')).toHaveAccessibleName('확인됨 (사람이 확인한 값)');
    const material = within(row).getByTestId('glance-fit-material');
    expect(material).toHaveTextContent(/^소재철 ✓통과$/);
    expect(within(material).getByTestId('glance-fit-mark')).toHaveAttribute(
      'data-mark',
      'confirmed',
    );

    // 위치는 시·군·구까지만 짧게, 전체 주소는 손을 올리면 보인다. 거리는 계산한 숫자라 확인 표시가 없다.
    const location = within(row).getByTestId('detail-summary-location');
    expect(location).toHaveTextContent(/^위치천안시 동남구 · 거산에서 15\.4km$/);
    expect(within(location).getByTestId('detail-summary-address')).toHaveAttribute(
      'title',
      '충청남도 천안시 동남구 가상면 가상4길 1',
    );
    expect(within(location).queryByTestId('glance-fit-mark')).not.toBeInTheDocument();

    const homepage = within(row).getByRole('link', { name: /홈페이지/ });
    expect(homepage).toHaveAttribute('href', 'https://example.invalid/');
    expect(homepage).toHaveAttribute('target', '_blank');
    expect(homepage).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('Given 값이 없는 회사(AI 공정 제안뿐) When 요약 줄 Then "확인 전"과 회색 ○ "AI 제안 · 확인 전"으로 적는다', () => {
    renderRow({
      header: {
        ...full,
        classificationCode: 'NOT_EVALUATED',
        researchedAt: null,
        homepageUrl: null,
        homepageStatus: null,
        address: null,
        industries: [],
        industriesSource: null,
        distanceKm: null,
      },
      processLinks: [
        { linkId: 'l1', processCode: 'ZINC_PLATING', processName: '아연도금', result: 'PENDING' },
        { linkId: 'l2', processCode: 'ANODIZING', processName: '아노다이징', result: 'PENDING' },
      ],
      evidence: [],
      reviewItems: [proposal('ZINC_PLATING', '아연도금'), proposal('ANODIZING', '아노다이징')],
    });
    // AI가 제안만 한 공정은 초록이 아니라 중립 표시 ○ "AI 제안 · 확인 전"이다.
    const process = screen.getByTestId('glance-fit-process');
    expect(process).toHaveTextContent(/^공정아연도금, 아노다이징 ○AI 제안 · 확인 전$/);
    expect(within(process).getByTestId('glance-fit-mark')).toHaveAttribute('data-mark', 'ai');
    expect(within(process).getByRole('img')).toHaveAccessibleName(
      'AI 제안 · 확인 전 (사람이 확인하기 전)',
    );
    // 값이 없으면 표시 없이 "확인 전".
    const material = screen.getByTestId('glance-fit-material');
    expect(material).toHaveTextContent(/^소재확인 전$/);
    expect(within(material).queryByTestId('glance-fit-mark')).not.toBeInTheDocument();
    expect(screen.getByTestId('glance-fit-industry')).toHaveTextContent(/^산업확인 전$/);
    expect(screen.getByTestId('detail-summary-location')).toHaveTextContent(/^위치확인 전$/);
    expect(screen.queryByTestId('detail-distance')).not.toBeInTheDocument();
    expect(screen.getByTestId('glance-no-homepage')).toHaveTextContent('아직 조사 전');
  });

  it('Given AI가 붙인 산업 · 통과가 아닌 소재 When 요약 줄 Then 산업은 중립 표시, 소재는 초록 체크 없이 글자만 보인다', () => {
    renderRow({
      header: { ...full, industries: ['기계·설비'], industriesSource: 'AI' },
      processLinks: [{ ...link, result: 'PENDING' }],
    });
    const industry = screen.getByTestId('glance-fit-industry');
    expect(industry).toHaveTextContent(/^산업기계·설비 ○AI 제안 · 확인 전$/);
    expect(within(industry).getByTestId('glance-fit-mark')).toHaveAttribute('data-mark', 'ai');
    const material = screen.getByTestId('glance-fit-material');
    expect(material).toHaveTextContent(/^소재철 · 확인 대기$/);
    expect(within(material).queryByTestId('glance-fit-mark')).not.toBeInTheDocument();
    // 초록 체크는 확정된 공정 한 곳뿐이다.
    expect(
      screen.getAllByTestId('glance-fit-mark').filter((el) => el.dataset.mark === 'confirmed'),
    ).toHaveLength(1);
  });

  it('Given 거리를 모르는 회사 When 요약 줄 Then 위치만 보이고 거리는 없다', () => {
    renderRow({ header: { ...full, distanceKm: null } });
    expect(screen.getByTestId('detail-summary-location')).toHaveTextContent(/^위치천안시 동남구$/);
    expect(screen.queryByTestId('detail-distance')).not.toBeInTheDocument();
  });
});

describe('요약 줄 — 홈페이지 (#511 · #793)', () => {
  it('회사 블로그 페이지면 링크 옆에 확인 필요·이유·확신도가 보인다', () => {
    renderRow({
      header: {
        ...full,
        homepageUrl: 'https://blog.example.invalid/company',
        homepageStatus: 'NEEDS_CONFIRMATION',
        homepageConfidence: 0.3,
        homepagePageKind: 'BLOG',
      },
    });
    expect(within(screen.getByTestId('detail-homepage')).getByRole('link')).toHaveAttribute(
      'href',
      'https://blog.example.invalid/company',
    );
    expect(screen.getByTestId('glance-homepage-unofficial')).toHaveTextContent(
      /^확인 필요 · 공식 홈페이지는 못 찾았고 회사 블로그 페이지 · 확신도 0\.3$/,
    );
  });

  it('확신도가 없으면 확인 필요와 이유만 보인다', () => {
    renderRow({
      header: {
        ...full,
        homepageStatus: 'NEEDS_CONFIRMATION',
        homepageConfidence: null,
        homepagePageKind: 'PUBLIC_PAGE',
      },
    });
    expect(screen.getByTestId('glance-homepage-unofficial')).toHaveTextContent(
      /^확인 필요 · 공식 홈페이지는 못 찾았고 공공·지자체의 회사 소개 페이지$/,
    );
  });

  it.each<[string, Partial<DetailHeader>]>([
    ['공식 홈페이지', { homepageStatus: 'AI_FOUND', homepageConfidence: 0.9 }],
    [
      '확신도가 낮을 뿐인 공식 홈페이지(종류 없음)',
      { homepageStatus: 'NEEDS_CONFIRMATION', homepageConfidence: 0.4 },
    ],
    [
      '담당자가 맞음으로 확인한 주소(종류 값이 남아 있어도)',
      { homepageStatus: 'CONFIRMED', homepagePageKind: 'BLOG' },
    ],
  ])('%s에는 확인 필요 줄이 없다', (_name, patch) => {
    renderRow({ header: { ...full, ...patch } });
    expect(screen.queryByTestId('glance-homepage-unofficial')).toBeNull();
  });

  it('조사가 홈페이지를 닫힌 것으로 봤으면 닫힌 이유를 보인다', () => {
    renderRow({
      header: {
        ...full,
        homepageUrl: null,
        homepageStatus: 'NOT_FOUND',
        homepageClosedReason: '호스팅 만료',
      },
      evidence: [],
    });
    expect(screen.getByTestId('glance-homepage-closed')).toHaveTextContent(
      '홈페이지가 닫혀 있습니다(호스팅 만료)',
    );
    expect(screen.queryByTestId('glance-no-homepage')).not.toBeInTheDocument();
  });

  it('홈페이지를 못 찾았고 닫힌 이유가 없으면 "홈페이지를 찾지 못했습니다"', () => {
    renderRow({
      header: { ...full, homepageUrl: null, homepageStatus: 'NOT_FOUND' },
      evidence: [],
    });
    expect(screen.queryByTestId('glance-homepage-closed')).not.toBeInTheDocument();
    expect(screen.getByTestId('glance-no-homepage')).toHaveTextContent(
      '홈페이지를 찾지 못했습니다',
    );
  });

  it('홈페이지 주소가 http가 아니면 링크로 만들지 않는다', () => {
    renderRow({ header: { ...full, homepageUrl: 'javascript:alert(1)' }, evidence: [] });
    expect(screen.queryByTestId('detail-homepage')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('glance-homepage')).queryByRole('link')).toBeNull();
  });
});

describe('요약 줄 — [정보 고치기] (#996)', () => {
  it('Given 접힌 요약 줄 When [정보 고치기]를 누르면 Then 바로 아래에 공정 · 소재 · 산업 · 홈페이지 고치기 줄이 펼쳐지고 다시 누르면 접힌다', async () => {
    const user = userEvent.setup();
    renderRow({
      processOptions: PROCESS_OPTIONS,
      materialOptions: MATERIAL_OPTIONS,
      industryEditor: <span data-testid="industry-editor-slot">산업 칩</span>,
    });
    const toggle = screen.getByTestId('detail-summary-fix-toggle');
    expect(toggle).toHaveTextContent(texts.fixOpen);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 접혀 있을 때는 고치기 단추가 화면에 없다.
    expect(screen.queryByTestId('detail-summary-fix-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('process-edit-button')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent(texts.fixClose);
    const panel = screen.getByRole('region', { name: texts.fixPanel });
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
    // 요약 줄 바로 다음에 놓인다.
    expect(
      screen.getByTestId('detail-summary-row').compareDocumentPosition(panel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(within(panel).getByTestId('detail-summary-fix-process')).getByTestId(
        'process-edit-button',
      ),
    ).toHaveTextContent('고치기');
    expect(
      within(within(panel).getByTestId('detail-summary-fix-material')).getByTestId(
        'material-edit-button',
      ),
    ).toHaveTextContent('고치기');
    expect(
      within(within(panel).getByTestId('detail-summary-fix-industry')).getByTestId(
        'industry-editor-slot',
      ),
    ).toBeInTheDocument();
    // 홈페이지 줄에는 주소 전체와 다시 찾는 방법이 적힌다.
    expect(within(panel).getByTestId('detail-summary-homepage-url')).toHaveTextContent(
      'https://example.invalid/',
    );
    expect(within(panel).getByTestId('detail-summary-homepage-how')).toHaveTextContent(
      texts.homepageHow,
    );

    await user.click(toggle);
    expect(screen.queryByTestId('detail-summary-fix-panel')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('Given 펼친 고치기 칸 When 공정을 하나 더 골라 [저장] Then 고른 공정 전체를 보내고 상세를 다시 읽게 알린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postProcesses).mockResolvedValueOnce({
      data: { processCodes: ['ZINC_PLATING', 'NICKEL_PLATING'] },
      meta: { reevaluated: true },
    });
    const onSaved = renderRow({ processOptions: PROCESS_OPTIONS });
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    await user.click(screen.getByTestId('process-edit-button'));
    expect(screen.getByRole('checkbox', { name: '아연도금(전기아연도금)' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: '니켈도금' }));
    await user.click(screen.getByTestId('process-save-button'));
    await waitFor(() =>
      expect(postProcesses).toHaveBeenCalledWith(
        'opp-1',
        ['ZINC_PLATING', 'NICKEL_PLATING'],
        'staff-a',
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('Given 펼친 고치기 칸 When 소재를 알루미늄으로 바꿔 [저장] Then 그 소재를 보내고 상세를 다시 읽게 알린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postMaterial).mockResolvedValueOnce({
      data: { material: 'AL' },
      meta: { reevaluated: true },
    } as unknown as Awaited<ReturnType<typeof postMaterial>>);
    const onSaved = renderRow({ materialOptions: MATERIAL_OPTIONS });
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    await user.click(screen.getByTestId('material-edit-button'));
    await user.click(screen.getByRole('radio', { name: '알루미늄' }));
    await user.click(screen.getByTestId('material-save-button'));
    await waitFor(() => expect(postMaterial).toHaveBeenCalledWith('opp-1', 'AL', 'staff-a'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('Given 서버가 공정 저장을 거부 When [저장] Then 실패를 알리고 고르던 칸을 그대로 둔다', async () => {
    const user = userEvent.setup();
    vi.mocked(postProcesses).mockRejectedValueOnce(new Error('network'));
    const onSaved = renderRow({ processOptions: PROCESS_OPTIONS });
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    await user.click(screen.getByTestId('process-edit-button'));
    await user.click(screen.getByRole('checkbox', { name: '니켈도금' }));
    await user.click(screen.getByTestId('process-save-button'));
    expect(await screen.findByTestId('process-save-error')).toHaveTextContent(
      '공정을 저장하지 못했습니다.',
    );
    expect(screen.getByTestId('process-edit')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Given 보기가 없는 옛 설정 응답 When 펼치면 Then 공정 · 소재 줄에 [고치기]가 없다', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    expect(screen.queryByTestId('process-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('material-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detail-summary-fix-industry')).not.toBeInTheDocument();
  });

  it('Given 보기 전용 When 펼치면 Then [고치기] 단추가 잠겨 있다', async () => {
    const user = userEvent.setup();
    renderRow({ processOptions: PROCESS_OPTIONS, materialOptions: MATERIAL_OPTIONS }, false);
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    expect(screen.getByTestId('process-edit-button')).toBeDisabled();
    expect(screen.getByTestId('material-edit-button')).toBeDisabled();
  });

  it('Given 확정 공정이 없는 회사 When 소재 [고치기] Then "공정을 먼저 골라 주세요"', async () => {
    const user = userEvent.setup();
    renderRow({ processLinks: [], materialOptions: MATERIAL_OPTIONS });
    await user.click(screen.getByTestId('detail-summary-fix-toggle'));
    await user.click(screen.getByTestId('material-edit-button'));
    expect(screen.getByTestId('material-need-process')).toHaveTextContent(
      '공정을 먼저 골라 주세요',
    );
  });
});

describe('요약 줄 — "AI는 다르게 봄" (#677)', () => {
  it('Given 확정 공정이 있는데 AI가 다른 공정을 제안 When 요약 줄 Then 고치기 칸을 펴지 않아도 줄 아래에 늘 보인다', () => {
    renderRow({
      processLinks: [
        link,
        { linkId: 'l2', processCode: 'NICKEL_PLATING', processName: '니켈도금', result: 'PENDING' },
      ],
      reviewItems: [proposal('NICKEL_PLATING', '니켈도금')],
    });
    expect(screen.queryByTestId('detail-summary-fix-panel')).not.toBeInTheDocument();
    const difference = screen.getByTestId('glance-process-difference');
    expect(difference).toHaveTextContent('AI 새 제안: 니켈도금 · 확정 값: 아연도금(전기아연도금)');
    expect(within(difference).getByTestId('glance-process-keep')).toBeEnabled();
    expect(within(difference).getByTestId('glance-process-add')).toHaveTextContent(
      '니켈도금도 추가',
    );
  });

  it('Given AI 제안이 없는 회사 When 요약 줄 Then 그 줄이 없다', () => {
    renderRow();
    expect(screen.queryByTestId('glance-process-difference')).not.toBeInTheDocument();
  });
});
