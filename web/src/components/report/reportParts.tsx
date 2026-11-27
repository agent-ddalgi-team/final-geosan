// 회사별 보고서(#972)의 여러 묶음이 함께 쓰는 작은 부품: 묶음 틀·제목, 꼬리표, "확인 필요", 괄호 표시.
// 모양(여백·테두리·인쇄 규칙)은 styles.css 맨 아래 "회사별 보고서(#972)" 블록에 있고, 색은 tokens에서 가져온다.
import type { ReactNode } from 'react';
import { companyReport } from '../../labels/ko';
import { colors, radius, tagPalette } from '../../theme/tokens';

/** 값 뒤 괄호 표시: "(AI 제안 · 확인 전)", "(확인됨)", "(사례 파일)". */
export function Mark({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <span data-testid={testId} style={{ color: colors.textSecondary }}>
      {' '}
      ({children})
    </span>
  );
}

/** 값이 없는 칸. 지어내지 않고 "확인 필요"로 둔다. */
export function NeedCheck({ testId }: { testId?: string }) {
  return (
    <strong
      data-testid={testId ?? 'report-need-check'}
      className="report-need-check"
      style={{ color: tagPalette.warn.fg }}
    >
      {companyReport.needCheck}
    </strong>
  );
}

export type ReportTagTone = keyof typeof tagPalette;

/** 작은 꼬리표(모서리 6). 색은 보조 신호이고 글자가 늘 함께 있다. */
export function ReportTag({
  tone,
  children,
  testId,
}: {
  tone: ReportTagTone;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className="report-tag report-nowrap"
      style={{
        background: tagPalette[tone].bg,
        color: tagPalette[tone].fg,
        borderRadius: radius.tag,
      }}
    >
      {children}
    </span>
  );
}

/**
 * 묶음 제목. "2. 점수 8항목"의 번호는 제목 위 작은 글자로, 이름은 제목으로 보인다(글자는 그대로 "2. 점수 8항목").
 * note는 제목 옆 흐린 설명, tools는 오른쪽 끝 단추들(거르기 등).
 */
export function ReportHeading({
  id,
  title,
  note,
  tools,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  tools?: ReactNode;
}) {
  const numbered = /^(\d+\.)\s+(.+)$/.exec(title);
  return (
    <div className="report-head">
      <h2 id={id}>
        {numbered ? (
          <>
            <span className="report-eyebrow">{numbered[1]}</span> {numbered[2]}
          </>
        ) : (
          title
        )}
      </h2>
      {note ? <span className="report-head-note">{note}</span> : null}
      {tools}
    </div>
  );
}

/**
 * 보고서의 한 묶음. id는 목차가 찾아가는 자리이자 data-testid다. card가 참이면 흰 카드 하나로 그리고,
 * 거짓이면(한눈에·확인 질문처럼 카드 둘을 나란히 두는 묶음) 틀만 준다.
 */
export function ReportSection({
  id,
  labelledBy,
  card = true,
  className,
  children,
}: {
  id: string;
  /** 묶음 이름이 되는 제목의 id. 없으면 `${id}-heading`. */
  labelledBy?: string;
  card?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={labelledBy ?? `${id}-heading`}
      data-testid={id}
      className={['report-section', card ? 'report-card' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </section>
  );
}
