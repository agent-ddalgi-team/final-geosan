// #985 영업 분석 "상대 반응 — 거산의 강점 · 약점" 카드. 요청 함수만 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// 파이 세 개의 숫자 · 범례 순서, [이것만 보기], [공정별], 조각 · 범례 줄 누르기, 표본이 적을 때, 빈 상태,
// 읽기 실패와 [다시 시도], 보기 글을 질문 묶음에서 가져오는지를 본다. 회사 이름·숫자는 모두 가상이다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ReactionAnalysis from '../ReactionAnalysis';
import { getSalesReactions } from '../../../api/salesAnalysis';
import type { ReactionContact, SalesReactions } from '../../../api/salesAnalysis';
import { getSalesQuestions } from '../../../api/client';
import { REACTION_QUESTIONS, REACTION_SAMPLE } from '../../../test/reactionSample';
import { reactionPalette } from '../../../theme/tokens';

vi.mock('../../../api/salesAnalysis', async (original) => ({
  ...(await original<typeof import('../../../api/salesAnalysis')>()),
  getSalesReactions: vi.fn(),
}));
vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getSalesQuestions: vi.fn(),
}));

const PERIOD = { from: '2026-09-01', to: '2026-11-29' };

function given(data: SalesReactions = REACTION_SAMPLE, questions: 'ok' | 'fail' = 'ok') {
  vi.mocked(getSalesReactions).mockResolvedValue({ data, meta: {} } as never);
  if (questions === 'ok') {
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: REACTION_QUESTIONS, meta: {} } as never);
  } else {
    vi.mocked(getSalesQuestions).mockRejectedValue(new Error('질문 묶음을 못 읽음'));
  }
}

function renderCard() {
  return render(
    <MemoryRouter>
      <ReactionAnalysis period={PERIOD} reloadKey={0} />
    </MemoryRouter>,
  );
}

/** 파이 한 칸의 범례 줄 글자(위에서부터). */
function legendTexts(pieId: string): string[] {
  return within(screen.getByTestId(pieId))
    .getAllByTestId(`${pieId}-legend-row`)
    .map((row) => row.textContent ?? '');
}

function legendRow(pieId: string, key: string): HTMLElement {
  const row = within(screen.getByTestId(pieId))
    .getAllByTestId(`${pieId}-legend-row`)
    .find((item) => item.getAttribute('data-key') === key);
  if (!row) throw new Error(`범례 줄이 없음: ${pieId} ${key}`);
  return row;
}

function splitRow(name: string): HTMLElement {
  const row = screen
    .getAllByTestId('reaction-split-row')
    .find((item) => within(item).getByRole('rowheader').textContent === name);
  if (!row) throw new Error(`표에 줄이 없음: ${name}`);
  return row;
}

describe('영업 분석 › 상대 반응 카드 (#985)', () => {
  afterEach(() => vi.clearAllMocks());

  it('Given 반응 34건 When 카드를 열면 Then 제목 · 기준 줄과 파이 세 개의 건수 · 비율이 서버가 준 순서로 보인다', async () => {
    given();
    renderCard();
    // 기간 고르기와 같은 기간으로 묻는다.
    expect(await screen.findByTestId('reaction-pies')).toBeInTheDocument();
    expect(vi.mocked(getSalesReactions).mock.calls[0][1]).toEqual(PERIOD);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      '상대 반응 — 거산의 강점 · 약점',
    );
    expect(screen.getByTestId('reaction-basis')).toHaveTextContent(
      '통화 · 메일 · 대면 41건 가운데 반응을 남긴 34건',
    );
    // 보기 글은 질문 묶음에서 온다(시험 뒤쪽 줄이 못 읽었을 때를 본다).
    await screen.findByText('긍정적');
    expect(legendTexts('reaction-pie-reaction')).toEqual([
      '긍정적14건41%',
      '보통9건26%',
      '부정적11건32%',
    ]);
    expect(screen.getByTestId('reaction-pie-reaction-sub')).toHaveTextContent(
      '반응을 남긴 접촉 34건',
    );
    expect(legendTexts('reaction-pie-good')).toEqual([
      '품질·인증6건43%',
      '공정·기술4건29%',
      '납기3건21%',
      '대응·신뢰1건7%',
    ]);
    expect(screen.getByTestId('reaction-pie-good-sub')).toHaveTextContent('긍정적 14건 가운데');
    expect(legendTexts('reaction-pie-bad')).toEqual([
      '가격4건36%',
      '기존 거래처3건27%',
      '클레임(불량·납기)2건18%',
      '거리·물류2건18%',
    ]);
    expect(screen.getByTestId('reaction-pie-bad-sub')).toHaveTextContent('부정적 11건 가운데');
    expect(screen.queryByTestId('reaction-small-sample')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reaction-detail')).not.toBeInTheDocument();
  });

  it('Given 파이 When 화면 읽기 도구로 읽으면 Then 그림마다 "이름 건수"가 읽히고 조각마다 이름 · 건수 · 비율 풀이가 있다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    expect(screen.getByRole('img', { name: '긍정적 14건, 보통 9건, 부정적 11건' })).toBe(
      screen.getByTestId('reaction-pie-reaction-svg'),
    );
    const slices = screen.getAllByTestId('reaction-pie-bad-slice');
    expect(slices).toHaveLength(4);
    expect(slices[0].querySelector('title')).toHaveTextContent('가격 · 4건 · 36%');
    // 조각은 12시에서 시작한다(가운데 → 맨 위 점).
    const center = (reactionPalette.pieSize / 2).toFixed(2);
    expect(slices[0].getAttribute('d')?.startsWith(`M${center} ${center} L${center} 1.00 `)).toBe(
      true,
    );
  });

  it('Given 산업별 표 When 열면 Then 진짜 표에 접촉 · 반응 건수 · 가장 좋게 본 부분 · 가장 걸린 부분이 보인다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    expect(screen.getByTestId('reaction-tab-industry')).toHaveAttribute('aria-pressed', 'true');
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['산업', '접촉', '반응', '가장 좋게 본 부분', '가장 걸린 부분', '고르기']);
    expect(screen.getAllByTestId('reaction-split-row')).toHaveLength(4);
    const car = splitRow('자동차 부품');
    expect(car).toHaveTextContent('15건');
    expect(car).toHaveTextContent('긍정 5 · 보통 3 · 부정 7');
    expect(
      within(car).getByRole('img', { name: '긍정 5건, 보통 3건, 부정 7건' }),
    ).toBeInTheDocument();
    expect(car).toHaveTextContent('품질·인증 3건');
    expect(car).toHaveTextContent('가격 3건');
    expect(within(car).getByTestId('reaction-split-only')).toHaveTextContent('이것만 보기');
  });

  it('Given 산업별 표 When "자동차 부품" [이것만 보기]를 누르면 Then 파이 세 개가 그 줄 값으로 바뀌고 꼬리표가 붙으며, ×를 누르면 전체로 돌아온다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    // When
    await userEvent.click(
      within(splitRow('자동차 부품')).getByRole('button', { name: '자동차 부품만 보기' }),
    );
    // Then
    expect(screen.getByTestId('reaction-scope-chip')).toHaveTextContent('자동차 부품만 보는 중');
    expect(legendTexts('reaction-pie-reaction')).toEqual([
      '긍정적5건33%',
      '보통3건20%',
      '부정적7건47%',
    ]);
    expect(screen.getByTestId('reaction-pie-reaction-sub')).toHaveTextContent(
      '반응을 남긴 접촉 15건',
    );
    expect(legendTexts('reaction-pie-good')).toEqual([
      '품질·인증3건60%',
      '납기1건20%',
      '공정·기술1건20%',
    ]);
    expect(legendTexts('reaction-pie-bad')[0]).toBe('가격3건43%');
    const row = splitRow('자동차 부품');
    expect(row).toHaveAttribute('data-viewing', 'true');
    expect(within(row).getByTestId('reaction-split-only')).toHaveTextContent('보는 중');
    expect(within(row).getByTestId('reaction-split-only')).toHaveAttribute('aria-pressed', 'true');
    expect(within(splitRow('기계·설비')).getByTestId('reaction-split-only')).toHaveTextContent(
      '이것만 보기',
    );
    // When ×
    await userEvent.click(screen.getByRole('button', { name: '전체로 돌아가기' }));
    // Then
    expect(screen.queryByTestId('reaction-scope-chip')).not.toBeInTheDocument();
    expect(legendTexts('reaction-pie-reaction')[0]).toBe('긍정적14건41%');
  });

  it('Given 한 줄을 보는 중 When [보는 중]을 다시 누르면 Then 전체로 돌아온다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(within(splitRow('기계·설비')).getByTestId('reaction-split-only'));
    expect(legendTexts('reaction-pie-reaction')[0]).toBe('긍정적6건60%');
    await userEvent.click(within(splitRow('기계·설비')).getByTestId('reaction-split-only'));
    expect(screen.queryByTestId('reaction-scope-chip')).not.toBeInTheDocument();
    expect(legendTexts('reaction-pie-reaction')[0]).toBe('긍정적14건41%');
  });

  it('Given 나눠 보기 When [공정별]을 누르면 Then 공정 줄 표로 바뀌고, 공정 줄 [이것만 보기]도 파이를 바꾼다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(screen.getByRole('button', { name: '공정별' }));
    expect(screen.getByTestId('reaction-tab-process')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('공정');
    expect(screen.getByTestId('reaction-split-hint')).toHaveTextContent(
      '공정이 둘인 회사의 접촉은 두 줄에 모두 셉니다',
    );
    const zinc = splitRow('아연도금(전기아연도금)');
    expect(zinc).toHaveTextContent('18건');
    expect(zinc).toHaveTextContent('긍정 8 · 보통 5 · 부정 5');
    // 좋게 본 부분이 없는 줄은 "—".
    const none = splitRow('공정 확인 전');
    expect(within(none).getAllByRole('cell')[2]).toHaveTextContent('—');
    expect(within(none).getAllByRole('cell')[3]).toHaveTextContent('가격 1건');
    await userEvent.click(within(zinc).getByTestId('reaction-split-only'));
    expect(screen.getByTestId('reaction-scope-chip')).toHaveTextContent(
      '아연도금(전기아연도금)만 보는 중',
    );
    expect(legendTexts('reaction-pie-reaction')).toEqual([
      '긍정적8건44%',
      '보통5건28%',
      '부정적5건28%',
    ]);
  });

  it('Given "자동차 부품"만 보는 중 When 걸린 부분 "가격" 범례 줄을 누르면 Then 아래에 제목 · 공정별 건수 · 회사 링크가 펼쳐지고, 다시 누르면 닫힌다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(within(splitRow('자동차 부품')).getByTestId('reaction-split-only'));
    // When
    await userEvent.click(legendRow('reaction-pie-bad', 'PRICE'));
    // Then
    expect(legendRow('reaction-pie-bad', 'PRICE')).toHaveAttribute('aria-pressed', 'true');
    const detail = screen.getByTestId('reaction-detail');
    expect(within(detail).getByTestId('reaction-detail-title')).toHaveTextContent(
      '걸린 부분 › 가격 · 자동차 부품 3건',
    );
    expect(detail).toHaveTextContent('공정별');
    expect(within(detail).getByTestId('reaction-detail-parts')).toHaveTextContent(
      '아연도금(전기아연도금) 2건 · 니켈도금 1건',
    );
    expect(
      within(detail)
        .getAllByTestId('reaction-detail-contact')
        .map((item) => item.textContent),
    ).toEqual(['R테크(가상) 11/26 메일 ·', 'M정밀(가상) 11/24 대면 ·', 'K산업(가상) 11/20 통화']);
    const links = within(detail).getAllByTestId('reaction-detail-link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/opportunities/opp-r',
      '/opportunities/opp-m',
      '/opportunities/opp-k',
    ]);
    // When 다시 누르면
    await userEvent.click(legendRow('reaction-pie-bad', 'PRICE'));
    // Then
    expect(screen.queryByTestId('reaction-detail')).not.toBeInTheDocument();
    expect(legendRow('reaction-pie-bad', 'PRICE')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Given 전체를 보는 중 When 걸린 부분 "가격" 조각을 누르면 Then 묶음 이름 없는 제목과 산업별 건수가 보이고, 조각을 다시 누르면 닫힌다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    const slice = screen.getAllByTestId('reaction-pie-bad-slice')[0];
    await userEvent.click(slice);
    const detail = screen.getByTestId('reaction-detail');
    expect(within(detail).getByTestId('reaction-detail-title')).toHaveTextContent(
      /^걸린 부분 › 가격 4건$/,
    );
    expect(detail).toHaveTextContent('산업별');
    expect(within(detail).getByTestId('reaction-detail-parts')).toHaveTextContent(
      '자동차 부품 3건 · 산업 확인 전 1건',
    );
    expect(within(detail).getAllByTestId('reaction-detail-contact')).toHaveLength(4);
    await userEvent.click(screen.getAllByTestId('reaction-pie-bad-slice')[0]);
    expect(screen.queryByTestId('reaction-detail')).not.toBeInTheDocument();
  });

  it('Given 공정 한 줄을 보는 중 When 조각을 누르면 Then 산업별 건수가 보인다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(screen.getByTestId('reaction-tab-process'));
    await userEvent.click(
      within(splitRow('아연도금(전기아연도금)')).getByTestId('reaction-split-only'),
    );
    await userEvent.click(legendRow('reaction-pie-bad', 'PRICE'));
    const detail = screen.getByTestId('reaction-detail');
    expect(within(detail).getByTestId('reaction-detail-title')).toHaveTextContent(
      '걸린 부분 › 가격 · 아연도금(전기아연도금) 2건',
    );
    expect(detail).toHaveTextContent('산업별');
    expect(within(detail).getByTestId('reaction-detail-parts')).toHaveTextContent(
      '자동차 부품 2건',
    );
    expect(
      within(detail)
        .getAllByTestId('reaction-detail-link')
        .map((link) => link.textContent),
    ).toEqual(['M정밀(가상)', 'K산업(가상)']);
  });

  it('Given 반응 파이 When "보통" 줄을 누르면 Then 그 반응의 접촉 줄이 펼쳐지고, 다른 줄을 누르면 그 줄로 바뀐다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(legendRow('reaction-pie-reaction', 'NEUTRAL'));
    const detail = screen.getByTestId('reaction-detail');
    expect(within(detail).getByTestId('reaction-detail-title')).toHaveTextContent(
      '반응 › 보통 9건',
    );
    expect(within(detail).getByTestId('reaction-detail-contact')).toHaveTextContent(
      'K산업(가상) 11/12 통화',
    );
    await userEvent.click(legendRow('reaction-pie-good', 'QUALITY_CERT'));
    expect(screen.getByTestId('reaction-detail-title')).toHaveTextContent(
      '좋게 본 부분 › 품질·인증 6건',
    );
    // 산업이 둘인 회사의 접촉은 두 산업에 모두 센다(건수가 같으면 표의 줄 순서).
    expect(screen.getByTestId('reaction-detail-parts')).toHaveTextContent(
      '자동차 부품 1건 · 기계·설비 1건',
    );
    expect(legendRow('reaction-pie-reaction', 'NEUTRAL')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Given 조각을 펼친 채 When 다른 줄 [이것만 보기]를 누르면 Then 건수가 달라지므로 상세 칸은 닫힌다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(legendRow('reaction-pie-bad', 'PRICE'));
    expect(screen.getByTestId('reaction-detail')).toBeInTheDocument();
    await userEvent.click(within(splitRow('전기·전자')).getByTestId('reaction-split-only'));
    expect(screen.queryByTestId('reaction-detail')).not.toBeInTheDocument();
  });

  it('Given 반응을 남긴 접촉이 표본 기준(10건)보다 적은 줄 When 그 줄만 보면 Then 비율 없이 건수만 보이고 "기록이 더 쌓이면 비율을 보입니다"가 뜬다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(within(splitRow('전기·전자')).getByTestId('reaction-split-only'));
    expect(legendTexts('reaction-pie-reaction')).toEqual(['긍정적2건', '보통2건', '부정적2건']);
    expect(legendTexts('reaction-pie-good')).toEqual(['납기2건']);
    expect(screen.queryByTestId('reaction-pie-reaction-legend-percent')).not.toBeInTheDocument();
    expect(screen.getByTestId('reaction-small-sample')).toHaveTextContent(
      '기록이 더 쌓이면 비율을 보입니다',
    );
    expect(
      screen.getAllByTestId('reaction-pie-reaction-slice')[0].querySelector('title'),
    ).toHaveTextContent(/^긍정적 · 2건$/);
    // 조각이 하나뿐인 파이는 온전한 원 하나다.
    expect(screen.getAllByTestId('reaction-pie-good-slice')).toHaveLength(1);
  });

  it('Given 0건인 반응이 있는 줄 When 그 줄만 보면 Then 범례에는 "0건"이 남고 조각은 그리지 않으며 그 줄은 누를 수 없다', async () => {
    given();
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(screen.getByTestId('reaction-tab-process'));
    await userEvent.click(within(splitRow('공정 확인 전')).getByTestId('reaction-split-only'));
    expect(legendTexts('reaction-pie-reaction')).toEqual(['긍정적0건', '보통1건', '부정적1건']);
    expect(legendRow('reaction-pie-reaction', 'POSITIVE')).toBeDisabled();
    expect(screen.getAllByTestId('reaction-pie-reaction-slice')).toHaveLength(2);
    // 좋게 본 부분이 하나도 없으면 파이 대신 안내.
    expect(screen.getByTestId('reaction-pie-good-empty')).toHaveTextContent('아직 없습니다');
    // 공정이 없는 회사의 접촉은 산업도 없어 "산업 확인 전"으로 센다.
    await userEvent.click(legendRow('reaction-pie-bad', 'PRICE'));
    expect(screen.getByTestId('reaction-detail-parts')).toHaveTextContent('산업 확인 전 1건');
    expect(screen.getByTestId('reaction-detail-contact')).toHaveTextContent(
      'T기계(가상) 11/18 통화',
    );
  });

  it('Given 걸린 부분이 8가지 When 열면 Then 6번째부터는 "그 밖"으로 묶이고, "그 밖"을 누르면 묶인 부분의 접촉이 보인다', async () => {
    const bad = [
      { answerId: 'PRICE', count: 8 },
      { answerId: 'LEAD_TIME', count: 7 },
      { answerId: 'QUALITY_CERT', count: 6 },
      { answerId: 'PROCESS_FIT', count: 5 },
      { answerId: 'DISTANCE', count: 4 },
      { answerId: 'INCUMBENT_SUPPLIER', count: 3 },
      { answerId: 'CLAIM', count: 2 },
      { answerId: 'OTHER', count: 1 },
    ];
    const base = REACTION_SAMPLE.contacts[0];
    const contacts: ReactionContact[] = [
      { ...base, oppId: 'opp-1', name: '가상일(가상)', bad: 'CLAIM' },
      { ...base, oppId: 'opp-2', name: '가상이(가상)', bad: 'OTHER' },
      { ...base, oppId: 'opp-3', name: '가상삼(가상)', bad: 'PRICE' },
    ];
    given({
      ...REACTION_SAMPLE,
      basis: { ...REACTION_SAMPLE.basis, answeredCount: 59 },
      total: { ...REACTION_SAMPLE.total, answeredCount: 59, negative: 36, bad },
      contacts,
    });
    renderCard();
    await screen.findByText('긍정적');
    const rows = legendTexts('reaction-pie-bad');
    expect(rows).toHaveLength(6);
    expect(rows[4]).toBe('거리·물류4건11%');
    // 그 밖 = 3 + 2 + 1
    expect(rows[5]).toBe('그 밖6건17%');
    expect(screen.getAllByTestId('reaction-pie-bad-slice')).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: /그 밖/ }));
    expect(screen.getByTestId('reaction-detail-title')).toHaveTextContent('걸린 부분 › 그 밖 6건');
    expect(screen.getAllByTestId('reaction-detail-link').map((link) => link.textContent)).toEqual([
      '가상일(가상)',
      '가상이(가상)',
    ]);
  });

  it('Given 조각의 접촉이 10건 When 펼치면 Then 앞 8줄만 보이고 [더 보기]를 누르면 모두 보인다', async () => {
    const base = REACTION_SAMPLE.contacts[0];
    const contacts: ReactionContact[] = Array.from({ length: 10 }, (_, index) => ({
      ...base,
      oppId: `opp-${index}`,
      name: `가상${index}(가상)`,
    }));
    given({ ...REACTION_SAMPLE, contacts });
    renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(legendRow('reaction-pie-bad', 'PRICE'));
    expect(screen.getAllByTestId('reaction-detail-contact')).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: '더 보기 (2건)' }));
    expect(screen.getAllByTestId('reaction-detail-contact')).toHaveLength(10);
    expect(screen.queryByTestId('reaction-detail-more')).not.toBeInTheDocument();
  });

  it('Given 긍정적인데 부분을 안 고른 접촉이 있을 때 When 열면 Then 파이 제목 옆에 "부분을 고른 n건"이 함께 보인다', async () => {
    given({
      ...REACTION_SAMPLE,
      total: {
        ...REACTION_SAMPLE.total,
        good: [
          { answerId: 'QUALITY_CERT', count: 6 },
          { answerId: 'PROCESS_FIT', count: 4 },
        ],
      },
    });
    renderCard();
    await screen.findByText('긍정적');
    expect(screen.getByTestId('reaction-pie-good-sub')).toHaveTextContent(
      '긍정적 14건 가운데 부분을 고른 10건',
    );
    // 비율은 파이에 그린 조각들(10건) 안에서의 몫이다.
    expect(legendTexts('reaction-pie-good')).toEqual(['품질·인증6건60%', '공정·기술4건40%']);
  });

  it('Given 반응을 남긴 접촉이 0건 When 열면 Then 파이 대신 안내가 보인다', async () => {
    given({
      ...REACTION_SAMPLE,
      basis: { minSampleForRatio: 10, contactCount: 7, answeredCount: 0 },
      total: { answeredCount: 0, positive: 0, neutral: 0, negative: 0, good: [], bad: [] },
      byIndustry: [],
      byProcess: [],
      contacts: [],
    });
    renderCard();
    expect(await screen.findByTestId('reaction-empty')).toHaveTextContent(
      '아직 상대 반응을 남긴 접촉이 없습니다. 기록 남기기에서 통화 · 메일 · 대면을 저장할 때 상대 반응을 고르면 여기에 쌓입니다.',
    );
    expect(screen.getByTestId('reaction-basis')).toHaveTextContent(
      '통화 · 메일 · 대면 7건 가운데 반응을 남긴 0건',
    );
    expect(screen.queryByTestId('reaction-pies')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('Given 읽기 실패 When 열면 Then 카드 안에 안내와 [다시 시도]가 보이고, 누르면 다시 읽어 파이가 보인다', async () => {
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: REACTION_QUESTIONS, meta: {} } as never);
    vi.mocked(getSalesReactions)
      .mockRejectedValueOnce(new Error('서버 오류'))
      .mockResolvedValue({ data: REACTION_SAMPLE, meta: {} } as never);
    renderCard();
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('상대 반응을 불러오지 못했습니다');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('상대 반응');
    expect(screen.queryByTestId('reaction-pies')).not.toBeInTheDocument();
    await userEvent.click(within(error).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByTestId('reaction-pies')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getSalesReactions).toHaveBeenCalledTimes(2);
  });

  it('Given 약속과 다른 모양의 응답(옛 서버) When 열면 Then 숫자를 지어내지 않고 못 읽었다고 알린다', async () => {
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: REACTION_QUESTIONS, meta: {} } as never);
    vi.mocked(getSalesReactions).mockResolvedValue({
      data: { asOf: REACTION_SAMPLE.asOf, companies: [] },
      meta: {},
    } as never);
    renderCard();
    expect(await screen.findByTestId('reaction-error')).toBeInTheDocument();
    expect(screen.queryByTestId('reaction-pies')).not.toBeInTheDocument();
  });

  it('Given 질문 묶음을 못 읽었을 때 When 열면 Then 숫자는 그대로이고 보기 이름은 id로 보인다', async () => {
    given(REACTION_SAMPLE, 'fail');
    renderCard();
    await screen.findByTestId('reaction-pies');
    expect(legendTexts('reaction-pie-reaction')).toEqual([
      'POSITIVE14건41%',
      'NEUTRAL9건26%',
      'NEGATIVE11건32%',
    ]);
    expect(legendTexts('reaction-pie-bad')[0]).toBe('PRICE4건36%');
    expect(splitRow('자동차 부품')).toHaveTextContent('QUALITY_CERT 3건');
  });

  it('Given 지금 질문 파일에 없는 예전 보기 When 열면 Then 그 보기만 id로 보인다', async () => {
    given({
      ...REACTION_SAMPLE,
      total: {
        ...REACTION_SAMPLE.total,
        bad: [
          { answerId: 'PRICE', count: 4 },
          { answerId: 'OLD_CHOICE', count: 3 },
        ],
      },
    });
    renderCard();
    await screen.findByText('긍정적');
    expect(legendTexts('reaction-pie-bad')).toEqual(['가격4건57%', 'OLD_CHOICE3건43%']);
  });

  it('Given 기간이 바뀌면 When 다시 그리면 Then 그 기간으로 다시 읽고 골라 보던 줄은 처음으로 돌아간다', async () => {
    given();
    const { rerender } = renderCard();
    await screen.findByText('긍정적');
    await userEvent.click(within(splitRow('자동차 부품')).getByTestId('reaction-split-only'));
    expect(screen.getByTestId('reaction-scope-chip')).toBeInTheDocument();
    const next = { from: '2026-10-01', to: '2026-10-31' };
    rerender(
      <MemoryRouter>
        <ReactionAnalysis period={next} reloadKey={0} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('reaction-pies')).toBeInTheDocument();
    expect(vi.mocked(getSalesReactions).mock.calls.at(-1)?.[1]).toEqual(next);
    expect(screen.queryByTestId('reaction-scope-chip')).not.toBeInTheDocument();
  });
});
