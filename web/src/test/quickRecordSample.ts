// 시험 고정값(#985): 기록 남기기 "종류 하나 + 메모" 흐름 시험이 같이 쓰는 꼬리 질문 · 코치 답 · 틀 값.
// 상대 반응 질문 3개(REACTION · REACTION_GOOD · REACTION_BAD)의 id와 보기는 서버 예시 파일
// (examples/sales-questions.yaml)과 같다. 회사 · 글 · 날짜는 모두 가상이다(거산 실제 사양 아님).
import type { CoachResult } from '../api/coach';
import type { ConfigUi, OutcomeRecord, SalesQuestions, SalesStepView } from '../api/types';
import type { FrameValue } from '../components/frame/FrameContext';

export const QUICK_QUESTIONS: SalesQuestions = {
  version: 1,
  steps: [
    { code: 'NOT_REACHED', label: '연결 전', stage: 'NOT_EXECUTED' },
    { code: 'REACHED', label: '연결됨', stage: 'IN_PROGRESS' },
    { code: 'DEMAND_CONFIRMED', label: '수요 확인', stage: 'IN_PROGRESS' },
    { code: 'MATERIAL_QUOTE', label: '자료·견적', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
    { code: 'VISIT_SAMPLE', label: '방문·샘플', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
  ],
  questions: [
    {
      questionId: 'REACTION',
      text: '상대 반응은 어땠나요?',
      step: 'ALL',
      coach: { fill: 'AI', required: true, keyword: '상대 반응' },
      answers: [
        { answerId: 'POSITIVE', label: '긍정적' },
        { answerId: 'NEUTRAL', label: '보통' },
        { answerId: 'NEGATIVE', label: '부정적' },
      ],
    },
    {
      questionId: 'REACTION_GOOD',
      text: '어느 부분을 좋게 봤나요?',
      step: 'ALL',
      showWhen: { answers: { REACTION: ['POSITIVE'] } },
      coach: { fill: 'AI', required: true, keyword: '좋게 본 부분' },
      answers: [
        { answerId: 'PROCESS_FIT', label: '공정·기술' },
        { answerId: 'QUALITY_CERT', label: '품질·인증' },
        { answerId: 'LEAD_TIME', label: '납기' },
        { answerId: 'PRICE', label: '가격' },
        { answerId: 'DISTANCE', label: '거리·물류' },
        { answerId: 'RESPONSE', label: '대응·신뢰' },
        { answerId: 'OTHER', label: '기타' },
      ],
    },
    {
      questionId: 'REACTION_BAD',
      text: '어느 부분이 걸렸나요?',
      step: 'ALL',
      showWhen: { answers: { REACTION: ['NEGATIVE'] } },
      coach: { fill: 'AI', required: true, keyword: '걸린 부분' },
      answers: [
        { answerId: 'PRICE', label: '가격' },
        { answerId: 'LEAD_TIME', label: '납기' },
        { answerId: 'QUALITY_CERT', label: '품질·인증' },
        { answerId: 'PROCESS_FIT', label: '공정·기술' },
        { answerId: 'DISTANCE', label: '거리·물류' },
        { answerId: 'INCUMBENT_SUPPLIER', label: '기존 거래처' },
        { answerId: 'CLAIM', label: '클레임(불량·납기)' },
        { answerId: 'OTHER', label: '기타' },
      ],
    },
    {
      questionId: 'PLATING_NOW',
      text: '지금 도금은 어떻게 하나요?',
      step: 'REACHED',
      coach: { fill: 'AI', required: true, keyword: '지금 도금 방식' },
      answers: [
        { answerId: 'IN_HOUSE', label: '직접 함' },
        { answerId: 'OUTSOURCED', label: '외주 줌', reaches: 'DEMAND_CONFIRMED' },
      ],
    },
    {
      questionId: 'SWITCH_INTENT',
      text: '외주처를 바꿀 생각이 있나요?',
      step: 'DEMAND_CONFIRMED',
      showWhen: { answers: { PLATING_NOW: ['OUTSOURCED'] } },
      coach: { fill: 'STAFF', required: true, keyword: '외주처 바꿀 생각' },
      answers: [
        { answerId: 'YES', label: '있음' },
        { answerId: 'NOT_NOW', label: '지금은 없음' },
      ],
    },
    {
      questionId: 'WHO_FIRST',
      text: '누가 먼저 연락했나요?',
      step: 'ALL',
      coach: { fill: 'AI', required: false },
      answers: [
        { answerId: 'OURS', label: '우리가', default: true },
        { answerId: 'THEIRS', label: '상대가' },
      ],
    },
    {
      questionId: 'NEXT_ACTION',
      text: '다음 할 일은?',
      step: 'ALL',
      coach: { fill: 'AI', required: true, keyword: '다음 할 일' },
      answers: [
        { answerId: 'SEND_MATERIAL', label: '자료 보내기' },
        { answerId: 'QUOTE', label: '견적' },
        { answerId: 'RECONTACT', label: '다시 연락' },
        { answerId: 'VISIT', label: '방문' },
        { answerId: 'END', label: '끝' },
      ],
    },
    {
      questionId: 'CLOSE_RESULT',
      text: '어떻게 끝났나요?',
      step: 'ALL',
      showWhen: { answers: { NEXT_ACTION: ['END'] } },
      coach: { fill: 'SUGGEST', required: true, keyword: '끝난 결과' },
      answers: [
        { answerId: 'WON', label: '성사', closes: 'WON' },
        { answerId: 'LOST', label: '거절', closes: 'LOST' },
        { answerId: 'ON_HOLD', label: '보류 · 나중에 다시', closes: 'ON_HOLD' },
      ],
    },
    {
      questionId: 'LOST_REASON',
      text: '거절 이유는?',
      step: 'ALL',
      showWhen: { answers: { CLOSE_RESULT: ['LOST'] } },
      coach: { fill: 'SUGGEST', required: true, keyword: '거절 이유' },
      answers: [
        { answerId: 'PRICE', label: '가격', lostReason: 'PRICE' },
        { answerId: 'LEAD_TIME', label: '납기', lostReason: 'LEAD_TIME' },
        {
          answerId: 'INCUMBENT_SUPPLIER',
          label: '기존 거래처 유지',
          lostReason: 'INCUMBENT_SUPPLIER',
        },
        { answerId: 'NO_DEMAND', label: '수요 없음', lostReason: 'NO_DEMAND' },
        { answerId: 'QUALITY_CERT', label: '품질·인증 요건', lostReason: 'QUALITY_CERT' },
        { answerId: 'OTHER', label: '기타', lostReason: 'OTHER' },
      ],
    },
  ],
};

export const QUICK_STEP: SalesStepView = {
  code: 'REACHED',
  since: '2026-11-10',
  overridden: false,
  known: [],
  openQuestions: ['PLATING_NOW', 'NEXT_ACTION'],
};

export const QUICK_OUTCOME: OutcomeRecord = {
  version: 1,
  updatedBy: 'park-lee',
  updatedAt: '2026-11-10T00:00:00Z',
  status: 'IN_PROGRESS',
};

/** 코치 답의 바탕값: 아무것도 채우지 않았고 상대 반응 · 다음 할 일이 빠져 있다. 시험마다 덮어쓴다. */
export const QUICK_RESULT: CoachResult = {
  answers: [],
  nextSchedule: null,
  feedback: [],
  nextCall: [],
  summary: '견적 요청을 받음',
  missingRequired: ['REACTION', 'NEXT_ACTION'],
  stepBefore: 'REACHED',
  stepAfter: 'REACHED',
  aiGenerated: true,
  removedNames: 0,
  removedContacts: 0,
  similarCases: [],
  similarAdvice: [],
  lookups: [],
};

/** 틀 값. enabled = 영업 코치 스위치. staff를 주면 메모 "받는 사람" 칸이 보인다. */
export function quickFrame(
  enabled = true,
  over: Partial<FrameValue> = {},
  staff: { key: string; displayName: string }[] = [],
): FrameValue {
  return {
    config: { staff, assistant: { enabled, questionMaxLength: 300 } } as unknown as ConfigUi,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...over,
  };
}
