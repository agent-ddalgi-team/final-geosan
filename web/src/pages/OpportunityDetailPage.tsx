// 근거 상세(S2). #996(PM 결정 2026-11-29) 구성:
//   ① 머리 — "← 목록으로" · 이번 달 AI 사용 / 회사 이름(h1) + 꼬리표 · [관심] · [다시 조사] · 보고서 / 품목 줄
//   ② 요약 줄 — 산업 · 공정 · 소재 · 위치와 거리 · 홈페이지 + [정보 고치기](누르면 바로 아래에 고치기 부품이 펼쳐진다)
//   ③ 담당자 의견 — 요약 줄 아래 오른쪽 끝 [영업 대상][검토 중][제외]
//   ④ 둘째 줄 — 영업 단계(축소판) | 담당자 연락처(회사 대표번호 · 대표명 · 상대 담당자)
//   ⑤ 셋째 줄 — 한눈에 + 왜 이 회사인가(한 블록) | 기록(활동 이력). 둘째 줄과 같은 격자(1.25 : 1)라 칸 경계가 맞는다.
//   ⑥ 그 아래 — 비슷한 회사 참고 → 지난 평가와 달라진 것 → 점수 자세히 보기(접힘, 안에 AI 점수 입력 제안 [확정]·[고치기])
//   ⑦ 오른쪽 영업 코치 칸 — 다음 일정 · 확인사항 · 기록 남기기(#773, 그대로)
// 본문이 좁으면 모두 한 줄로 쌓인다: 머리 → 요약 줄 → 담당자 의견 → 영업 단계 → 담당자 연락처 → 한눈에 + 왜 이 회사인가 → 기록 → …
// 전의 순서는 #980(2026-11-28), #674(2026-11-13)였다. 서버 창구와 응답 칸은 그대로다(화면 자리만 바꿨다).
// 이름(h1)은 이 화면이 스스로 그린다(전에는 공통 틀이 "회사 이름 · 품목"을 한 줄로 그렸다). 경로 설정에서 틀의 제목을 껐다.
// 머리의 [기록 남기기 ↓](#691, 이동만)는 기록 칸이 본문 아래에 있는 화면(좁은 기기 · 영업 코치 칸이 없는 화면)에서만 보인다.
// 머리의 [관심] 단추(#357): 검토 의견·메모·영업 기록을 저장하면 서버가 관심을 켜므로, 그 저장 뒤에 관심 값만 조용히 다시 읽는다.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, getOpportunityDetail, getSalesQuestions } from '../api/client';
import type {
  CallPrepNote,
  ContactCount,
  ContactMethod,
  Meta,
  OpinionRecord,
  OpportunityDetail,
  OutcomeRecord,
  SalesQuestions,
  SalesStepView,
} from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useBookmark } from '../components/common/useBookmark';
import HandoffBox from '../components/records/HandoffBox';
import CallChecklist from '../components/detail/CallChecklist';
import CoachNextSchedule from '../components/detail/CoachNextSchedule';
import ContactCard from '../components/detail/ContactCard';
import ContactPersons from '../components/detail/ContactPersons';
import DetailGlance from '../components/detail/DetailGlance';
import DetailSection from '../components/detail/DetailSection';
import DetailSummaryRow from '../components/detail/DetailSummaryRow';
import HeaderSection from '../components/detail/HeaderSection';
import IndustryChips from '../components/detail/IndustryChips';
import ReasonsSection from '../components/detail/ReasonsSection';
import ScoreChangeLine from '../components/detail/ScoreChangeLine';
import ScoresCollapse from '../components/detail/ScoresCollapse';
import StageCard from '../components/detail/StageCard';
import WhyThisCompany from '../components/detail/WhyThisCompany';
import { detailMainCell, detailRowStyle, detailSideCell } from '../components/detail/detailGrid';
import { useFrame } from '../components/frame/FrameContext';
import OpinionArea from '../components/opinion/OpinionArea';
import PeersArea from '../components/peers/PeersArea';
import ActivityTimeline from '../components/records/ActivityTimeline';
import { choiceMarksOf } from '../components/records/ChoiceQuestion';
import RecordsArea, { recordsEntryInputId } from '../components/records/RecordsArea';
import ReportLink from '../components/report/ReportLink';
import ReviewArea from '../components/review/ReviewArea';
import {
  coachSteps,
  detailReport,
  frame,
  peersArea,
  PLATER_DECIDER_QUESTION_ID,
  recordsArea,
  states,
} from '../labels/ko';
import { colors, detailLayout, detailTheme, spacing, typography } from '../theme/tokens';
import { formatMonthDay } from '../utils/time';

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
  const { config, setBannerMeta, dockSlot, narrowDevice } = useFrame();
  const [reload, setReload] = useState(0);
  // 기록을 저장할 때마다 올라가서 타임라인이 새로 불러온다.
  const [timelineVersion, setTimelineVersion] = useState(0);
  // #847: 확정된 것(들은 답 · 단계 고치기 · 다음 일정)을 그릴 왼쪽 영업 단계 아래 자리.
  const [stageSlot, setStageSlot] = useState<HTMLDivElement | null>(null);
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

  // 꼬리 질문으로 공정·산업을 확정하면 상세 전체를 다시 받는다(#652). 그동안 화면을 비우면 맨 위로 튀고
  // 기록 칸의 "저장됨" 알림과 고른 종류가 사라지므로, 이 다시 받기만은 지난 화면을 그대로 둔 채 조용히 한다(#691).
  const [quietKey, setQuietKey] = useState<string | null>(null);
  const reloadQuietly = () => {
    setQuietKey(`${oppId}:${reload + 1}`);
    setReload(reload + 1);
  };
  const stale =
    quietKey === requestKey && result?.data && result.key.startsWith(`${oppId}:`) ? result : null;
  const current = result?.key === requestKey ? result : stale;
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
    opinion: OpinionRecord | null;
    callPrep: CallPrepNote | null;
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
          opinion: envelope.data.records.opinion ?? null,
          callPrep: envelope.data.records.callPrep ?? null,
        }),
      )
      .catch(() => {
        // 못 받으면 지난 요약을 그대로 둔다. 저장은 이미 끝났고 다음에 상세를 열면 새 값이 보인다.
      });
  };

  // 검토 의견(#697): 접촉을 남기면 서버가 같은 저장 안에서 의견을 "영업 대상"으로 정할 수 있다.
  // 접촉 저장 뒤 조용히 다시 받은 의견이 있으면 그것을, 없으면 처음 받은 의견을 쓴다.
  const serverOpinion =
    fresh && fresh.data === data ? fresh.opinion : (data?.records.opinion ?? null);
  // 의견 칸에서 방금 저장한 의견. 서버에서 받은 것보다 새 것일 때만 쓴다.
  const [savedOpinion, setSavedOpinion] = useState<{
    data: OpportunityDetail;
    record: OpinionRecord;
  } | null>(null);
  const localOpinion = savedOpinion && savedOpinion.data === data ? savedOpinion.record : null;
  const opinionNow =
    localOpinion && localOpinion.version > (serverOpinion?.version ?? 0)
      ? localOpinion
      : serverOpinion;

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

  // 띠는 이 응답의 meta로(재평가됨은 10초만). 이름(h1)은 머리가 스스로 그린다(#996).
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
  /** 머리의 [기록 남기기]: 기록 칸으로 내려가 첫 입력(종류)에 초점을 둔다. 저장은 하지 않는다. */
  const goRecord = () => {
    const input = document.getElementById(recordsEntryInputId(oppId));
    const target = input ?? document.getElementById('detail-records');
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
  };

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

  // 전달 사항·통화 전·기록 남기기(#771·#750·#742). #773부터 넓은 화면은 오른쪽 영업 코치 칸으로 보낸다.
  const checkStorageKey = !data
    ? ''
    : `${oppId}:${data.records.contactCount?.total ?? 0}:${
        (fresh && fresh.data === data ? fresh.callPrep : data.records.callPrep)?.noteId ?? ''
      }`;
  const recordInput = !data ? null : (
    <>
      {/* #980(PM 결정 2026-11-28): 영업 코치 맨 위 "다음 일정" — 영업 홈 표와 같은 공용 칸으로 바로 잡고 바꾼다. */}
      <CoachNextSchedule
        key={`${oppId}:next-schedule:${outcome?.version ?? 0}`}
        oppId={oppId}
        outcome={outcome}
        onSaved={() => {
          reloadQuietly();
          setTimelineVersion((n) => n + 1);
        }}
      />
      {/* #847 확인사항: 코치가 지난 통화 뒤 정리한 것(#750)과 전의 "통화에서 확인할 것"을 주제별로 묶어 통화 중 체크. */}
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
          title={coachSteps.before}
          grouped
          // 접촉을 저장해 접촉 수나 다음 통화 준비가 바뀌면 체크를 처음 값으로 되돌린다(#957: 체크는 이 브라우저에 기억).
          key={checkStorageKey}
          storageKey={checkStorageKey}
          prep={fresh && fresh.data === data ? fresh.callPrep : (data.records.callPrep ?? null)}
          // #847: 확인 전 전달 사항은 확인사항 맨 위에(남기는 것은 대화 기록의 메모 "받는 사람").
          top={
            <HandoffBox
              key={`${oppId}:handoff`}
              oppId={oppId}
              evalId={data.evalId}
              handoffs={data.records.handoffs ?? []}
              lastActor={data.records.outcome?.updatedBy ?? null}
              listOnly
              onChanged={() => {
                reloadQuietly();
                setTimelineVersion((n) => n + 1);
              }}
            />
          }
        />
      ) : null}
      {/* #847 대화 기록: 이번 통화 메모·결과. [보내기] 뒤 코치 답은 이 칸 안에 펴진다. */}
      <h3
        data-testid="coach-step-record"
        style={{ margin: '16px 0 8px', fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
      >
        {coachSteps.record}
      </h3>
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
        onCompanyConfirmed={reloadQuietly}
        excluded={opinionNow?.opinion === 'NOT_TARGET'}
        inCoach
        // #847: 확정된 것(들은 답 · 단계 고치기 · 다음 일정)은 넓은 화면에서 왼쪽 영업 단계 아래에.
        sideSlot={dockSlot ? stageSlot : null}
        onHandoffSent={reloadQuietly}
        onContactRecorded={onContactRecorded}
        onRecorded={() => {
          setTimelineVersion((n) => n + 1);
          void bookmarkState.sync();
        }}
      />
    </>
  );

  // 접촉 횟수 · 마지막 접촉: 전에는 "한눈에 › 영업 상태" 줄이었다. #996부터 "기록" 칸 제목 옆에 보인다.
  const lastContact = formatMonthDay(lastContactAt);
  const contactParts = contactCount
    ? [
        recordsArea.contactCount(
          contactCount.total,
          contactCount.call,
          contactCount.email,
          contactCount.visit,
        ),
        contactCount.total > 0 && lastContact ? detailReport.glance.lastContact(lastContact) : null,
      ].filter((part): part is string => part !== null)
    : [];
  // [기록 남기기 ↓]는 기록 칸이 본문 아래에 있을 때만(좁은 기기, 또는 영업 코치 칸이 없는 화면). 넓은 화면은 칸이 늘 옆에 있다.
  const recordBelow = narrowDevice === true || !dockSlot;
  const reloadAll = () => {
    setReload((n) => n + 1);
    setTimelineVersion((n) => n + 1);
  };

  return (
    <>
      {/* 이름을 아직 모를 때(불러오는 중 · 못 찾음 · 오류)의 제목. 불러오면 머리가 회사 이름을 h1으로 그린다. */}
      {data ? null : (
        <h1
          data-testid="detail-page-title"
          style={{ margin: '0 0 16px', fontSize: detailLayout.nameSize, fontWeight: 700 }}
        >
          {frame.pageTitleDetail}
        </h1>
      )}
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
            {/* ① 머리 · ② 요약 줄 · ③ 담당자 의견 */}
            <HeaderSection
              oppId={oppId}
              onReload={reloadAll}
              onGoRecord={recordBelow ? goRecord : undefined}
              header={data.header}
              bookmark={bookmarkState.bookmark}
              onBookmarkChanged={(next) => {
                bookmarkState.change(next);
                setTimelineVersion((n) => n + 1);
                // 관심을 켜면 조사가 저절로 시작될 수 있다(#690). 머리의 조사 상태("조사 중" 등)가
                // 바로 보이게 상세를 조용히 다시 읽는다(#719). 끌 때는 바뀌는 것이 없어 읽지 않는다.
                if (next?.active) reloadQuietly();
              }}
              ownerName={ownerName}
              classificationOverrides={config?.classificationLabels}
              reportLink={<ReportLink oppId={oppId} />}
              summary={
                <DetailSummaryRow
                  oppId={oppId}
                  evalId={data.evalId}
                  header={data.header}
                  processLinks={data.processLinks}
                  evidence={data.evidence}
                  reviewItems={data.reviewItems}
                  // #847: 공정 [고치기]의 보기는 질문 파일의 공정 고르기 보기(거산 공정 목록)를 쓴다.
                  processOptions={salesQuestions?.questions
                    .find((question) => question.choices === 'PROCESS')
                    ?.answers.map((answer) => ({ code: answer.answerId, name: answer.label }))}
                  // #958: 소재 [고치기]의 보기는 설정 응답의 거산 처리 소재.
                  materialOptions={config?.materialOptions}
                  // #803: 산업은 [확정]·[고치기] 칩으로(전에는 "한눈에" 산업 칸, #996부터 [정보 고치기] 안).
                  industryEditor={
                    <IndustryChips
                      key={`${oppId}:industries`}
                      oppId={oppId}
                      header={data.header}
                      bare
                      onSaved={reloadAll}
                    />
                  }
                  // 고르면 다시 평가되므로 상세와 활동 이력을 새로 불러온다(#677).
                  onSaved={reloadAll}
                />
              }
              // #803 → #996: 검토 의견은 요약 줄 아래 오른쪽 끝 "담당자 의견" 칸.
              opinion={
                data.evalId ? (
                  <span data-testid="detail-opinion">
                    <OpinionArea
                      // 접촉 저장이 의견을 바꿨으면(#697) 서버 의견의 버전이 달라져 새 값으로 다시 그린다.
                      key={`${oppId}:${data.evalId}:${serverOpinion?.version ?? 0}`}
                      oppId={oppId}
                      evalId={data.evalId}
                      record={opinionNow}
                      variant="box"
                      onSaved={(record) => {
                        setSavedOpinion({ data, record });
                        void bookmarkState.sync();
                      }}
                    />
                  </span>
                ) : null
              }
            />
            {/* ④ 둘째 줄: 영업 단계 | 담당자 연락처. 셋째 줄과 같은 격자를 쓴다(칸 경계가 맞는다). */}
            <div data-testid="detail-row-stage" style={detailRowStyle}>
              <div data-testid="detail-cell-stage" style={detailMainCell}>
                <StageCard
                  salesStep={salesStep}
                  outcome={outcome}
                  contactTotal={contactCount?.total ?? 0}
                  questions={salesQuestions}
                  // #847 → #996: 넓은 화면에서는 오른쪽 기록 칸의 "지금까지 들은 답 · 단계 고치기"가
                  // 영업 단계 그림 바로 아래에 작은 링크 모양으로 그려진다.
                  extra={
                    dockSlot ? <div ref={setStageSlot} data-testid="detail-stage-slot" /> : null
                  }
                />
              </div>
              <div data-testid="detail-cell-contacts" style={detailSideCell}>
                <ContactCard header={data.header} fix={{ oppId, onSaved: reloadAll }}>
                  <ContactPersons
                    key={`${oppId}:contacts`}
                    oppId={oppId}
                    onChanged={() => setTimelineVersion((n) => n + 1)}
                  />
                </ContactCard>
              </div>
            </div>
            {/* ⑤ 셋째 줄: 한눈에 + 왜 이 회사인가(한 블록) | 기록(활동 이력). */}
            <div data-testid="detail-row-main" style={detailRowStyle}>
              <div data-testid="detail-cell-glance" style={detailMainCell}>
                <div
                  data-testid="detail-glance-why"
                  style={{
                    display: 'grid',
                    alignContent: 'start',
                    padding: detailLayout.cardPadding,
                    background: colors.bgContainer,
                    border: `1px solid ${detailTheme.border}`,
                    borderRadius: detailTheme.radius,
                    boxSizing: 'border-box',
                    minWidth: 0,
                  }}
                >
                  <DetailGlance
                    header={data.header}
                    processLinks={data.processLinks}
                    evidence={data.evidence}
                    reviewItems={data.reviewItems}
                    requirements={data.requirements}
                    scoreItems={data.scores?.items}
                    // #803: 작은 지도(좌표가 없거나 가상 사례면 서버가 null을 준다).
                    map={data.map ?? null}
                    // #860: 통화에서 들은 "도금 업체는 누가 정하나요?" 답이 공급망 위치 줄에 먼저 보인다.
                    plateDecider={
                      (salesStep?.known ?? []).find(
                        (answer) => answer.questionId === PLATER_DECIDER_QUESTION_ID,
                      ) ?? null
                    }
                    // #958: 위치 줄의 주소·회사 이름 [고치기].
                    companyInfo={{ oppId, onSaved: reloadAll }}
                  />
                  {/* 한 블록 안의 구분 띠: 위는 "한눈에", 아래는 "왜 이 회사인가". 카드 좌우 끝까지 닿는다. */}
                  <div
                    aria-hidden="true"
                    data-testid="detail-block-band"
                    style={{
                      margin: '16px -20px 14px',
                      height: detailLayout.bandHeight,
                      background: detailLayout.bandBg,
                      borderTop: `1px solid ${detailTheme.border}`,
                      borderBottom: `1px solid ${detailTheme.border}`,
                    }}
                  />
                  <WhyThisCompany
                    header={data.header}
                    reasons={data.reasons}
                    scoreItems={data.scores?.items}
                    evidence={data.evidence}
                  />
                </div>
              </div>
              <div data-testid="detail-cell-records" style={detailSideCell}>
                <DetailSection
                  id="detail-records"
                  title={recordsArea.title}
                  count={contactCount?.total ?? null}
                  dense
                  hint={
                    contactParts.length > 0 ? (
                      <span data-testid="detail-contact-count">{contactParts.join(' · ')}</span>
                    ) : undefined
                  }
                >
                  {/* #773: 넓은 화면에서는 기록 남기기가 오른쪽 영업 코치 칸에 있다(아래 createPortal).
                      영업 코치 칸이 없는 화면에서만 이 칸 안에 그린다. */}
                  {dockSlot ? null : recordInput}
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
              </div>
            </div>
            {dockSlot
              ? createPortal(<div data-testid="records-dock-content">{recordInput}</div>, dockSlot)
              : null}
            {/* #803: "통화에서 확인할 것"은 오른쪽 영업 코치 판 "확인사항"으로 옮겼다.
                서버가 검토사항을 안 주는 옛 응답일 때만 후속 조치를 예전 부품으로 보인다. */}
            {data.reviewItems === undefined ? (
              <ReasonsSection reasons={data.reasons} onlyFollowUp />
            ) : null}
            {/* "고객이 요구하는 것과 거산의 준비 상태"·"공정 적합성 검토" 구역은 그리지 않는다(PM 결정 2026-11-13 #659).
                서버 응답(requirements·processLinks)은 그대로 온다. 공정은 머리의 요약 줄에 적는다. */}
            {/* ⑥ 그 아래: 비슷한 회사 참고 → 지난 평가와 달라진 것 → 점수 자세히 보기. */}
            <DetailSection id="detail-peers" title={peersArea.title}>
              <PeersArea key={`${oppId}:peers`} oppId={oppId} foldList />
            </DetailSection>
            {/* #942 되먹임 ①: 기록으로 다시 평가돼 점수가 바뀌었으면 무엇이 왜 바뀌었는지 한 상자. */}
            <ScoreChangeLine
              change={data.scoreChange}
              classificationOverrides={config?.classificationLabels}
            />
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
                    onProposalSaved={reloadAll}
                  />
                </div>
              ) : null}
            </ScoresCollapse>
          </div>
        ) : null}
      </FiveStates>
    </>
  );
}
