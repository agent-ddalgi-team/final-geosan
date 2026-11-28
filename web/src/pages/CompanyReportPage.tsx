// 회사별 보고서(#565, PM 결정 2026-11-14): 상세의 [보고서]로 (새 창에) 여는 인쇄용 한 쪽 화면. 브라우저 인쇄로 PDF로 저장한다.
// 상세가 이미 부르는 응답 둘(상세 GET /opportunities/{id}, 꼬리 질문 파일 GET /sales-questions)만 읽는다.
// 저장된 값만 쓰고 AI를 다시 부르지 않으며, 값이 없는 칸은 지어내지 않고 "확인 필요"로 둔다.
// 영업 메모·대표번호·직접 적은 답 글은 싣지 않는다: 화면은 reportModelOf가 고른 값만 그린다.
// 날짜는 모두 연도까지 적는다(#719): 여러 해에 걸친 자료가 한 장에 섞여 "1/2"만으로는 언제인지 알 수 없다.
// 메뉴·담당자 고르기가 있는 공통 틀 없이 그려서 인쇄에 그대로 맞고, 단추·링크 줄은 인쇄할 때 숨긴다(.no-print).
// #972(PM이 고른 시안 2026-11-27): 맨 위 줄(돌아가기 · 만든 날 · 모두 펼치기 · 인쇄) + 왼쪽 목차 + 카드 묶음 여섯 개로 그린다.
// 묶음마다의 그림은 components/report/Report*.tsx에 있고, 이 화면은 불러오기와 "어느 점수 줄이 펼쳐졌나"만 갖고 있다.
// 맨 위 줄·목차·거르기 단추는 인쇄할 때 숨기고, 접힌 점수 이유와 걸러 둔 근거는 인쇄할 때 모두 나온다(styles.css).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getOpportunityDetail, getSalesQuestions } from '../api/client';
import type { OpportunityDetail, SalesQuestions } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import ReportEvidence from '../components/report/ReportEvidence';
import ReportGlance from '../components/report/ReportGlance';
import { reportModelOf } from '../components/report/reportModel';
import ReportQuestions from '../components/report/ReportQuestions';
import { ReportDirection, ReportSales } from '../components/report/ReportSales';
import ReportScores, { hasScoreReason } from '../components/report/ReportScores';
import { banner, companyReport, reportView } from '../labels/ko';
import { todayKst } from '../utils/time';

const texts = companyReport;

/** 목차 1~6: 누르면 그 묶음(같은 id)으로 간다. */
const TOC = [
  { id: 'report-glance', label: reportView.toc.glance },
  { id: 'report-scores', label: reportView.toc.scores },
  { id: 'report-evidence-section', label: reportView.toc.evidence },
  { id: 'report-questions', label: reportView.toc.questions },
  { id: 'report-sales', label: reportView.toc.sales },
  { id: 'report-direction-section', label: reportView.toc.direction },
] as const;

interface Loaded {
  key: string;
  detail?: OpportunityDetail;
  hasVirtualData?: boolean;
  /** 꼬리 질문 파일. 못 받았으면 null이고 questionsFailed가 참이다. */
  questions?: SalesQuestions | null;
  questionsFailed?: boolean;
  error?: unknown;
}

export default function CompanyReportPage() {
  const { oppId = '' } = useParams();
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** 이유가 펼쳐진 점수 항목 코드. 처음에는 모두 접혀 있다(인쇄할 때는 모두 펼쳐 나온다). */
  const [openScores, setOpenScores] = useState<ReadonlySet<string>>(() => new Set());
  /** 목차에서 마지막으로 고른 묶음. */
  const [section, setSection] = useState<string>(TOC[0].id);
  const requestKey = `${oppId}:${reload}`;

  useEffect(() => {
    const controller = new AbortController();
    // 꼬리 질문 파일을 못 받아도 보고서는 만들 수 있다. 다만 빠진 줄이 있다고 화면에 알린다.
    const questions = Promise.resolve()
      .then(() => getSalesQuestions())
      .then((envelope) => ({ data: envelope.data, failed: false }))
      .catch(() => ({ data: null, failed: true }));
    Promise.all([getOpportunityDetail(oppId, controller.signal), questions])
      .then(([envelope, asked]) =>
        setLoaded({
          key: requestKey,
          detail: envelope.data,
          hasVirtualData: Boolean(envelope.meta?.hasVirtualData),
          questions: asked.data,
          questionsFailed: asked.failed,
        }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, error });
      });
    return () => controller.abort();
  }, [oppId, requestKey]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  const current = loaded?.key === requestKey ? loaded : null;
  const notFound = current?.error instanceof ApiError && current.error.status === 404;
  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (notFound) state = 'empty';
  else if (current.error) state = 'error';

  const detail = current?.detail;
  const hasVirtualData = Boolean(current?.hasVirtualData);
  const questions = current?.questions ?? null;
  const model = useMemo(
    () => (detail ? reportModelOf(detail, hasVirtualData, questions) : null),
    [detail, hasVirtualData, questions],
  );
  const detailPath = `/opportunities/${encodeURIComponent(oppId)}`;

  /** 펼칠 이유가 있는 점수 줄의 코드. [근거 설명 모두 펼치기]가 이 줄들을 한 번에 편다. */
  const expandable = useMemo(
    () => (model?.scores ?? []).filter(hasScoreReason).map((row) => row.code),
    [model],
  );
  const allOpen = expandable.length > 0 && expandable.every((code) => openScores.has(code));
  const toggleScore = useCallback((code: string) => {
    setOpenScores((before) => {
      const next = new Set(before);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);
  const toggleAll = () => setOpenScores(allOpen ? new Set() : new Set(expandable));

  const goTo = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    // 주소의 # 뒤를 바꾸지 않고 그 묶음으로 화면을 옮기고, 키보드 사용자를 위해 초점도 옮긴다.
    event.preventDefault();
    setSection(id);
    target.scrollIntoView?.({ block: 'start' });
    target.focus({ preventScroll: true });
  };

  const madeAt = texts.madeAt(todayKst());

  return (
    <div className="report-page" data-testid="report-page">
      <div className="no-print report-topbar" data-testid="report-actions">
        <Link to={detailPath} className="report-btn" data-testid="report-back-link">
          {reportView.back(texts.backToDetail)}
        </Link>
        <span className="report-topbar-title">{texts.pageTitle}</span>
        <span className="report-dim" data-testid="report-made-at">
          {madeAt}
        </span>
        {model ? (
          <div className="report-topbar-buttons">
            {expandable.length > 0 ? (
              <button
                type="button"
                className="report-btn"
                aria-pressed={allOpen}
                onClick={toggleAll}
                data-testid="report-expand-all-button"
              >
                {allOpen ? reportView.collapseAll : reportView.expandAll}
              </button>
            ) : null}
            <button
              type="button"
              className="report-btn report-btn-primary"
              onClick={() => window.print()}
              data-testid="report-print-button"
            >
              {texts.print}
            </button>
          </div>
        ) : null}
      </div>
      <div className="report-body">
        {model ? (
          <nav
            aria-label={reportView.toc.title}
            className="no-print report-toc"
            data-testid="report-toc"
          >
            <p className="report-eyebrow">{reportView.toc.title}</p>
            <ol>
              {TOC.map((item, index) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={section === item.id ? 'location' : undefined}
                    onClick={(event) => goTo(event, item.id)}
                    data-testid="report-toc-link"
                  >
                    <b>{index + 1}</b>
                    {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <main id="main" className="report-main">
          <FiveStates
            state={state}
            data-testid="report-states"
            emptyText={texts.notFound}
            errorTitle={texts.loadError}
            error={current?.error}
            onRetry={retry}
            partialNotice={current?.questionsFailed ? texts.questionsFailed : undefined}
          >
            {model ? (
              <article data-testid="company-report" className="report-article">
                <p className="report-print-head" data-testid="report-print-head">
                  <b>{reportView.printHead(texts.pageTitle, model.title)}</b>
                  <span>{madeAt}</span>
                </p>
                <ReportGlance
                  isVirtual={model.isVirtual}
                  glance={model.glance}
                  scoreSummary={model.scoreSummary}
                  sales={model.sales}
                />
                {model.glance.reason ? (
                  <div className="report-card report-reason">
                    <p className="report-eyebrow">{reportView.reasonTitle}</p>
                    <p data-testid="report-reason">{model.glance.reason}</p>
                  </div>
                ) : null}
                <ReportScores
                  scores={model.scores}
                  summary={model.scoreSummary}
                  open={openScores}
                  onToggle={toggleScore}
                />
                <ReportEvidence evidence={model.evidence} groups={model.evidenceGroups} />
                <ReportQuestions key={oppId} oppId={oppId} known={model.known} ask={model.ask} />
                <ReportSales sales={model.sales} progress={model.progress} questions={questions} />
                <ReportDirection
                  lines={model.direction}
                  nextCall={model.nextCall}
                  detailPath={detailPath}
                />
                <p className="report-dim report-footer" data-testid="report-footer">
                  {reportView.footer(banner.internalOnly)}
                </p>
              </article>
            ) : null}
          </FiveStates>
        </main>
      </div>
    </div>
  );
}
