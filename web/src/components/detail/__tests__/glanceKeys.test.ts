// #996(PM 결정 2026-11-29) "한눈에" 핵심 줄(어떤 회사 · 맞는 점 · 특징 · 확인할 점)을 저장된 값에서 고르는 규칙.
// AI를 부르지 않는다. 줄 수는 고정이 아니다: 값이 있는 만큼 줄이 생기고, 값이 없는 갈래는 배열에 없다(지어내지 않는다).
// 근거가 많은 회사 · 적은 회사 · 없는 회사를 각각 본다. 회사 · 글은 가상이다.
import type {
  DetailHeader,
  EvidenceView,
  ProcessLinkView,
  ReviewItem,
  ScoreItemView,
} from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import { GLANCE_LINES_SHOWN, firstSentenceOf, glanceGroupsOf } from '../glanceKeys';
import type { GlanceGroup } from '../glanceKeys';

const header: DetailHeader = {
  ...(detailFixture.data.header as unknown as DetailHeader),
  classificationCode: 'CONDITIONAL_WAIT',
  coreEvidenceRecheck: false,
  highlights: [],
  researchSource: 'CASE_FILE',
};

const link: ProcessLinkView = {
  linkId: 'link-1',
  processCode: 'ZINC_PLATING',
  processName: '아연도금(전기아연도금)',
  appliedMaterial: 'FE',
  result: 'PASS',
};

function ev(id: string): EvidenceView {
  return {
    evidenceId: id,
    sourceGrade: 'B',
    certainty: 'CONFIRMED',
    isLlmProposed: false,
    quote: `인용 ${id}`,
    sourceRef: '홈페이지',
    subject: 'PRODUCT',
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

const question = (text: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({
  itemId: `Q:${text}`,
  kind: 'QUESTION',
  source: 'AI',
  text,
  checked: false,
  ...extra,
});

describe('firstSentenceOf', () => {
  it('첫 문장만 남기고, 소수점에서는 끊지 않는다', () => {
    expect(
      firstSentenceOf(
        '사양에 ISO898 8.8~12.9 같은 탄소강이 있어 아연도금 소재와 맞습니다. 스테인리스 제품도 만듭니다. (홈페이지 볼트)',
      ),
    ).toBe('사양에 ISO898 8.8~12.9 같은 탄소강이 있어 아연도금 소재와 맞습니다.');
  });

  it('문장 부호가 없으면 끝의 괄호(출처 이름)만 떼고 그대로 쓴다', () => {
    expect(firstSentenceOf('볼트를 단조로 만듦 (홈페이지 제품)')).toBe('볼트를 단조로 만듦');
    expect(firstSentenceOf('  볼트를 단조로 만듦  ')).toBe('볼트를 단조로 만듦');
  });

  it('한 문장 뒤에 괄호가 붙어 있으면 문장까지만 쓴다', () => {
    expect(firstSentenceOf('생산공정에 도금이 있습니다. (홈페이지 생산공정)')).toBe(
      '생산공정에 도금이 있습니다.',
    );
  });
});

/** 갈래 하나의 줄만 꺼낸다(없는 갈래는 null). */
function linesOf(groups: GlanceGroup[], key: string) {
  return groups.find((group) => group.key === key)?.lines ?? null;
}

describe('glanceGroupsOf — 갈래 배열', () => {
  it('Given 근거가 거의 없는 회사(한 줄 소개뿐) When 고르면 Then "어떤 회사" 갈래 한 줄만 나온다', () => {
    const groups = glanceGroupsOf({
      header: { ...header, summaryLine: '볼트를 단조로 만드는 가상 회사' },
      processLinks: [],
      evidence: [],
      scoreItems: [],
      reviewItems: [],
    });
    expect(groups.map((group) => group.key)).toEqual(['company']);
    expect(groups[0]).toMatchObject({ label: '어떤 회사', tone: 'neutral' });
    expect(groups[0].lines).toEqual([
      { text: '볼트를 단조로 만드는 가상 회사', tag: undefined, testId: 'company-summary-line' },
    ]);
  });

  it('Given 한 줄 소개도 생산품도 없는 회사 When 고르면 Then "어떤 회사"는 흐린 "아직 조사 전" 한 줄이다(지어내지 않는다)', () => {
    const groups = glanceGroupsOf({
      header: { ...header, summaryLine: null, opportunityItem: '' },
      processLinks: [],
      evidence: [],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual([
      { text: '아직 조사 전', muted: true, testId: 'glance-not-researched' },
    ]);
  });

  it('Given AI가 조사한 한 줄 소개 / 생산품만 아는 회사 When 고르면 Then "AI 제안" 꼬리표 / "(공장 자료 기준)" 덧말이 붙는다', () => {
    const ai = glanceGroupsOf({
      header: { ...header, summaryLine: '가상 소개', researchSource: 'AI' },
      processLinks: [],
      evidence: [],
    });
    expect(linesOf(ai, 'company')).toEqual([
      { text: '가상 소개', tag: 'AI 제안', testId: 'company-summary-line' },
    ]);
    const factory = glanceGroupsOf({
      header: { ...header, summaryLine: null, opportunityItem: '육각볼트' },
      processLinks: [],
      evidence: [],
    });
    expect(linesOf(factory, 'company')).toEqual([
      { text: '육각볼트 생산', note: '(공장 자료 기준)', testId: 'glance-factory-intro' },
    ]);
  });

  it('Given 값이 다 있는 회사 When 고르면 Then 갈래는 어떤 회사 → 맞는 점 → 특징 → 확인할 점 순서이고 줄 수는 값이 있는 만큼이다', () => {
    const groups = glanceGroupsOf({
      header: { ...header, highlights: ['아연도금 외주 물량 있음'] },
      processLinks: [link],
      evidence: ['e1', 'e2', 'e3', 'e4', 'e5'].map(ev),
      scoreItems: [
        item('NEW_PRODUCT', 'CONFIRMED', 25, '볼트를 단조로 만듭니다.', ['e1']),
        item('NEW_MATERIAL', 'CONFIRMED', 20, '탄소강이라 맞습니다.', ['e2']),
        item('NEW_RECORD', 'CONFIRMED', 0, '납품 산업이 달라 가점이 없습니다.', ['e3']),
        item('NEW_PERF', 'UNAVAILABLE', null, '처리 목적이 적혀 있지 않습니다.', ['e4']),
        item('SIG_EXPAND', 'CONFIRMED', 10, '2공장을 증설했습니다.', ['e5']),
      ],
      reviewItems: [question('도금을 자체 설비로 하는지 외주인지')],
    });
    expect(groups.map((group) => [group.key, group.tone, group.lines.length])).toEqual([
      ['company', 'neutral', 1],
      ['fit', 'good', 2],
      ['feature', 'neutral', 2],
      ['check', 'warn', 3],
    ]);
  });
});

describe('glanceGroupsOf — 맞는 점', () => {
  it('Given 확인되고 점수를 얻은 근거 줄이 둘 When 고르면 Then 줄마다 첫 문장 한 줄씩(소재가 먼저)이고 저마다 자기 근거 줄로 잇는다', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [link],
      evidence: [ev('e1'), ev('e2')],
      scoreItems: [
        item('NEW_PRODUCT', 'CONFIRMED', 25, '볼트를 단조로 만듭니다. 도금이 있습니다.', ['e1']),
        item(
          'NEW_MATERIAL',
          'CONFIRMED',
          20,
          '탄소강이라 아연도금과 맞습니다. 다른 강종도 있습니다.',
          ['e2'],
        ),
      ],
    });
    // 소재가 제품보다 먼저다(거산과 맞는지를 가장 바로 말하는 줄).
    expect(linesOf(groups, 'fit')).toEqual([
      { text: '탄소강이라 아연도금과 맞습니다.', target: { code: 'NEW_MATERIAL', label: '소재' } },
      { text: '볼트를 단조로 만듭니다.', target: { code: 'NEW_PRODUCT', label: '제품' } },
    ]);
  });

  it('Given 근거 문장은 없지만 확정 공정 · 통과한 소재가 있음 When 고르면 Then "공정 ○○ 확인됨 · 소재 ○ 통과" 한 줄이고 이을 줄은 없다', () => {
    const groups = glanceGroupsOf({ header, processLinks: [link], evidence: [], scoreItems: [] });
    expect(linesOf(groups, 'fit')).toEqual([
      { text: '공정 아연도금(전기아연도금) 확인됨 · 소재 철 통과' },
    ]);
  });

  it('Given 확정 공정은 있지만 소재 판정이 통과가 아님 When 고르면 Then "공정 ○○ 확인됨"만 적는다', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [{ ...link, result: 'PENDING' }],
      evidence: [],
    });
    expect(linesOf(groups, 'fit')).toEqual([{ text: '공정 아연도금(전기아연도금) 확인됨' }]);
  });

  it('Given 추정(확인 전)이거나 가점이 없는 줄뿐이고 확정 공정도 없음 When 고르면 Then 맞는 점 갈래가 없다', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [],
      evidence: [ev('e1'), ev('e2')],
      scoreItems: [
        item('NEW_PRODUCT', 'STRONG', 20, '볼트를 만드는 것으로 보입니다.', ['e1']),
        item('NEW_RECORD', 'CONFIRMED', 0, '납품 산업이 달라 가점이 없습니다.', ['e2']),
      ],
    });
    expect(linesOf(groups, 'fit')).toBeNull();
    // 그 두 줄은 확인할 점으로 간다.
    expect(linesOf(groups, 'check')).toEqual([
      { text: '볼트를 만드는 것으로 보입니다.', target: { code: 'NEW_PRODUCT', label: '제품' } },
      {
        text: '납품 산업이 달라 가점이 없습니다.',
        target: { code: 'NEW_RECORD', label: '납품실적' },
      },
    ]);
  });

  it('Given 근거가 붙지 않아 "왜 이 회사인가"에 안 보이는 줄 When 고르면 Then 그 줄은 어느 갈래에도 쓰지 않는다(이을 곳이 없다)', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [],
      evidence: [],
      scoreItems: [item('NEW_MATERIAL', 'UNAVAILABLE', null, '소재 자료가 없어 미확보입니다.', [])],
    });
    expect(groups.map((group) => group.key)).toEqual(['company']);
  });
});

describe('glanceGroupsOf — 특징', () => {
  it('Given 저장된 회사 특징 둘과 증설 근거 줄 When 고르면 Then 특징마다 한 줄(AI가 조사한 값이면 표시) + 증설 줄 한 줄이다', () => {
    const groups = glanceGroupsOf({
      header: {
        ...header,
        highlights: ['아연도금 외주 물량 있음', ' 2공장 운영 '],
        researchSource: 'AI',
      },
      processLinks: [link],
      evidence: [ev('e5')],
      scoreItems: [item('SIG_EXPAND', 'CONFIRMED', 10, '2공장을 증설했습니다.', ['e5'])],
    });
    const feature = groups.find((group) => group.key === 'feature');
    expect(feature?.lines).toEqual([
      { text: '아연도금 외주 물량 있음', tag: 'AI 제안' },
      { text: '2공장 운영', tag: 'AI 제안' },
      { text: '2공장을 증설했습니다.', target: { code: 'SIG_EXPAND', label: '증설' } },
    ]);
    expect(feature?.listTestId).toBe('company-highlights');
  });

  it('Given 특징은 없고 시점 근거 줄이 넷 When 고르면 Then 넷 모두 한 줄씩 만든다(화면이 앞 3줄 + 더 보기로 보인다)', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [link],
      evidence: [ev('e5'), ev('e6'), ev('e7'), ev('e8')],
      scoreItems: [
        item('SIG_EXPAND', 'UNAVAILABLE', null, '2010년 공장을 넓혔습니다. 날짜는 모릅니다.', [
          'e5',
        ]),
        item('SIG_ORDER', 'UNAVAILABLE', null, '2026년 인증을 받았습니다. (홈페이지 연혁)', ['e6']),
        item('SIG_BID', 'CONFIRMED', 7, '견적을 요청했습니다.', ['e7']),
        item('SIG_HIRE', 'CONFIRMED', 5, '소개서를 받아 보겠다고 했습니다.', ['e8']),
      ],
    });
    const feature = groups.find((group) => group.key === 'feature');
    expect(feature?.lines).toEqual([
      { text: '2010년 공장을 넓혔습니다.', target: { code: 'SIG_EXPAND', label: '증설' } },
      { text: '2026년 인증을 받았습니다.', target: { code: 'SIG_ORDER', label: '수주' } },
      { text: '견적을 요청했습니다.', target: { code: 'SIG_BID', label: '구매·외주 의향' } },
      { text: '소개서를 받아 보겠다고 했습니다.', target: { code: 'SIG_HIRE', label: '관심' } },
    ]);
    expect(feature?.lines.length).toBeGreaterThan(GLANCE_LINES_SHOWN);
    expect(feature?.listTestId).toBeUndefined();
  });

  it('Given 특징도 시점 근거 줄도 없음 When 고르면 Then 특징 갈래가 없다', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [link],
      evidence: [],
      scoreItems: [item('SIG_ORDER', 'NO_SIGNAL', 0, '신호가 없습니다.', [])],
    });
    expect(linesOf(groups, 'feature')).toBeNull();
  });
});

describe('glanceGroupsOf — 확인할 점', () => {
  it('Given 가점 없는 납품실적 줄과 답이 없는 확인 질문 둘 When 고르면 Then 근거 줄 한 줄 + 질문마다 한 줄이고, 이미 답했거나 확인한 질문은 뺀다', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [link],
      evidence: [ev('e2'), ev('e4')],
      scoreItems: [
        item('NEW_MATERIAL', 'CONFIRMED', 20, '탄소강이라 맞습니다.', ['e2']),
        item('NEW_RECORD', 'CONFIRMED', 0, '납품 산업이 달라 가점이 없습니다. 건설 쪽입니다.', [
          'e4',
        ]),
      ],
      reviewItems: [
        question('이미 답한 질문', { replyText: '외주라고 함' }),
        question('이미 확인한 질문', { checked: true }),
        question('도금을 자체 설비로 하는지 외주인지'),
        question('철계 볼트의 전기아연도금 물량이 있는지'),
        // 같은 글의 질문은 한 번만.
        question('도금을 자체 설비로 하는지 외주인지'),
      ],
    });
    expect(linesOf(groups, 'check')).toEqual([
      {
        text: '납품 산업이 달라 가점이 없습니다.',
        target: { code: 'NEW_RECORD', label: '납품실적' },
      },
      { text: '도금을 자체 설비로 하는지 외주인지' },
      { text: '철계 볼트의 전기아연도금 물량이 있는지' },
    ]);
  });

  it('Given 공정이 AI 제안뿐이고 소재를 모르며 요구 확인이 필요 When 고르면 Then "확인 전: 공정 · 소재 · RoHS" 한 줄이 맨 앞에 온다', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [
        { linkId: 'l1', processCode: 'ZINC_PLATING', processName: '아연도금', result: 'PENDING' },
      ],
      evidence: [],
      scoreItems: [],
      reviewItems: [
        {
          itemId: 'PL:ZINC_PLATING',
          kind: 'PROCESS_LINK_PROPOSAL',
          source: 'AI',
          text: 'AI 공정 연결 제안 · 아연도금',
          checked: false,
        },
        question('납기가 얼마나 급한지'),
      ],
      requirements: [
        {
          reqId: 'r1',
          name: 'RoHS',
          reqLevel: 'REQUIRED',
          neededStage: 'NOW',
          result: 'QUESTION_NEEDED',
          reason: '확인 필요',
        },
      ],
    });
    expect(linesOf(groups, 'check')).toEqual([
      { text: '확인 전: 공정 · 소재 · RoHS' },
      { text: '납기가 얼마나 급한지' },
    ]);
    // 확정 공정이 없으니 맞는 점 갈래는 없다.
    expect(linesOf(groups, 'fit')).toBeNull();
  });

  it('Given 확인할 것이 하나도 없음 When 고르면 Then 확인할 점 갈래가 없다', () => {
    const groups = glanceGroupsOf({
      header,
      processLinks: [link],
      evidence: [ev('e2')],
      scoreItems: [item('NEW_MATERIAL', 'CONFIRMED', 20, '탄소강이라 맞습니다.', ['e2'])],
      reviewItems: [],
    });
    expect(linesOf(groups, 'check')).toBeNull();
  });
});
