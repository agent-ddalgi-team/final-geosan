// 대시보드 응답 타입 — 계약 C1 `GET /dashboard` v2(2026-11-03) 모양 그대로(필드 이름 camelCase).
// types.ts(경계 파일)는 건드리지 않고 U7 전용 타입을 이 파일에 둔다.

/** 건수 5개의 키. 누르면 /opportunities?stage=… (SCHEDULE_DUE만 ?filter=SCHEDULE_DUE). */
export type DashboardCountKey =
  'NOT_CONTACTED' | 'INTERESTED' | 'IN_CONTACT' | 'QUOTE_SAMPLE' | 'SCHEDULE_DUE';

export type DashboardCounts = Record<DashboardCountKey, number>;

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
