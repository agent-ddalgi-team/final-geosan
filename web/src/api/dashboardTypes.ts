// 대시보드 응답 타입 — 계약 C1 `GET /dashboard` 모양 그대로(필드 이름 camelCase).
// 건수는 약속 v3(2026-11-06 PM 결정 #356)로 바뀌었다: 관심으로 고른 회사만 세고, 화면은 두 구역으로 보인다.
// 약속 v4(2026-11-10 PM 결정 #536): 검토 대상 제외로 저장한 회사는 관심 기업에서 빠져 NOT_TARGET 칸이 없어졌다.
// types.ts(경계 파일)는 건드리지 않고 U7 전용 타입을 이 파일에 둔다.

/**
 * 건수 칸의 이름표 9개.
 * - "관심 기업" 구역: BOOKMARKED(관심 기업 전체) · NO_OPINION(의견 전) · NEED_CHECK(추가 확인 필요)
 * - "영업 진행" 구역: NOT_CONTACTED(검토 권고를 받았고 아직 접촉 전) · IN_CONTACT · QUOTE_SAMPLE · ON_HOLD · DONE(성사·거절)
 * - SCHEDULE_DUE(이번 주 일정)는 예전 그대로다.
 * BOOKMARKED를 누르면 /opportunities?bookmarked=true, 나머지는 /opportunities?filter=<이름표>.
 */
export type DashboardCountKey =
  | 'BOOKMARKED'
  | 'NO_OPINION'
  | 'NEED_CHECK'
  | 'NOT_CONTACTED'
  | 'IN_CONTACT'
  | 'QUOTE_SAMPLE'
  | 'ON_HOLD'
  | 'DONE'
  | 'SCHEDULE_DUE';

/** 서버가 아직 옛 모양을 주면 새 이름표가 없을 수 있다. 화면은 없는 칸을 0으로 지어내지 않고 뺀다. */
export type DashboardCounts = Partial<Record<DashboardCountKey, number>>;

export interface DashboardScheduleItem {
  oppId: string;
  customerName: string;
  oppTitle: string;
  /** 날짜(YYYY-MM-DD). */
  dueAt: string;
  note: string;
  overdue: boolean;
  staffKey: string;
}

export type ActivityKind = 'NOTE' | 'STAGE' | 'CONTACT_ATTEMPT' | 'SCHEDULE' | 'OPINION';

export interface RecentActivityItem {
  /** 시각(시간대 포함). */
  at: string;
  oppId: string;
  customerName: string;
  kind: ActivityKind;
  summary: string;
}

export interface ProcessBreakdownItem {
  processCode: string;
  processName: string;
  count: number;
  /** count ÷ total, 소수 2자리. 한 회사가 여러 공정이면 각각 세므로 합이 1을 넘을 수 있다. */
  ratio: number;
}

export interface IndustryBreakdownItem {
  industry: string;
  count: number;
  ratio: number;
  /** AI 제안 값이 섞여 있으면 true. 막대 옆에 "AI 제안 포함"을 작게 보인다. */
  includesProposed: boolean;
}

export interface DashboardBreakdown {
  basis: { statuses: string[]; total: number };
  byProcess: ProcessBreakdownItem[];
  byIndustry: IndustryBreakdownItem[];
}

export interface Dashboard {
  counts: DashboardCounts;
  schedule: DashboardScheduleItem[];
  recentActivity: RecentActivityItem[];
  asOf: string;
  /** 없으면 화면은 공정·산업군 막대 줄을 숨긴다(실제 집계 전 거산 전달본에 가짜 숫자가 보이면 안 됨). */
  breakdown?: DashboardBreakdown | null;
}
