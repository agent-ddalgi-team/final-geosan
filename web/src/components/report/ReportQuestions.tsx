// 회사별 보고서 "4. 확인 질문과 지금까지의 답"(#972): 왼쪽 카드 "지금까지 들은 답" | 오른쪽 카드 "방문·통화 때 물을 것".
// 직접 적은 답 글은 싣지 않고 답한 날만 적는다(#565).
// 물을 것의 체크칸("물어봤다")은 이 브라우저(localStorage)에만 회사별로 기억한다. 서버에는 저장하지 않는다:
// 다른 PC·다른 브라우저에서는 보이지 않고, 인쇄하면 체크한 모양 그대로 나온다.
import { useState } from 'react';
import { companyReport, reportView, reviewItemSourceLabels } from '../../labels/ko';
import { formatDate } from '../../utils/time';
import type { ReportModel } from './reportModel';
import { Mark, ReportSection } from './reportParts';

const texts = companyReport;
const labels = texts.questions;
const view = reportView.questions;

/** 체크를 기억하는 이름: 이 앞말 + 회사(추천 건) 번호. 값은 체크한 줄 번호의 목록이다. */
export const ASKED_STORAGE_PREFIX = 'geosan.report.asked:';

function readAsked(oppId: string): string[] {
  try {
    const raw = window.localStorage.getItem(ASKED_STORAGE_PREFIX + oppId);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    // 기억해 둔 값을 읽을 수 없으면(저장이 막힌 브라우저, 깨진 값) 체크 없이 시작한다.
    return [];
  }
}

function storeAsked(oppId: string, keys: string[]): void {
  try {
    if (keys.length === 0) window.localStorage.removeItem(ASKED_STORAGE_PREFIX + oppId);
    else window.localStorage.setItem(ASKED_STORAGE_PREFIX + oppId, JSON.stringify(keys));
  } catch {
    // 저장이 막힌 브라우저에서는 이 화면에서만 체크가 유지된다(다시 열면 처음 값).
  }
}

export default function ReportQuestions({
  oppId,
  known,
  ask,
}: Pick<ReportModel, 'known' | 'ask'> & {
  /** 체크를 회사별로 기억하는 데 쓴다. 화면은 회사가 바뀌면 이 부품을 새로 그린다(key). */
  oppId: string;
}) {
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set(readAsked(oppId)));
  const toggle = (key: string, checked: boolean) => {
    const next = new Set(asked);
    if (checked) next.add(key);
    else next.delete(key);
    setAsked(next);
    storeAsked(oppId, [...next]);
  };
  const left = ask.filter((row) => !asked.has(row.key)).length;
  return (
    <ReportSection id="report-questions" card={false} className="report-qa">
      <div className="report-card">
        <h2 id="report-questions-heading" className="report-eyebrow">
          {texts.sections.questions}
        </h2>
        <h3>{labels.knownTitle}</h3>
        {known.length === 0 ? (
          <p data-testid="report-known-none">{labels.knownNone}</p>
        ) : (
          <ul className="report-lines" data-testid="report-known-list">
            {known.map((row) => (
              <li key={row.questionId} data-testid="report-known">
                {row.question} <strong>{row.answers.join(', ')}</strong>
                {formatDate(row.at) ? (
                  <span className="report-dim"> · {formatDate(row.at)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="report-dim report-foot-note">{view.knownHint}</p>
      </div>
      <div className="report-card">
        <p className="report-eyebrow">{labels.askTitle}</p>
        <div className="report-head">
          <h3 data-testid="report-ask-left">{view.left(left)}</h3>
          {ask.length > 0 ? (
            <span className="report-head-note no-print">{view.checkHint}</span>
          ) : null}
        </div>
        {ask.length === 0 ? (
          <p data-testid="report-ask-none">{labels.askNone}</p>
        ) : (
          <ul className="report-lines" data-testid="report-ask-list">
            {ask.map((row) => (
              <li key={row.key} data-testid="report-ask" data-line={row.key}>
                <label className="report-ask-line">
                  <input
                    type="checkbox"
                    checked={asked.has(row.key)}
                    onChange={(event) => toggle(row.key, event.target.checked)}
                    data-testid="report-ask-check"
                  />
                  <span>
                    <span className="report-ask-text">
                      {row.topic ? <strong>{row.topic} — </strong> : null}
                      {row.text}
                      {row.source ? (
                        <Mark testId="report-ask-source">{reviewItemSourceLabels[row.source]}</Mark>
                      ) : null}
                    </span>
                    {row.answered ? (
                      <span className="report-dim report-ask-sub" data-testid="report-ask-answered">
                        {labels.answered(formatDate(row.answeredAt))}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ReportSection>
  );
}
