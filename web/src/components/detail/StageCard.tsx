// 기업 상세 둘째 줄 왼쪽 "영업 단계" 칸(#996, PM 결정 2026-11-29). 전에는 머리 아래 가로 전체 카드였다.
// 그림은 지금 모양 그대로 크기만 줄인 축소판이다(큰 단계 4칸 + 세부 단계 점 + "지금 (11/7부터)" + 다음 일정 한 줄).
// 그 아래 `extra` 자리에 기록 부품이 "▸ 지금까지 들은 답 n개"와 "단계 고치기"를 작은 링크 모양으로 그린다(동작은 그대로,
// 그 자리에서 펼침). [일정만 바꾸기]는 이 칸에서 뺐다. 일정은 오른쪽 영업 코치의 "다음 일정 [바꾸기]"로 바꾼다.
import type { ReactNode } from 'react';
import type { OutcomeRecord, SalesQuestions, SalesStepView } from '../../api/types';
import { detailReport } from '../../labels/ko';
import { colors, detailLayout, detailTheme } from '../../theme/tokens';
import SalesProgressBar from './SalesProgressBar';

export interface StageCardProps {
  salesStep?: SalesStepView | null;
  outcome?: OutcomeRecord | null;
  /** 접촉 시도 수. 끝난 회사의 멈춘 자리를 정할 때만 쓴다. */
  contactTotal?: number;
  /** 서버 질문 파일(단계 이름·순서). 못 받았으면 null. */
  questions?: SalesQuestions | null;
  /** 그림 아래에 붙는 것: 넓은 화면의 "지금까지 들은 답 · 단계 고치기" 자리. */
  extra?: ReactNode;
}

export default function StageCard({
  salesStep = null,
  outcome = null,
  contactTotal = 0,
  questions = null,
  extra = null,
}: StageCardProps) {
  return (
    <section
      aria-label={detailReport.progress.title}
      data-testid="detail-stage-card"
      style={{
        display: 'grid',
        gap: 8,
        alignContent: 'start',
        padding: detailLayout.cardPadding,
        background: colors.bgContainer,
        border: `1px solid ${detailTheme.border}`,
        borderRadius: detailTheme.radius,
        boxSizing: 'border-box',
      }}
    >
      <SalesProgressBar
        salesStep={salesStep}
        outcome={outcome}
        contactTotal={contactTotal}
        questions={questions}
        compact
      />
      {extra ? <div data-testid="detail-stage-extra">{extra}</div> : null}
    </section>
  );
}
