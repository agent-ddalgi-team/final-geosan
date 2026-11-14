// 회사별 보고서(#565)에 실을 값만 상세 응답에서 골라 담는다. 보고서 화면은 이 모델만 그린다.
// 내보내면 안 되는 값은 여기서 읽지 않는다: 대표번호(header.mainPhone*), 영업 메모·검토 의견 메모(records.opinion),
// 자료 줄 메모(reviewItems[].note), 직접 적은 답 글(replyText — 답한 날짜만 쓴다), 다음 일정의 할 일 글(nextScheduleNote),
// 거래 관계 메모(relationNote), 담당자 이름·키(by·owner). 새 값을 실으려면 이 파일에 칸을 더해야만 화면에 나온다.
import type {
  ContactCount,
  FitLevel,
  LostReasonCode,
  OpportunityDetail,
  OutcomeStatus,
  ReviewItemSource,
  SalesQuestions,
  SalesStep,
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
  };
  scores: ReportScoreRow[] | null;
  evidence: ReportEvidence[];
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
}

function httpUrl(value: string | null | undefined): string | null {
  return value && /^https?:\/\/\S+$/.test(value) ? value : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  };

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
    evidence: detail.evidence.map((row) => ({
      id: row.evidenceId,
      quote: row.quote,
      source: splitSourceRef(row.sourceRef),
      occurredAt: row.occurredAt ?? null,
      certainty: row.certainty,
      aiProposed: row.isLlmProposed,
    })),
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
  };
}
