// 영업 분석 › "상대 반응 — 거산의 강점 · 약점"(#985, PM이 승인한 시안 2026-11-29).
// 접촉마다 남긴 상대 반응(긍정적 · 보통 · 부정적)과 좋게 본 부분(= 거산의 강점) · 걸린 부분(= 약점)을
// 파이 세 개로 보이고, 산업별 · 공정별 표에서 [이것만 보기]로 좁혀 본다. 조각이나 범례 줄을 누르면
// 그 부분이 어느 공정(산업) · 회사 · 접촉에서 나왔는지 아래에 펼친다.
// 숫자는 서버가 준 값을 쓴다(GET /sales-analysis/reactions). 화면이 새로 세는 것은 조각을 눌렀을 때 접촉 줄을
// 조건으로 고르고 그 줄을 공정별(또는 산업별)로 세는 것뿐이다(계산은 reactionMath.ts).
// 보기 이름은 질문 파일(GET /sales-questions)에서 읽고, 못 읽었거나 없는 보기면 id 그대로 보인다(숫자는 그대로).
// 이 카드를 못 읽어도 영업 분석의 다른 표는 그대로 보이게, 안내와 [다시 시도]를 이 카드 안에만 둔다.
// 영업 기록에서 나온 내부 참고라 엑셀 · AI로 내보내는 단추를 두지 않는다.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getSalesQuestions } from '../../api/client';
import { getSalesReactions } from '../../api/salesAnalysis';
import type {
  AnalysisPeriod,
  ReactionContact,
  ReactionGroup,
  SalesReactions,
} from '../../api/salesAnalysis';
import type { SalesQuestions } from '../../api/types';
import {
  labelFor,
  reactionAnalysisTexts as texts,
  salesAnalysisTexts,
  states,
} from '../../labels/ko';
import {
  accent,
  chartTheme,
  choiceChip,
  colors,
  radius,
  reactionPalette,
  typography,
} from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { chartSecondary } from '../common/ChartFrame';
import { analysisCell, analysisHead } from './ProcessAnalysisTable';
import ReactionPie from './ReactionPie';
import type { PiePart } from './ReactionPie';
import { answerText } from './SalesPatterns';
import {
  REACTION_IDS,
  contactsOfSlice,
  countByPart,
  groupWithRest,
  inScope,
  namedIndustries,
} from './reactionMath';
import type { PartGroup, PieKind, ReactionScope } from './reactionMath';

/** 조각을 눌렀을 때 회사 목록에 먼저 보이는 줄 수. 넘으면 [더 보기]. */
const DETAIL_ROWS = 8;
const QUESTION_IDS = { reaction: 'REACTION', good: 'REACTION_GOOD', bad: 'REACTION_BAD' } as const;

/** 응답이 약속한 모양인가. 옛 서버나 다른 모양이면 숫자를 지어내지 않고 "못 읽음"으로 본다. */
function isReactions(data: unknown): data is SalesReactions {
  const value = data as Partial<SalesReactions> | null | undefined;
  return Boolean(
    value &&
    value.basis &&
    typeof value.basis.answeredCount === 'number' &&
    value.total &&
    Array.isArray(value.total.good) &&
    Array.isArray(value.total.bad) &&
    Array.isArray(value.byIndustry) &&
    Array.isArray(value.byProcess) &&
    Array.isArray(value.contacts),
  );
}

function Shell({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-labelledby="reaction-card-title"
      data-testid="reaction-card"
      style={{
        display: 'grid',
        gap: 16,
        minWidth: 0,
        background: chartTheme.cardBg,
        border: `1px solid ${chartTheme.cardBorder}`,
        borderRadius: radius.card,
        padding: 24,
        color: chartTheme.text,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <h2
          id="reaction-card-title"
          style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
        >
          {texts.title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const smallButton = {
  padding: '4px 10px',
  borderRadius: radius.controlSm,
  fontSize: typography.fontSizeSecondary,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
} as const;

/** 얇은 세 칸 막대 + "긍정 5 · 보통 3 · 부정 7". 색만으로 가르지 않게 글자가 늘 함께 있다. */
function ReactionBar({ group }: { group: ReactionGroup }) {
  const cells = [
    { value: group.positive, color: reactionPalette.positive },
    { value: group.neutral, color: reactionPalette.neutral },
    { value: group.negative, color: reactionPalette.negative },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <span
        role="img"
        aria-label={texts.split.reactionSpoken(group.positive, group.neutral, group.negative)}
        style={{ display: 'flex', gap: 2, width: 180, maxWidth: '100%' }}
      >
        {cells.map((cell, index) =>
          cell.value > 0 ? (
            <span
              key={index}
              style={{
                display: 'block',
                height: 10,
                borderRadius: reactionPalette.swatchRadius,
                background: cell.color,
                flex: cell.value,
              }}
            />
          ) : null,
        )}
      </span>
      <span style={{ ...chartSecondary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {texts.split.reactionCounts(group.positive, group.neutral, group.negative)}
      </span>
    </div>
  );
}

const topCell = { ...analysisCell, verticalAlign: 'middle', whiteSpace: 'nowrap' } as const;

interface SplitRow {
  key: string;
  name: string;
  scope: ReactionScope;
  group: ReactionGroup;
}

function sameScope(a: ReactionScope | null, b: ReactionScope | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'industry') return b.kind === 'industry' && a.industry === b.industry;
  return b.kind === 'process' && a.processCode === b.processCode;
}

function ReactionBody({
  data,
  questions,
}: {
  data: SalesReactions;
  questions: SalesQuestions | null;
}) {
  const [tab, setTab] = useState<'industry' | 'process'>('industry');
  const [scope, setScope] = useState<ReactionScope | null>(null);
  const [pick, setPick] = useState<{ pie: PieKind; key: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const named = useMemo(() => namedIndustries(data.contacts), [data.contacts]);

  const industryRows: SplitRow[] = data.byIndustry.map((row) => ({
    key: row.industry,
    name: row.industry,
    scope: { kind: 'industry', industry: row.industry },
    group: row,
  }));
  const processRows: SplitRow[] = data.byProcess.map((row) => ({
    key: row.processCode ?? '',
    name: row.processName,
    scope: { kind: 'process', processCode: row.processCode },
    group: row,
  }));
  const scopeRow = scope
    ? ([...industryRows, ...processRows].find((row) => sameScope(row.scope, scope)) ?? null)
    : null;
  // 골라 보던 줄이 응답에 없으면 전체를 보인다(숫자를 지어내지 않는다).
  const activeScope = scopeRow ? scopeRow.scope : null;
  const group: ReactionGroup = scopeRow ? scopeRow.group : data.total;
  const showRatio = group.answeredCount >= data.basis.minSampleForRatio;

  const reactionName = (id: string) => answerText(questions, QUESTION_IDS.reaction, id);
  const reactionParts: PiePart[] = [
    { key: REACTION_IDS.positive, value: group.positive, color: reactionPalette.positive },
    { key: REACTION_IDS.neutral, value: group.neutral, color: reactionPalette.neutral },
    { key: REACTION_IDS.negative, value: group.negative, color: reactionPalette.negative },
  ].map((part) => ({ ...part, name: reactionName(part.key) }));

  // 부분이 색 단계 수(6)를 넘으면 마지막 색은 "그 밖" 조각이 쓴다.
  const goodGroups = groupWithRest(group.good, reactionPalette.good.length);
  const badGroups = groupWithRest(group.bad, reactionPalette.bad.length);
  const toParts = (
    groups: PartGroup[],
    questionId: string,
    palette: readonly string[],
  ): PiePart[] =>
    groups.map((item, index) => ({
      key: item.key,
      name: item.rest ? texts.rest : answerText(questions, questionId, item.key),
      value: item.count,
      color: palette[index],
    }));
  const goodParts = toParts(goodGroups, QUESTION_IDS.good, reactionPalette.good);
  const badParts = toParts(badGroups, QUESTION_IDS.bad, reactionPalette.bad);
  const sum = (parts: PiePart[]) => parts.reduce((total, part) => total + part.value, 0);

  const togglePick = (pie: PieKind, key: string) => {
    setShowAll(false);
    setPick((prev) => (prev && prev.pie === pie && prev.key === key ? null : { pie, key }));
  };
  const toggleScope = (next: ReactionScope | null) => {
    // 묶음을 바꾸면 조각 건수가 달라지므로 펼쳐 둔 상세 칸은 닫는다.
    setPick(null);
    setShowAll(false);
    setScope((prev) => (sameScope(prev, next) ? null : next));
  };

  // 조각을 눌렀을 때: 접촉 줄을 조건으로 고르고, 고른 줄을 공정별(산업을 골라 보는 중) 또는 산업별로 센다.
  let detail: ReactNode = null;
  if (pick) {
    const pieParts =
      pick.pie === 'reaction' ? reactionParts : pick.pie === 'good' ? goodParts : badParts;
    const part = pieParts.find((item) => item.key === pick.key && item.value > 0);
    const answerIds =
      pick.pie === 'reaction'
        ? [pick.key]
        : ((pick.pie === 'good' ? goodGroups : badGroups).find((item) => item.key === pick.key)
            ?.answerIds ?? []);
    if (part) {
      const contacts = contactsOfSlice(
        data.contacts.filter((contact) => inScope(contact, activeScope, named)),
        pick.pie,
        answerIds,
      );
      const by = activeScope?.kind === 'industry' ? 'process' : 'industry';
      const noIndustryRow = data.byIndustry.find((row) => !named.has(row.industry));
      const order =
        by === 'process'
          ? data.byProcess.map((row) => row.processCode)
          : data.byIndustry.map((row) => (named.has(row.industry) ? row.industry : null));
      const partName = (key: string | null) => {
        if (by === 'industry') return key ?? noIndustryRow?.industry ?? texts.detail.noIndustry;
        const row = data.byProcess.find((item) => item.processCode === key);
        return row?.processName ?? key ?? texts.detail.noProcess;
      };
      detail = (
        <DetailPanel
          pie={pick.pie}
          title={texts.detail.title(
            texts.pies[pick.pie],
            part.name,
            scopeRow?.name ?? null,
            part.value,
          )}
          partsLabel={by === 'process' ? texts.detail.byProcess : texts.detail.byIndustry}
          partsText={countByPart(contacts, by, order)
            .map((item) => texts.detail.part(partName(item.key), item.count))
            .join(' · ')}
          contacts={contacts}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
        />
      );
    }
  }

  const rows = tab === 'industry' ? industryRows : processRows;
  const split = texts.split;
  const topText = (items: ReactionGroup['good'], questionId: string) => {
    const top = items.find((item) => item.count > 0);
    return top ? split.top(answerText(questions, questionId, top.answerId), top.count) : split.none;
  };

  return (
    <Shell
      aside={
        <>
          <span data-testid="reaction-basis" style={chartSecondary}>
            {texts.basis(data.basis.contactCount, data.basis.answeredCount)}
          </span>
          {scopeRow ? (
            <span
              data-testid="reaction-scope-chip"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: radius.controlSm,
                background: choiceChip.selected.bg,
                border: `1px solid ${choiceChip.selected.border}`,
                color: choiceChip.selected.fg,
                fontSize: typography.fontSizeSecondary,
                fontWeight: choiceChip.selected.fontWeight,
              }}
            >
              {texts.scopeChip(scopeRow.name)}
              <button
                type="button"
                aria-label={texts.scopeClear}
                title={texts.scopeClear}
                data-testid="reaction-scope-clear"
                onClick={() => toggleScope(null)}
                style={{
                  border: 0,
                  background: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  padding: '0 2px',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </span>
          ) : null}
        </>
      }
    >
      <div
        data-testid="reaction-pies"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}
      >
        <ReactionPie
          id="reaction-pie-reaction"
          title={texts.pies.reaction}
          sub={texts.reactionSub(group.answeredCount)}
          parts={reactionParts}
          showRatio={showRatio}
          pickedKey={pick?.pie === 'reaction' ? pick.key : null}
          onPick={(key) => togglePick('reaction', key)}
        />
        <ReactionPie
          id="reaction-pie-good"
          title={texts.pies.good}
          sub={texts.partSub(reactionName(REACTION_IDS.positive), group.positive, sum(goodParts))}
          parts={goodParts}
          showRatio={showRatio}
          pickedKey={pick?.pie === 'good' ? pick.key : null}
          onPick={(key) => togglePick('good', key)}
        />
        <ReactionPie
          id="reaction-pie-bad"
          title={texts.pies.bad}
          sub={texts.partSub(reactionName(REACTION_IDS.negative), group.negative, sum(badParts))}
          parts={badParts}
          showRatio={showRatio}
          pickedKey={pick?.pie === 'bad' ? pick.key : null}
          onPick={(key) => togglePick('bad', key)}
        />
      </div>
      {showRatio ? null : (
        <p data-testid="reaction-small-sample" style={{ margin: 0, ...chartSecondary }}>
          {texts.smallSample(data.basis.minSampleForRatio)}
        </p>
      )}
      <div aria-live="polite">{detail}</div>
      <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: typography.fontSize, fontWeight: 600 }}>
            {split.title}
          </h3>
          <div role="group" aria-label={split.title} style={{ display: 'flex', gap: 6 }}>
            {(['industry', 'process'] as const).map((key) => {
              const selected = tab === key;
              const chip = selected ? choiceChip.selected : choiceChip.idle;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`reaction-tab-${key}`}
                  onClick={() => setTab(key)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: radius.controlSm,
                    border: `1px solid ${chip.border}`,
                    background: chip.bg,
                    color: chip.fg,
                    fontWeight: selected ? choiceChip.selected.fontWeight : 400,
                    fontSize: typography.fontSizeSecondary,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {split[key]}
                </button>
              );
            })}
          </div>
          <span data-testid="reaction-split-hint" style={chartSecondary}>
            {tab === 'industry' ? split.hintIndustry : split.hintProcess}
          </span>
        </div>
        {rows.length === 0 ? (
          <p data-testid="reaction-split-empty" style={{ margin: 0, ...chartSecondary }}>
            {split.empty}
          </p>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-label={tab === 'industry' ? split.tableLabelIndustry : split.tableLabelProcess}
            style={{ overflowX: 'auto' }}
          >
            <table
              data-testid="reaction-split-table"
              style={{ width: '100%', borderCollapse: 'collapse' }}
            >
              <thead>
                <tr>
                  {[
                    tab === 'industry' ? split.columnIndustry : split.columnProcess,
                    split.columnContacts,
                    split.columnReaction,
                    split.columnTopGood,
                    split.columnTopBad,
                  ].map((name) => (
                    <th key={name} scope="col" style={analysisHead}>
                      {name}
                    </th>
                  ))}
                  <th scope="col" style={analysisHead}>
                    <span style={visuallyHidden}>{split.columnAction}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const viewing = sameScope(row.scope, activeScope);
                  return (
                    <tr
                      key={row.key}
                      data-testid="reaction-split-row"
                      data-viewing={viewing ? 'true' : undefined}
                      style={viewing ? { background: reactionPalette.picked.bg } : undefined}
                    >
                      <th
                        scope="row"
                        style={{
                          ...analysisCell,
                          verticalAlign: 'middle',
                          fontWeight: viewing ? 600 : 400,
                          // 좁은 화면에서는 글자를 세로로 쪼개지 않고 표를 옆으로 민다.
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.name}
                      </th>
                      <td
                        style={{
                          ...analysisCell,
                          verticalAlign: 'middle',
                          color: colors.textSecondary,
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {texts.count(row.group.answeredCount)}
                      </td>
                      <td style={{ ...analysisCell, verticalAlign: 'middle', minWidth: 190 }}>
                        <ReactionBar group={row.group} />
                      </td>
                      <td style={topCell}>{topText(row.group.good, QUESTION_IDS.good)}</td>
                      <td style={topCell}>{topText(row.group.bad, QUESTION_IDS.bad)}</td>
                      <td style={{ ...analysisCell, verticalAlign: 'middle', textAlign: 'right' }}>
                        <button
                          type="button"
                          aria-pressed={viewing}
                          aria-label={
                            viewing ? split.viewingLabel(row.name) : split.onlyLabel(row.name)
                          }
                          data-testid="reaction-split-only"
                          onClick={() => toggleScope(row.scope)}
                          style={{
                            ...smallButton,
                            border: `1px solid ${viewing ? accent.bg : colors.borderSecondary}`,
                            background: viewing ? accent.bg : colors.bgContainer,
                            color: viewing ? accent.onBg : colors.textSecondary,
                          }}
                        >
                          {viewing ? split.viewing : split.only}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

/** 눈에는 안 보이고 화면 읽기 도구만 읽는 글자(단추 칸의 열 이름). */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

function DetailPanel({
  pie,
  title,
  partsLabel,
  partsText,
  contacts,
  showAll,
  onShowAll,
}: {
  pie: PieKind;
  title: string;
  partsLabel: string;
  partsText: string;
  contacts: ReactionContact[];
  showAll: boolean;
  onShowAll: () => void;
}) {
  const tone = reactionPalette.detail[pie];
  const visible = showAll ? contacts : contacts.slice(0, DETAIL_ROWS);
  const small = { fontSize: 12.5, color: colors.textSecondary } as const;
  return (
    <section
      aria-labelledby="reaction-detail-title"
      data-testid="reaction-detail"
      style={{
        border: `1px solid ${tone.border}`,
        borderRadius: radius.card,
        padding: '14px 16px',
        background: tone.bg,
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <h3
          id="reaction-detail-title"
          data-testid="reaction-detail-title"
          style={{ margin: 0, fontSize: 15, fontWeight: 600, color: tone.title }}
        >
          {title}
        </h3>
        <span style={chartSecondary}>{texts.detail.hint}</span>
      </div>
      {contacts.length === 0 ? (
        <p data-testid="reaction-detail-empty" style={{ margin: 0, ...chartSecondary }}>
          {texts.detail.empty}
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px 24px',
            fontSize: typography.fontSizeSecondary,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={small}>{partsLabel}</div>
            <div data-testid="reaction-detail-parts">{partsText}</div>
          </div>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <div style={small}>{texts.detail.companies}</div>
            <ul
              data-testid="reaction-detail-contacts"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexWrap: 'wrap',
                gap: '2px 6px',
              }}
            >
              {visible.map((contact, index) => (
                <li
                  key={`${contact.oppId}-${contact.day}-${contact.method}-${index}`}
                  data-testid="reaction-detail-contact"
                >
                  <Link
                    to={`/opportunities/${contact.oppId}`}
                    aria-label={salesAnalysisTexts.openCompanyLabel(contact.name)}
                    data-testid="reaction-detail-link"
                    style={{ color: accent.text }}
                  >
                    {contact.name}
                  </Link>{' '}
                  {formatMonthDay(contact.day) ?? contact.day}{' '}
                  {labelFor(texts.detail.methods, contact.method)}
                  {index < visible.length - 1 ? ' ·' : ''}
                </li>
              ))}
            </ul>
            {contacts.length > visible.length ? (
              <button
                type="button"
                data-testid="reaction-detail-more"
                onClick={onShowAll}
                style={{
                  marginTop: 6,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: accent.text,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                {texts.detail.more(contacts.length - visible.length)}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

export interface ReactionAnalysisProps {
  /** 영업 분석의 기간 고르기와 같은 기간. 바뀌면 다시 읽는다. */
  period: AnalysisPeriod;
  /** 위 분석표의 [다시 시도]와 같이 다시 읽는다. */
  reloadKey: number;
}

export default function ReactionAnalysis({ period, reloadKey }: ReactionAnalysisProps) {
  const periodKey = `${period.from ?? ''}~${period.to ?? ''}`;
  // 이 카드만 다시 읽는 [다시 시도] 횟수.
  const [retry, setRetry] = useState(0);
  const key = `${reloadKey}|${retry}|${periodKey}`;
  const [state, setState] = useState<{
    key: string;
    data?: SalesReactions;
    failed?: boolean;
  } | null>(null);
  const [questions, setQuestions] = useState<SalesQuestions | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSalesReactions(controller.signal, period)
      .then((envelope) => {
        if (controller.signal.aborted) return;
        // 모양이 다른 응답(옛 서버 등)은 성공으로 치지 않는다.
        if (isReactions(envelope.data)) setState({ key, data: envelope.data });
        else setState({ key, failed: true });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, failed: true });
      });
    return () => controller.abort();
    // key가 period·reloadKey·retry를 대신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    let alive = true;
    getSalesQuestions()
      .then((envelope) => {
        if (alive) setQuestions(envelope.data);
      })
      .catch(() => {
        // 보기 글을 못 읽어도 id로 보인다(숫자는 그대로).
      });
    return () => {
      alive = false;
    };
  }, []);

  const current = state?.key === key ? state : null;
  if (!current) {
    return (
      <Shell>
        <p data-testid="reaction-loading" role="status" style={{ margin: 0, ...chartSecondary }}>
          {texts.loading}
        </p>
      </Shell>
    );
  }
  if (current.failed || !current.data) {
    return (
      <Shell>
        <div
          role="alert"
          data-testid="reaction-error"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}
        >
          <span>{texts.loadError}</span>
          <button
            type="button"
            data-testid="reaction-retry"
            onClick={() => setRetry((n) => n + 1)}
            style={{
              ...smallButton,
              border: `1px solid ${colors.border}`,
              background: colors.bgContainer,
              color: colors.text,
            }}
          >
            {states.retry}
          </button>
        </div>
      </Shell>
    );
  }
  const data = current.data;
  if (data.basis.answeredCount === 0) {
    return (
      <Shell
        aside={
          <span data-testid="reaction-basis" style={chartSecondary}>
            {texts.basis(data.basis.contactCount, data.basis.answeredCount)}
          </span>
        }
      >
        <p data-testid="reaction-empty" style={{ margin: 0, ...chartSecondary }}>
          {texts.empty}
        </p>
      </Shell>
    );
  }
  // 기간이 바뀌거나 다시 읽으면 골라 보던 묶음·펼친 조각은 처음으로 돌린다.
  return <ReactionBody key={key} data={data} questions={questions} />;
}
