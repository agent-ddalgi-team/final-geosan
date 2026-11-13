// 근거 상세(S2). 읽는 보고서처럼 위·아래 두 덩어리로 나눈다(#674, PM 결정 2026-11-13).
// 위(읽는 곳): 머리(목록으로·[관심]·[다시 조사]·단계 진행 막대) → "한눈에" 상자 → 1. 왜 이 회사인가(추천 근거 + 인용·출처)
//   → 2. 통화에서 확인할 것(읽기 전용) → 3. 점수 자세히 보기(접힘, 안에 AI 점수 입력 제안 [확정]·[고치기]).
// 아래(적는 곳): 검토 의견 → 기록 남기기(접촉·꼬리 질문·한 줄 메모·다음 일정) → 활동 이력 → 비슷한 회사 참고(#269).
// 읽는 곳의 단추는 [목록으로]·[관심]·[다시 조사]와 접힌 구역을 여는 단추뿐이다. 서버 창구는 그대로 두고 화면에서만 부르지 않는다.
// 머리의 [관심] 단추(#357): 검토 의견·메모·영업 기록을 저장하면 서버가 관심을 켜므로, 그 저장 뒤에 관심 값만 조용히 다시 읽는다.
import { useCallback, useEffect, useState } from 'react';
import { Button } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, getOpportunityDetail, getSalesQuestions } from '../api/client';
import type {
  ContactCount,
  ContactMethod,
  Meta,
  OpportunityDetail,
  OutcomeRecord,
  SalesQuestions,
  SalesStepView,
} from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useBookmark } from '../components/common/useBookmark';
import CallChecklist from '../components/detail/CallChecklist';
import DetailGlance from '../components/detail/DetailGlance';
import DetailSection from '../components/detail/DetailSection';
import HeaderSection from '../components/detail/HeaderSection';
import IndustryChips from '../components/detail/IndustryChips';
import ReasonsSection from '../components/detail/ReasonsSection';
import ScoresCollapse from '../components/detail/ScoresCollapse';
import WhyThisCompany from '../components/detail/WhyThisCompany';
import { useFrame } from '../components/frame/FrameContext';
import OpinionArea from '../components/opinion/OpinionArea';
import PeersArea from '../components/peers/PeersArea';
import ActivityTimeline from '../components/records/ActivityTimeline';
import { choiceMarksOf } from '../components/records/ChoiceQuestion';
import RecordsArea from '../components/records/RecordsArea';
import ReviewArea from '../components/review/ReviewArea';
import { detailReport, frame, opinionArea, peersArea, recordsArea, states } from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';

/** "재평가됨" 띠가 보이는 시간(ms, interaction-spec 2.16). */
export const REEVALUATED_BANNER_MS = 10_000;

interface Result {
  key: string;
  data?: OpportunityDetail;
  meta?: Meta;
  error?: unknown;
}

export default function OpportunityDetailPage() {
  const { oppId = '' } = useParams();
  const navigate = useNavigate();
  const { config, setBannerMeta, setPageTitle } = useFrame();
  const [reload, setReload] = useState(0);
  // 기록을 저장할 때마다 올라가서 타임라인이 새로 불러온다.
  const [timelineVersion, setTimelineVersion] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = `${oppId}:${reload}`;

  useEffect(() => {
    const controller = new AbortController();
    getOpportunityDetail(oppId, controller.signal)
      .then((envelope) => setResult({ key: requestKey, data: envelope.data, meta: envelope.meta }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, error });
      });
    return () => controller.abort();
  }, [oppId, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const data = current?.data ?? null;
  const meta = current?.meta ?? null;

  // 접촉 횟수는 머리가 보인다. 기록 영역에서 접촉을 저장하면 서버 값에 1을 더해 바로 보이고,
  // 상세를 새로 불러오면(다른 응답이 오면) 다시 서버 값을 쓴다.
  const [counted, setCounted] = useState<{ data: OpportunityDetail; count: ContactCount } | null>(
    null,
  );
  const contactCount =
    counted && counted.data === data ? counted.count : (data?.records.contactCount ?? null);
  const onContactRecorded = (method: ContactMethod) => {
    if (!data) return;
    const prev = contactCount ?? { total: 0, call: 0, email: 0, visit: 0 };
    setCounted({
      data,
      count: {
        total: prev.total + 1,
        call: prev.call + (method === 'CALL' ? 1 : 0),
        email: prev.email + (method === 'EMAIL' ? 1 : 0),
        visit: prev.visit + (method === 'VISIT' ? 1 : 0),
      },
    });
  };

  // #607 세부 단계는 서버가 기록에서 계산한다. 접촉·단계 고치기를 저장하면 상세를 조용히 다시 받아
  // 세부 단계만 바꾼다(화면 전체를 다시 그리지 않아 입력 중인 칸과 머리 접촉 횟수가 그대로다).
  const [fresh, setFresh] = useState<{
    data: OpportunityDetail;
    step: SalesStepView | null;
    lastContactAt: string | null;
  } | null>(null);
  const salesStep = fresh && fresh.data === data ? fresh.step : (data?.records.salesStep ?? null);
  const onSalesStepChanged = () => {
    if (!data) return;
    Promise.resolve()
      .then(() => getOpportunityDetail(oppId))
      .then((envelope) =>
        setFresh({
          data,
          step: envelope.data.records.salesStep ?? null,
          lastContactAt: envelope.data.records.lastContactAt ?? null,
        }),
      )
      .catch(() => {
        // 못 받으면 지난 요약을 그대로 둔다. 저장은 이미 끝났고 다음에 상세를 열면 새 값이 보인다.
      });
  };

  // 영업 단계·다음 일정을 저장하면 맨 위 진행 막대(끝 칸 "거절·보류·성사", 다음 일정 줄)도 그 값으로 바꾼다.
  const [savedOutcome, setSavedOutcome] = useState<{
    data: OpportunityDetail;
    outcome: OutcomeRecord;
  } | null>(null);
  const outcome =
    savedOutcome && savedOutcome.data === data
      ? savedOutcome.outcome
      : (data?.records.outcome ?? null);

  const bookmarkState = useBookmark(oppId, data, data?.records.bookmark ?? null);

  // 단계 진행 막대의 단계 이름·순서와 "통화에서 확인할 것"의 물을 말은 서버 질문 파일에서 온다.
  // 못 받으면 코드표 순서·화면 문구로 대신한다(기록 구역은 지금처럼 스스로 불러온다).
  const [salesQuestions, setSalesQuestions] = useState<SalesQuestions | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => getSalesQuestions())
      .then((envelope) => {
        if (alive) setSalesQuestions(envelope.data);
      })
      .catch(() => {
        // 질문 파일 없이도 막대와 목록은 그려진다. 기록 구역이 불러오기 실패를 따로 알린다.
      });
    return () => {
      alive = false;
    };
  }, []);

  // "점수 자세히 보기"의 펼침: 제안을 확정하면 상세를 다시 불러오는데, 그때도 펼친 채로 둔다. 다른 회사로 가면 접힌다.
  const [scoresOpenFor, setScoresOpenFor] = useState<string | null>(null);

  // 이름(h1)은 기업·기회 이름으로, 띠는 이 응답의 meta로(재평가됨은 10초만).
  useEffect(() => {
    if (!data) return undefined;
    setPageTitle(data.header.title);
    return () => setPageTitle(null);
  }, [data, setPageTitle]);

  useEffect(() => {
    if (!meta || !data) return undefined;
    setBannerMeta({ ...meta, reevaluated: data.reevaluated });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (data.reevaluated) {
      timer = setTimeout(
        () => setBannerMeta({ ...meta, reevaluated: false }),
        REEVALUATED_BANNER_MS,
      );
    }
    return () => {
      if (timer) clearTimeout(timer);
      setBannerMeta(null);
    };
  }, [data, meta, setBannerMeta]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  const goList = () => navigate('/opportunities');

  const notFound = current?.error instanceof ApiError && current.error.status === 404;
  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (notFound) state = 'empty';
  else if (current.error) state = 'error';

  const ownerName = config?.staff.find((entry) => entry.key === data?.header.owner)?.displayName;
  // AI 점수 입력 제안 줄은 "점수 자세히 보기" 안에서 [확정]·[고치기]로 다룬다.
  const itemProposals = (data?.reviewItems ?? []).filter(
    (item) => item.kind === 'ITEM_INPUT_PROPOSAL',
  );
  // 마지막 접촉 날짜: 기록 구역에서 접촉을 저장하면 그 뒤에 조용히 다시 받은 값으로 바뀐다.
  const lastContactAt =
    fresh && fresh.data === data ? fresh.lastContactAt : (data?.records.lastContactAt ?? null);

  return (
    <FiveStates
      state={state}
      emptyText={states.detailNotFound}
      emptyAction={
        <Button
          type="primary"
          href="/opportunities"
          onClick={(event) => {
            event.preventDefault();
            goList();
          }}
          data-testid="not-found-back-button"
        >
          {frame.backToList}
        </Button>
      }
      errorTitle={states.detailError}
      error={current?.error}
      onRetry={retry}
    >
      {data ? (
        <div data-testid="opportunity-detail" style={{ display: 'grid', gap: spacing.cardGap }}>
          <HeaderSection
            oppId={oppId}
            onReload={() => {
              setReload((n) => n + 1);
              setTimelineVersion((n) => n + 1);
            }}
            header={data.header}
            bookmark={bookmarkState.bookmark}
            onBookmarkChanged={(next) => {
              bookmarkState.change(next);
              setTimelineVersion((n) => n + 1);
            }}
            salesStep={salesStep}
            outcome={outcome}
            contactTotal={contactCount?.total ?? 0}
            questions={salesQuestions}
            ownerName={ownerName}
            classificationOverrides={config?.classificationLabels}
          />
          <DetailGlance
            header={data.header}
            processLinks={data.processLinks}
            evidence={data.evidence}
            reviewItems={data.reviewItems}
            requirements={data.requirements}
            contactCount={contactCount}
            lastContactAt={lastContactAt}
          />
          <WhyThisCompany
            header={data.header}
            reasons={data.reasons}
            scoreItems={data.scores?.items}
            evidence={data.evidence}
          />
          {data.reviewItems !== undefined ? (
            <CallChecklist
              header={data.header}
              reasons={data.reasons}
              processLinks={data.processLinks}
              reviewItems={data.reviewItems}
              requirements={data.requirements}
              salesStep={salesStep}
              scoreItems={data.scores?.items}
              questions={salesQuestions}
            />
          ) : (
            // 서버가 검토사항을 안 주는 옛 응답: 후속 조치와 거산 역량 확인사항을 예전 부품으로 보인다.
            <ReasonsSection reasons={data.reasons} onlyFollowUp />
          )}
          {/* "고객이 요구하는 것과 거산의 준비 상태"·"공정 적합성 검토" 구역은 그리지 않는다(PM 결정 2026-11-13 #659).
              서버 응답(requirements·processLinks)은 그대로 온다. 공정은 "한눈에"의 "거산과 맞는 점"에 적는다. */}
          <ScoresCollapse
            scores={data.scores}
            scoreDisplay={data.header.scoreDisplay}
            open={scoresOpenFor === oppId}
            onOpenChange={(open) => setScoresOpenFor(open ? oppId : null)}
          >
            {itemProposals.length > 0 ? (
              <div data-testid="score-proposals" style={{ display: 'grid', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: typography.fontSize, fontWeight: 600 }}>
                  {detailReport.scores.proposalsTitle}
                </h3>
                <span
                  style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
                >
                  {detailReport.scores.proposalsHint}
                </span>
                <ReviewArea
                  key={`${oppId}:${data.evalId}:proposals`}
                  oppId={oppId}
                  evalId={data.evalId}
                  items={itemProposals}
                  proposalsOnly
                  onProposalSaved={() => {
                    // AI 제안을 확정·고치면 점수가 바뀌어 다시 평가되므로 상세와 활동 이력을 새로 불러온다(#498).
                    setReload((n) => n + 1);
                    setTimelineVersion((n) => n + 1);
                  }}
                />
              </div>
            ) : null}
          </ScoresCollapse>
          <div
            role="separator"
            aria-label={detailReport.writeDivider}
            data-testid="detail-write-divider"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: spacing.cardGap,
              color: colors.textSecondary,
              fontSize: typography.fontSizeSecondary,
            }}
          >
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: colors.border }} />
            <span>{detailReport.writeDivider}</span>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: colors.border }} />
          </div>
          {/* 산업군 칩(#646): AI 제안을 [확정]·[고치기]. 저장하면 상세와 활동 이력을 새로 불러온다. */}
          <IndustryChips
            key={`${oppId}:industries`}
            oppId={oppId}
            header={data.header}
            onSaved={() => {
              setReload((n) => n + 1);
              setTimelineVersion((n) => n + 1);
            }}
          />
          <DetailSection id="detail-opinion" title={opinionArea.groupLabel}>
            {data.evalId ? (
              <OpinionArea
                key={`${oppId}:${data.evalId}`}
                oppId={oppId}
                evalId={data.evalId}
                record={data.records.opinion ?? null}
                onSaved={() => void bookmarkState.sync()}
              />
            ) : (
              <p style={{ margin: 0 }}>{states.notEvaluatedYet}</p>
            )}
          </DetailSection>
          <DetailSection id="detail-records" title={recordsArea.title}>
            <RecordsArea
              key={`${oppId}:records`}
              oppId={oppId}
              evalId={data.evalId}
              outcome={data.records.outcome ?? null}
              salesStep={salesStep}
              onSalesStepChanged={onSalesStepChanged}
              onOutcomeSaved={(saved) => setSavedOutcome({ data, outcome: saved })}
              choiceMarks={choiceMarksOf(data)}
              // 꼬리 질문으로 공정·산업을 확정하면 다시 평가되므로 상세 전체를 새로 불러온다(#652).
              onCompanyConfirmed={() => setReload((n) => n + 1)}
              onContactRecorded={onContactRecorded}
              onRecorded={() => {
                setTimelineVersion((n) => n + 1);
                void bookmarkState.sync();
              }}
            />
            <ActivityTimeline
              key={`${oppId}:timeline`}
              oppId={oppId}
              refreshKey={timelineVersion}
              onCancelled={() => {
                // 취소하면 현재 단계·일정·접촉 횟수·카드 꼬리표가 이전 값으로 돌아가므로 상세를 다시 불러온다(#254).
                // 활동 이력은 이 부품이 스스로 다시 불러온다.
                setReload((n) => n + 1);
              }}
            />
          </DetailSection>
          <DetailSection id="detail-peers" title={peersArea.title}>
            <PeersArea key={`${oppId}:peers`} oppId={oppId} />
          </DetailSection>
        </div>
      ) : null}
    </FiveStates>
  );
}
