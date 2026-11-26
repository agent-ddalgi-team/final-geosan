// #942 되먹임 ①: 기록을 남겨 다시 평가되면 "지난 평가와 달라진 것"을 점수 자세히 보기 위에 보인다.
// 예: "평가점수 70 → 77 · 구매·외주 의향 -- → 7점 · 통화에서 확인(11/20) · 견적 요청",
// "이 사이 남긴 기록: 11/20 전화 · 견적 요청". 서버가 null을 주면(앞 평가 없음·모두 같음) 그리지 않는다.
// 점수 글자(E 등)는 쓰지 않는다(BR10.9). 영업 메모 원문은 서버가 보내지 않는다.
import type { ScoreChange, ScoreChangeRecord } from '../../api/types';
import {
  classificationLabels,
  contactMethodLabels,
  labelFor,
  scoreChangeLabels as texts,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay, formatMonthDayTime } from '../../utils/time';
import DetailSection from './DetailSection';

export interface ScoreChangeLineProps {
  change: ScoreChange | null | undefined;
  /** 설정의 분류 이름 바꾸기(상세 머리와 같은 값). */
  classificationOverrides?: Record<string, string>;
}

function recordText(record: ScoreChangeRecord): string {
  if (record.kind === 'CONTACT_ATTEMPT') {
    const day = formatMonthDay(record.attemptedAt ?? record.at) ?? '';
    const method = labelFor(contactMethodLabels, record.method ?? '');
    return [`${day} ${method}`.trim(), record.summary].filter(Boolean).join(' · ');
  }
  const day = formatMonthDay(record.at);
  return day ? `${day} ${record.summary}` : record.summary;
}

function score(value: number | null): string {
  return value === null ? texts.noValue : String(value);
}

export default function ScoreChangeLine({ change, classificationOverrides }: ScoreChangeLineProps) {
  if (!change) return null;
  const when = formatMonthDayTime(change.changedAt);
  const heads: string[] = [];
  if (change.scoreBefore !== change.scoreAfter) {
    heads.push(texts.score(change.scoreBefore, change.scoreAfter));
  }
  if (change.classificationBefore !== change.classificationAfter) {
    heads.push(
      texts.classification(
        labelFor(classificationLabels, change.classificationBefore, classificationOverrides),
        labelFor(classificationLabels, change.classificationAfter, classificationOverrides),
      ),
    );
  }
  const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary };
  return (
    <DetailSection id="detail-score-change" title={texts.title}>
      <p style={{ margin: 0, ...secondary }}>
        {when ? `${texts.reevaluatedAt(when)} · ` : ''}
        {change.records.length > 0 ? texts.hint : texts.hintNoRecords}
      </p>
      {heads.length > 0 ? (
        <p data-testid="score-change-head" style={{ margin: 0, fontWeight: 600 }}>
          {heads.join(' · ')}
        </p>
      ) : null}
      {change.items.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
          {change.items.map((item) => (
            <li key={item.itemCode} data-testid="score-change-item">
              {texts.item(item.label, score(item.before), score(item.after))}
              {item.factJudged ? <span style={secondary}>{` · ${item.factJudged}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {change.records.length > 0 ? (
        <div data-testid="score-change-records" style={secondary}>
          <strong>{texts.recordsTitle}</strong>
          {': '}
          {change.records.map(recordText).join(' / ')}
        </div>
      ) : null}
      {change.ruleVersionChanged ? (
        <p data-testid="score-change-rule" style={{ margin: 0, ...secondary }}>
          {texts.ruleChanged}
        </p>
      ) : null}
    </DetailSection>
  );
}
