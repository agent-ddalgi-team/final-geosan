// 상세 "한눈에" 핵심 줄(#996, PM 결정 2026-11-29): 어떤 회사 · 맞는 점 · 특징 · 확인할 점.
// 지금 저장된 값(한 줄 소개, 점수 항목의 쉬운 요약, 확정 공정·소재, 회사 특징, 검토사항)에서 프로그램이 골라 붙인다.
// AI를 부르지 않고 새 응답 칸도 쓰지 않는다.
// 줄 수는 고정이 아니다(PM 추가 지시 2026-11-29): 갈래마다 저장된 값이 여러 개면 그만큼 줄을 만들고,
// 값이 없는 갈래는 만들지 않는다(지어내지 않는다). 근거가 거의 없는 회사는 "어떤 회사" 한 줄만 나온다.
// 화면은 갈래 배열을 받아 그대로 그린다(갈래마다 앞 `GLANCE_LINES_SHOWN`줄 + "더 보기 n줄"). 새 갈래는 배열에 더하면 된다.
// 근거 문장이 길면 첫 문장만 쓰고, 그 문장이 나온 "왜 이 회사인가" 줄을 target으로 돌려줘 화면이 "○○ 근거 ↓"로 잇는다.
import type {
  DetailHeader,
  EvidenceView,
  ProcessLinkView,
  RequirementCheckView,
  ReviewItem,
  ScoreItemView,
} from '../../api/types';
import {
  cardRows,
  companyGlance,
  companySummary,
  detailCompose,
  detailReport,
  itemShortLabels,
  labelFor,
  materialLabels,
} from '../../labels/ko';
import { detailCheckWordsOf, processStateOf } from './glanceState';
import { reasonLinesOf } from './WhyThisCompany';

const texts = detailCompose.glance;

/** 거산과 맞는지를 보는 항목. 앞에 있을수록 "맞는 점" · "확인할 점"에 먼저 쓴다. */
export const FIT_ITEM_CODES = ['NEW_MATERIAL', 'NEW_PRODUCT', 'NEW_PERF', 'NEW_RECORD'] as const;
/** 시점 신호 항목(증설 · 수주 · 구매·외주 의향 · 관심). "특징" 줄에 쓴다. */
export const SIGNAL_ITEM_CODES = ['SIG_EXPAND', 'SIG_ORDER', 'SIG_BID', 'SIG_HIRE'] as const;
export interface GlanceKeyTarget {
  /** 점수 항목 코드. "왜 이 회사인가"의 그 줄을 가리킨다. */
  code: string;
  /** 줄 이름: "소재" · "증설" */
  label: string;
}

/** 갈래마다 처음부터 보이는 줄 수. 넘치면 "더 보기 n줄"로 편다(상세의 "앞 3개 + 펼치기" 관례와 같은 수). */
export const GLANCE_LINES_SHOWN = 3;

export type GlanceTone = 'neutral' | 'good' | 'warn';

/** 핵심 줄 하나. */
export interface GlanceLine {
  text: string;
  /** 이 줄의 근거가 있는 "왜 이 회사인가" 줄. 없으면 링크를 그리지 않는다. */
  target?: GlanceKeyTarget;
  /** 글 뒤 꼬리표(예: "AI 제안"). AI가 조사해 저장한 값을 그대로 보일 때 붙인다. */
  tag?: string;
  /** 글 뒤 흐린 덧말(예: "(공장 자료 기준)"). */
  note?: string;
  /** 값이 없다는 뜻의 흐린 글("아직 조사 전"). */
  muted?: boolean;
  /** 이 줄에 붙일 시험 표시(전부터 쓰던 이름을 잇는다). */
  testId?: string;
}

/** 갈래 하나(이름표 + 줄들). 줄이 없는 갈래는 만들지 않는다. */
export interface GlanceGroup {
  key: string;
  /** 이름표: "어떤 회사" · "맞는 점" · "특징" · "확인할 점" */
  label: string;
  tone: GlanceTone;
  lines: GlanceLine[];
  /** 갈래 상자의 시험 표시. */
  testId: string;
  /** 줄 목록의 시험 표시(있을 때만). */
  listTestId?: string;
}

/** 문장 끝 괄호(출처 이름)를 뗀다: "… 맞습니다. (홈페이지 제품)" → "… 맞습니다." */
function dropTrailingParen(text: string): string {
  return text.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

/**
 * 첫 문장만. 마침표·물음표·느낌표 뒤가 빈칸이거나 글 끝일 때만 문장 끝으로 본다
 * ("ISO898 8.8~12.9"의 소수점에서는 끊지 않는다). 문장 부호가 없으면 끝 괄호만 떼고 그대로 쓴다.
 */
export function firstSentenceOf(text: string): string {
  const trimmed = text.trim();
  const found = /^([\s\S]*?[.!?])(?=\s|$)/.exec(trimmed);
  return dropTrailingParen(found ? found[1] : trimmed);
}

/** 사람이 확인했고 점수도 얻은 항목만 "맞는 점"이다. 추정·미확보·가점 없음은 "확인할 점" 쪽이다. */
function isSecured(item: ScoreItemView | undefined): boolean {
  return item?.state === 'CONFIRMED' && (item.score ?? 0) > 0;
}

export interface GlanceKeysInput {
  header: DetailHeader;
  processLinks: ProcessLinkView[];
  evidence: EvidenceView[];
  reviewItems?: ReviewItem[];
  requirements?: RequirementCheckView[];
  scoreItems?: ScoreItemView[];
}

/**
 * "한눈에"에 그릴 갈래 배열(화면에 나오는 순서). "어떤 회사"는 늘 한 줄이 있고(값이 없으면 "아직 조사 전"),
 * 맞는 점 · 특징 · 확인할 점은 줄이 하나라도 있을 때만 들어간다.
 */
export function glanceGroupsOf({
  header,
  processLinks,
  evidence,
  reviewItems = [],
  requirements = [],
  scoreItems,
}: GlanceKeysInput): GlanceGroup[] {
  // "왜 이 회사인가"에 실제로 보이는 줄만 쓴다(링크가 갈 곳이 있어야 한다).
  const shown = new Set(reasonLinesOf(scoreItems, evidence).map((row) => row.key));
  const byCode = new Map((scoreItems ?? []).map((item) => [item.itemCode, item]));
  const sentenceOf = (code: string) => firstSentenceOf(byCode.get(code)?.summary ?? '');
  const targetOf = (code: string): GlanceKeyTarget => ({
    code,
    label: itemShortLabels[code] ?? byCode.get(code)?.label ?? code,
  });
  const usable = (code: string) => shown.has(code) && sentenceOf(code) !== '';
  const lineOf = (code: string): GlanceLine => ({ text: sentenceOf(code), target: targetOf(code) });
  const isAi = header.researchSource === 'AI';

  // ── 어떤 회사: 조사한 한 줄 소개 → 공장 자료의 생산품 → "아직 조사 전".
  const summary = header.summaryLine?.trim() || null;
  const item = header.opportunityItem?.trim() || null;
  const companyLine: GlanceLine = summary
    ? {
        text: summary,
        tag: isAi ? companySummary.aiSuggestion : undefined,
        testId: 'company-summary-line',
      }
    : item
      ? {
          text: companyGlance.produces(item),
          note: `(${companyGlance.factoryBasis})`,
          testId: 'glance-factory-intro',
        }
      : { text: detailReport.glance.notResearched, muted: true, testId: 'glance-not-researched' };

  // ── 맞는 점: 확인되고 점수를 얻은 근거 줄마다 첫 문장 한 줄. 근거 문장이 없으면 확정 공정·소재로 한 줄.
  const { confirmed } = processStateOf(header, processLinks, reviewItems);
  const firstProcess = confirmed[0] ?? null;
  const materialLink = confirmed.find((row) => row.appliedMaterial) ?? null;
  const materialPass = materialLink?.result === 'PASS';
  const fitLines: GlanceLine[] = FIT_ITEM_CODES.filter(
    (code) => usable(code) && isSecured(byCode.get(code)),
  ).map(lineOf);
  if (fitLines.length === 0 && firstProcess) {
    fitLines.push({
      text: [
        texts.fitProcess(firstProcess.processName || firstProcess.processCode),
        ...(materialPass && materialLink?.appliedMaterial
          ? [texts.fitMaterial(labelFor(materialLabels, materialLink.appliedMaterial))]
          : []),
      ].join(' · '),
    });
  }

  // ── 특징: 저장된 회사 특징마다 한 줄 + 시점 신호(증설 · 수주 · 구매·외주 의향 · 관심) 근거 줄마다 첫 문장 한 줄.
  const highlights = (header.highlights ?? []).map((text) => text.trim()).filter((text) => text);
  const featureLines: GlanceLine[] = [
    ...highlights.map((text): GlanceLine => ({
      text,
      tag: isAi ? companySummary.aiSuggestion : undefined,
    })),
    ...SIGNAL_ITEM_CODES.filter((code) => usable(code)).map(lineOf),
  ];

  // ── 확인할 점: 아직 확인 전인 것(공정 · 소재 · 근거 부족 · 요구 이름) 한 줄
  //    + 확보 못 한(추정 · 미확보 · 가점 없음) 근거 줄마다 한 줄 + 답이 없는 확인 질문마다 한 줄.
  const words = detailCheckWordsOf(header, processLinks, reviewItems, requirements);
  const wordList: string[] = [];
  if (words.process) wordList.push(cardRows.checkWords.process);
  if (words.material) wordList.push(cardRows.checkWords.material);
  if (words.evidence) wordList.push(cardRows.checkWords.evidence);
  const checkLines: GlanceLine[] = [];
  if (wordList.length > 0 || words.names.length > 0) {
    checkLines.push({
      text: texts.checkWords(detailReport.glance.checkWords(wordList, words.names)),
    });
  }
  checkLines.push(
    ...FIT_ITEM_CODES.filter((code) => usable(code) && !isSecured(byCode.get(code))).map(lineOf),
  );
  const seenQuestions = new Set<string>();
  for (const review of reviewItems) {
    const text = review.text.trim();
    if (review.kind !== 'QUESTION' || review.checked || review.replyText?.trim()) continue;
    if (text === '' || seenQuestions.has(text)) continue;
    seenQuestions.add(text);
    checkLines.push({ text });
  }

  const groups: GlanceGroup[] = [
    {
      key: 'company',
      label: detailReport.glance.company,
      tone: 'neutral',
      lines: [companyLine],
      testId: 'glance-company',
    },
    { key: 'fit', label: texts.fit, tone: 'good', lines: fitLines, testId: 'glance-key-fit' },
    {
      key: 'feature',
      label: texts.feature,
      tone: 'neutral',
      lines: featureLines,
      testId: 'glance-key-feature',
      listTestId: highlights.length > 0 ? 'company-highlights' : undefined,
    },
    {
      key: 'check',
      label: texts.check,
      tone: 'warn',
      lines: checkLines,
      testId: 'glance-key-check',
    },
  ];
  return groups.filter((group) => group.lines.length > 0);
}
