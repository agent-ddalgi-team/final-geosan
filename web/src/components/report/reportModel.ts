// 회사별 보고서(#565)에 실을 값만 상세 응답에서 골라 담는다. 보고서 화면은 이 모델만 그린다.
// 내보내면 안 되는 값은 여기서 읽지 않는다: 대표번호(header.mainPhone*), 영업 메모·검토 의견 메모(records.opinion),
// 자료 줄 메모(reviewItems[].note), 직접 적은 답 글(replyText — 답한 날짜만 쓴다), 다음 일정의 할 일 글(nextScheduleNote),
// 거래 관계 메모(relationNote), 담당자 이름·키(by·owner). 새 값을 실으려면 이 파일에 칸을 더해야만 화면에 나온다.
// 예외 하나(#742): 메모 종류 가운데 "남긴 피드백"(records.advice — 영업 코치 피드백을 담당자가 고른 줄)만
// "영업 방향"에 싣는다. 글과 날짜만 싣고 담당자 키는 싣지 않는다.
// (#750) 같은 칸에 가장 최근 다음 통화 준비(records.callPrep — 영업 코치가 쓴 물어볼 것)도 싣는다. 줄과 날짜만.
import type {
  ContactCount,
  FitLevel,
  LostReasonCode,
  OpportunityDetail,
  OutcomeRecord,
  OutcomeStatus,
  ReviewItemSource,
  SalesQuestions,
  SalesStep,
  SalesStepView,
} from '../../api/types';
import { companyReport } from '../../labels/ko';
import { scoreText } from '../common/scoreDisplay';
import { splitSourceRef, type SourcePart } from '../common/sourceUrl';
import { formatDate, todayKst } from '../../utils/time';
import { callLinesOf } from '../detail/CallChecklist';
import { processStateOf } from '../detail/DetailGlance';
import { isProposal, reviewGroupOf } from '../review/ReviewArea';

export interface ReportScoreRow {
  code: string;
  label: string;
  fact: string | null;
  weight: number;
  /** 값이 없으면 null → 화면은 "확인 필요". */
  score: number | null;
  state: string;
  /** 담당자가 아직 확정하지 않은 AI 점수 입력 제안이 걸린 항목. */
  aiProposed: boolean;
}

export interface ReportEvidence {
  id: string;
  quote: string;
  source: SourcePart[];
  occurredAt: string | null;
  certainty: string;
  aiProposed: boolean;
  /** (#972) 근거가 무엇에 대한 것인지(응답의 근거 묶음 코드: 제품·소재·회사 소식 등). 거르기 단추가 쓴다. */
  group: string;
}

/** (#972) 점수 묶음 아래 합계 줄과 "한눈에" 동그라미에 쓰는 값. 모두 응답의 점수 항목에서 센다. */
export interface ReportScoreSummary {
  /** 서버가 준 점수 글자("77점 · 7/8", "참고 50점 · 3/8")에서 읽은 합계. 읽을 수 없으면 null. */
  total: number | null;
  /** 배점의 합(응답의 항목 배점을 더한 값). */
  max: number;
  /** 상태별 항목 수(응답 순서대로 처음 나온 상태부터). */
  states: { state: string; count: number }[];
  /** 0점보다 큰 점수를 받은 항목 수. */
  earned: number;
  /** 배점과 점수의 차이가 가장 큰 항목(값이 있는 항목 가운데, 같으면 앞 항목). 모두 만점이면 null. */
  biggestGap: { label: string; score: number; weight: number } | null;
}

export interface ReportKnownAnswer {
  questionId: string;
  question: string;
  /** 보기의 쉬운 말(서버가 준 글). 여러 값을 고른 질문은 여러 개. */
  answers: string[];
  at: string;
}

export interface ReportAskLine {
  key: string;
  /** 줄 앞 낱말(후속 조치·공정·소재·산업 등). */
  topic: string | null;
  text: string;
  /** 검토 줄의 출처(AI 조사·사례 파일·평가 규칙). */
  source: ReviewItemSource | null;
  /** 직접 적은 답이 있는 줄인가. 글은 싣지 않는다. */
  answered: boolean;
  answeredAt: string | null;
}

export interface ReportModel {
  title: string;
  isVirtual: boolean;
  glance: {
    name: string;
    item: string;
    address: string | null;
    homepageUrl: string | null;
    /** 주소가 있을 때의 확인 상태: AI가 찾은 주소 / 확인이 필요한 주소 / 그 밖(표시 없음). */
    homepageMark: 'AI' | 'NEED_CHECK' | null;
    summaryLine: string | null;
    summaryIsAi: boolean;
    fitLevel: FitLevel | null;
    pickReason: string | null;
    reason: string | null;
    processConfirmed: string[];
    processProposed: string[];
    industries: string[];
    industriesConfirmed: boolean;
    scoreText: string;
    /** (#972) "한눈에" 칸 가운데 값이 없어 "확인 필요"로 보이는 칸 수(주소·홈페이지·한 줄 소개·공정·산업). */
    needCheckCount: number;
  };
  scores: ReportScoreRow[] | null;
  /** (#972) 점수가 아직 없는 회사면 null. */
  scoreSummary: ReportScoreSummary | null;
  evidence: ReportEvidence[];
  /** (#972) 근거 묶음별 개수(응답 순서대로 처음 나온 묶음부터). */
  evidenceGroups: { code: string; count: number }[];
  known: ReportKnownAnswer[];
  ask: ReportAskLine[];
  sales: {
    status: OutcomeStatus;
    lostReasonCode: LostReasonCode | null;
    step: SalesStep | null;
    stepSince: string | null;
    contactCount: ContactCount | null;
    lastContactAt: string | null;
    /** 날짜만. 할 일 글은 싣지 않는다. */
    nextScheduleAt: string | null;
    /** (#730) 일정 날짜가 오늘보다 앞선가(놓친 일정). 일정이 없으면 false. */
    nextScheduleMissed: boolean;
  };
  /**
   * (#972) 단계 그림(상세와 같은 부품 SalesProgressBar)에 넘길 값. 그림에 필요한 것만 담는다:
   * 세부 단계 코드, 큰 단계·거절 이유 코드, 알아낸 답의 질문·보기 번호(끝난 회사가 어디서 멈췄는지 정할 때 씀), 접촉 수.
   * 담당자 키·답 글·일정 글·일정 날짜는 비워 둔다(그 부품이 "다음 일정: 날짜 할 일 글"을 그리지 않게).
   * 세부 단계가 시작된 날도 비운다: 그 부품은 "11/12"처럼 연도 없이 그리는데 보고서는 연도까지 적는다(#719).
   * 날짜는 그림 아래 칸이 연도까지 적어 보인다.
   */
  progress: {
    salesStep: SalesStepView | null;
    outcome: OutcomeRecord | null;
    contactTotal: number;
  };
  /** (#742) 영업 방향: 남긴 피드백(최근 것부터). 글과 날짜만. */
  direction: { text: string; at: string | null }[];
  /** (#750) 가장 최근 다음 통화 준비. 없으면 null. */
  nextCall: { lines: string[]; at: string | null } | null;
}

function httpUrl(value: string | null | undefined): string | null {
  return value && /^https?:\/\/\S+$/.test(value) ? value : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** 코드별 개수를 처음 나온 순서대로 센다. */
function countInOrder(codes: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}

/** 서버가 준 점수 글자에서 합계 숫자만 읽는다. 화면에서 점수를 다시 계산하지 않는다(#183). */
function scoreNumberOf(scoreDisplay: string): number | null {
  const match = /^(?:참고 )?(\d+)점/.exec(scoreDisplay);
  return match ? Number(match[1]) : null;
}

function scoreSummaryOf(rows: ReportScoreRow[], scoreDisplay: string): ReportScoreSummary {
  let biggestGap: ReportScoreSummary['biggestGap'] = null;
  for (const row of rows) {
    if (row.score === null) continue;
    const gap = row.weight - row.score;
    if (gap > 0 && (biggestGap === null || gap > biggestGap.weight - biggestGap.score)) {
      biggestGap = { label: row.label, score: row.score, weight: row.weight };
    }
  }
  return {
    total: scoreNumberOf(scoreDisplay),
    max: rows.reduce((sum, row) => sum + row.weight, 0),
    states: [...countInOrder(rows.map((row) => row.state))].map(([state, count]) => ({
      state,
      count,
    })),
    earned: rows.filter((row) => row.score !== null && row.score > 0).length,
    biggestGap,
  };
}

/**
 * 상세 응답(과 꼬리 질문 파일)에서 보고서 모델을 만든다. 질문 파일을 못 받았으면 null을 넘긴다
 * (그때는 아직 답이 없는 꼬리 질문 줄이 빠지고, 화면이 빠졌다고 알린다).
 * today("2026-11-14")는 놓친 일정을 가리는 기준이다. 시험이 현재 날짜에 기대지 않게 받을 수 있다.
 */
export function reportModelOf(
  detail: OpportunityDetail,
  hasVirtualData: boolean,
  questions: SalesQuestions | null,
  today: string = todayKst(),
): ReportModel {
  const { header, records } = detail;
  const reviewItems = detail.reviewItems ?? [];
  const { confirmed, proposedNames } = processStateOf(header, detail.processLinks, reviewItems);
  const industriesSource = header.industriesSource ?? null;

  const openProposals = new Set(
    reviewItems
      .filter((item) => item.kind === 'ITEM_INPUT_PROPOSAL' && !item.checked)
      .map((item) => item.itemId.replace(/^II:/, '')),
  );
  const scores =
    detail.scores?.items.map((item) => ({
      code: item.itemCode,
      label: item.label,
      fact: text(item.factJudged),
      weight: item.weight,
      score: item.score ?? null,
      state: item.state,
      aiProposed: openProposals.has(item.itemCode),
    })) ?? null;

  const known = new Map<string, ReportKnownAnswer>();
  for (const row of records.salesStep?.known ?? []) {
    const found = known.get(row.questionId);
    if (found) found.answers.push(row.answer);
    else {
      known.set(row.questionId, {
        questionId: row.questionId,
        question: row.question,
        answers: [row.answer],
        at: row.at,
      });
    }
  }

  // "방문·통화 때 물을 것": 상세 "2. 통화에서 확인할 것"과 같은 출처(후속 조치·공정·소재·산업·아직 답 없는 꼬리 질문
  // + 검토 줄의 질문 — 사례 파일에 적어 둔 확인 질문도 여기로 온다) 뒤에, 이 보고서에서 값이 없던 칸을 붙인다.
  const ask: ReportAskLine[] = callLinesOf(
    {
      header,
      reasons: detail.reasons,
      processLinks: detail.processLinks,
      reviewItems,
      requirements: detail.requirements,
      salesStep: records.salesStep,
    },
    questions,
  ).map((line) => ({
    key: line.key,
    topic: line.topic ?? null,
    text: line.text,
    source: null,
    answered: false,
    answeredAt: null,
  }));
  if (detail.reviewItems !== undefined) {
    for (const item of reviewItems) {
      if (isProposal(item) || reviewGroupOf(item) !== 'ask') continue;
      ask.push({
        key: item.itemId,
        topic: null,
        text: item.text,
        source: item.source,
        answered: Boolean(item.replyText),
        answeredAt: item.replyText ? (item.repliedAt ?? null) : null,
      });
    }
  } else {
    // 서버가 검토사항을 안 주는 옛 응답: 확인 질문 표를 그대로 쓴다.
    for (const question of detail.reasons.questions) {
      ask.push({
        key: question.questionId,
        topic: null,
        text: question.text,
        source: null,
        answered: Boolean(question.replyText),
        answeredAt: question.replyText ? (question.repliedAt ?? null) : null,
      });
    }
  }

  const glance = {
    name: header.customerName,
    item: header.opportunityItem,
    address: text(header.address),
    homepageUrl: httpUrl(header.homepageUrl),
    homepageMark:
      header.homepageStatus === 'AI_FOUND'
        ? ('AI' as const)
        : header.homepageStatus === 'NEEDS_CONFIRMATION'
          ? ('NEED_CHECK' as const)
          : null,
    summaryLine: text(header.summaryLine),
    summaryIsAi: header.researchSource === 'AI',
    fitLevel: header.fitLevel ?? null,
    pickReason: text(header.pickReason),
    reason: text(detail.reasons.reason),
    processConfirmed: confirmed.map((link) => link.processName || link.processCode),
    processProposed: proposedNames,
    industries: header.industries ?? [],
    industriesConfirmed: industriesSource === 'STAFF' || industriesSource === 'CASE_FILE',
    scoreText: scoreText(header.scoreDisplay),
    needCheckCount: 0,
  };
  glance.needCheckCount = [
    glance.address,
    glance.homepageUrl,
    glance.summaryLine,
    glance.processConfirmed.length + glance.processProposed.length > 0,
    glance.industries.length > 0,
  ].filter((value) => !value).length;

  const labels = companyReport.glance;
  const missingBasics = [
    glance.address ? null : labels.address,
    glance.homepageUrl ? null : labels.homepage,
    glance.summaryLine ? null : labels.intro,
  ].filter((name) => name !== null);
  if (missingBasics.length > 0) {
    ask.push({
      key: 'missing-basics',
      topic: companyReport.questions.missingBasicsTopic,
      text: missingBasics.join(' · '),
      source: null,
      answered: false,
      answeredAt: null,
    });
  }
  const missingScores = (scores ?? []).filter((row) => row.score === null).map((row) => row.label);
  if (missingScores.length > 0) {
    ask.push({
      key: 'missing-scores',
      topic: companyReport.questions.missingScoresTopic,
      text: companyReport.questions.missingScores(missingScores),
      source: null,
      answered: false,
      answeredAt: null,
    });
  }

  const nextScheduleAt = formatDate(records.outcome?.nextScheduleAt);
  return {
    title: header.title,
    isVirtual: header.isVirtual || hasVirtualData,
    glance,
    scores,
    scoreSummary: scores ? scoreSummaryOf(scores, header.scoreDisplay) : null,
    evidence: detail.evidence.map((row) => ({
      id: row.evidenceId,
      quote: row.quote,
      source: splitSourceRef(row.sourceRef),
      occurredAt: row.occurredAt ?? null,
      certainty: row.certainty,
      aiProposed: row.isLlmProposed,
      group: row.subject,
    })),
    evidenceGroups: [...countInOrder(detail.evidence.map((row) => row.subject))].map(
      ([code, count]) => ({ code, count }),
    ),
    known: [...known.values()],
    ask,
    sales: {
      status: records.outcome?.status ?? 'NOT_EXECUTED',
      lostReasonCode: records.outcome?.lostReasonCode ?? null,
      step: records.salesStep?.code ?? null,
      stepSince: records.salesStep?.since ?? null,
      contactCount: records.contactCount ?? null,
      lastContactAt: records.lastContactAt ?? null,
      nextScheduleAt,
      // 영업 기록은 다음 일정을 새로 넣지 않으면 앞 기록의 일정을 이어받는다. 그래서 그 날짜 뒤에 접촉했어도
      // 지난 일정이 남을 수 있다(#730 코파스: 마지막 접촉 11/13, 일정 11/12). 지난 것임을 보이게 한다.
      nextScheduleMissed: nextScheduleAt !== null && today !== '' && nextScheduleAt < today,
    },
    progress: {
      salesStep: records.salesStep
        ? {
            code: records.salesStep.code,
            since: null,
            overridden: false,
            known: records.salesStep.known.map((row) => ({
              questionId: row.questionId,
              answerId: row.answerId,
              question: '',
              answer: '',
              at: '',
              by: '',
            })),
            openQuestions: [],
          }
        : null,
      outcome: records.outcome
        ? {
            version: 0,
            updatedBy: '',
            updatedAt: '',
            status: records.outcome.status ?? null,
            lostReasonCode: records.outcome.lostReasonCode ?? null,
          }
        : null,
      contactTotal: records.contactCount?.total ?? 0,
    },
    direction: (records.advice ?? []).map((line) => ({
      text: line.text,
      at: formatDate(line.at),
    })),
    nextCall:
      records.callPrep && records.callPrep.lines.length > 0
        ? { lines: records.callPrep.lines, at: formatDate(records.callPrep.at) }
        : null,
  };
}
