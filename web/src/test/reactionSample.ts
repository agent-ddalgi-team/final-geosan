// 상대 반응 카드 시험에 쓰는 가상 응답(#985). 회사 이름·숫자 모두 가상이고 사람 이름·연락처는 없다.
// 숫자는 PM이 승인한 시안의 예시와 같다(전체 34건: 긍정적 14 · 보통 9 · 부정적 11).
// contacts는 시험에 필요한 줄만 담았다(서버는 반응을 남긴 접촉을 모두 준다).
import type { ReactionContact, SalesReactions } from '../api/salesAnalysis';
import type { SalesQuestions } from '../api/types';

function contact(overrides: Partial<ReactionContact> & { oppId: string; name: string }) {
  return {
    day: '2026-11-20',
    method: 'CALL',
    reaction: 'NEGATIVE',
    good: null,
    bad: null,
    industries: [],
    processCodes: [],
    ...overrides,
  } as ReactionContact;
}

export const REACTION_SAMPLE: SalesReactions = {
  asOf: '2026-11-29T09:00:00+09:00',
  basis: { minSampleForRatio: 10, contactCount: 41, answeredCount: 34 },
  total: {
    answeredCount: 34,
    positive: 14,
    neutral: 9,
    negative: 11,
    good: [
      { answerId: 'QUALITY_CERT', count: 6 },
      { answerId: 'PROCESS_FIT', count: 4 },
      { answerId: 'LEAD_TIME', count: 3 },
      { answerId: 'RESPONSE', count: 1 },
    ],
    bad: [
      { answerId: 'PRICE', count: 4 },
      { answerId: 'INCUMBENT_SUPPLIER', count: 3 },
      { answerId: 'CLAIM', count: 2 },
      { answerId: 'DISTANCE', count: 2 },
    ],
  },
  byIndustry: [
    {
      industry: '자동차 부품',
      answeredCount: 15,
      positive: 5,
      neutral: 3,
      negative: 7,
      good: [
        { answerId: 'QUALITY_CERT', count: 3 },
        { answerId: 'LEAD_TIME', count: 1 },
        { answerId: 'PROCESS_FIT', count: 1 },
      ],
      bad: [
        { answerId: 'PRICE', count: 3 },
        { answerId: 'INCUMBENT_SUPPLIER', count: 2 },
        { answerId: 'CLAIM', count: 1 },
        { answerId: 'DISTANCE', count: 1 },
      ],
    },
    {
      industry: '기계·설비',
      answeredCount: 10,
      positive: 6,
      neutral: 3,
      negative: 1,
      good: [
        { answerId: 'PROCESS_FIT', count: 3 },
        { answerId: 'QUALITY_CERT', count: 2 },
        { answerId: 'RESPONSE', count: 1 },
      ],
      bad: [{ answerId: 'DISTANCE', count: 1 }],
    },
    {
      industry: '전기·전자',
      answeredCount: 6,
      positive: 2,
      neutral: 2,
      negative: 2,
      good: [{ answerId: 'LEAD_TIME', count: 2 }],
      bad: [{ answerId: 'CLAIM', count: 2 }],
    },
    {
      industry: '산업 확인 전',
      answeredCount: 3,
      positive: 1,
      neutral: 1,
      negative: 1,
      good: [{ answerId: 'QUALITY_CERT', count: 1 }],
      bad: [{ answerId: 'PRICE', count: 1 }],
    },
  ],
  byProcess: [
    {
      processCode: 'ZINC_PLATING',
      processName: '아연도금(전기아연도금)',
      answeredCount: 18,
      positive: 8,
      neutral: 5,
      negative: 5,
      good: [{ answerId: 'QUALITY_CERT', count: 4 }],
      bad: [
        { answerId: 'PRICE', count: 2 },
        { answerId: 'CLAIM', count: 1 },
      ],
    },
    {
      processCode: 'NICKEL_PLATING',
      processName: '니켈도금',
      answeredCount: 9,
      positive: 4,
      neutral: 2,
      negative: 3,
      good: [{ answerId: 'PROCESS_FIT', count: 3 }],
      bad: [
        { answerId: 'CLAIM', count: 2 },
        { answerId: 'PRICE', count: 1 },
      ],
    },
    {
      processCode: null,
      processName: '공정 확인 전',
      answeredCount: 2,
      positive: 0,
      neutral: 1,
      negative: 1,
      good: [],
      bad: [{ answerId: 'PRICE', count: 1 }],
    },
  ],
  contacts: [
    contact({
      oppId: 'opp-r',
      name: 'R테크(가상)',
      day: '2026-11-26',
      method: 'EMAIL',
      bad: 'PRICE',
      industries: ['자동차 부품'],
      processCodes: ['NICKEL_PLATING'],
    }),
    contact({
      oppId: 'opp-m',
      name: 'M정밀(가상)',
      day: '2026-11-24',
      method: 'VISIT',
      bad: 'PRICE',
      industries: ['자동차 부품'],
      processCodes: ['ZINC_PLATING'],
    }),
    contact({
      oppId: 'opp-k',
      name: 'K산업(가상)',
      day: '2026-11-20',
      method: 'CALL',
      bad: 'PRICE',
      industries: ['자동차 부품'],
      processCodes: ['ZINC_PLATING'],
    }),
    // 산업·공정이 아직 없는 회사: 산업 "산업 확인 전" 줄 · 공정 "공정 확인 전" 줄에 든다.
    contact({ oppId: 'opp-t', name: 'T기계(가상)', day: '2026-11-18', bad: 'PRICE' }),
    contact({
      oppId: 'opp-k',
      name: 'K산업(가상)',
      day: '2026-11-12',
      reaction: 'NEUTRAL',
      industries: ['자동차 부품'],
      processCodes: ['ZINC_PLATING'],
    }),
    contact({
      oppId: 'opp-h',
      name: 'H금속(가상)',
      day: '2026-11-10',
      method: 'VISIT',
      reaction: 'POSITIVE',
      good: 'QUALITY_CERT',
      industries: ['기계·설비', '자동차 부품'],
      processCodes: ['ZINC_PLATING', 'NICKEL_PLATING'],
    }),
    // 긍정적인데 좋게 본 부분을 안 고른 접촉: 반응에는 세고 좋게 본 부분에는 넣지 않는다.
    contact({
      oppId: 'opp-s',
      name: 'S전자(가상)',
      day: '2026-11-05',
      reaction: 'POSITIVE',
      industries: ['전기·전자'],
      processCodes: ['NICKEL_PLATING'],
    }),
  ],
};

/** 질문 파일의 상대 반응 세 질문(examples/sales-questions.yaml 맨 앞 세 질문과 같은 보기). */
export const REACTION_QUESTIONS: SalesQuestions = {
  version: 1,
  steps: [],
  questions: [
    {
      questionId: 'REACTION',
      text: '상대 반응은 어땠나요?',
      step: 'ALL',
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
  ],
};
