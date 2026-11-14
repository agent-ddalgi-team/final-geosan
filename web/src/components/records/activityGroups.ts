// 활동 이력 종류를 뜻이 같은 3묶음으로 나눈다(#389, PM 결정 2026-11-07).
//  - SALES    영업 활동: 접촉 시도 · 영업 단계 · 메모 · 답 기록 · 기록 취소 (가장 자주 쌓이는 줄, 회색)
//  - FACT     사실 입력: 거래 관계 · 근거 등급 확인 · 변경 기록 (점수에 들어가는 확인한 사실, 파랑)
//             변경 기록(#731)은 공정·산업 확정, AI 제안 확정·물리침을 프로그램이 남긴 줄이다.
//  - FEEDBACK 프로그램 판단에 대한 피드백: 의견 · 분류 · 승인 · 관심 (노랑)
// 색은 theme/tokens.ts의 6가지 안에서만 고르고 보조 신호로만 쓴다. 글자는 그대로 둔다(접근성 A3·A19).
import type { ActivityKind } from '../../api/types';
import type { StatusTone } from '../../theme/tokens';

export const ACTIVITY_GROUPS = ['SALES', 'FACT', 'FEEDBACK'] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export const activityGroupOf: Record<ActivityKind, ActivityGroup> = {
  CONTACT_ATTEMPT: 'SALES',
  OUTCOME: 'SALES',
  NOTE: 'SALES',
  REPLY: 'SALES',
  RECORD_CANCELLED: 'SALES',
  RELATION_CONFIRMED: 'FACT',
  EVIDENCE_GRADE_CONFIRMED: 'FACT',
  CHANGE: 'FACT',
  OPINION: 'FEEDBACK',
  CLASSIFICATION: 'FEEDBACK',
  APPROVAL: 'FEEDBACK',
  BOOKMARK: 'FEEDBACK',
};

export const activityGroupTone: Record<ActivityGroup, StatusTone> = {
  SALES: 'neutral',
  FACT: 'ask',
  FEEDBACK: 'wait',
};

/** 서버가 모르는 종류를 주면 영업 활동으로 본다(옛 응답·새 종류). 줄을 숨기지 않는다. */
export function groupOf(kind: string): ActivityGroup {
  return kind in activityGroupOf ? activityGroupOf[kind as ActivityKind] : 'SALES';
}
