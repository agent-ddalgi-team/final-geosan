// 근거 상세(S2, BR10.5·BR10.7): 위에서부터 ① 추천 이유 ② 요구 판정 ③ 공정 연결 ④ 근거 자료 ⑤ 점수(접힘) + 맨 아래 의견.
// 서버가 reviewItems를 주면 추천 이유 바로 아래에 "검토사항" 영역이 붙고 확인 질문은 거기로 옮겨 간다(U5).
// 맨 아래에 기록 영역(종류 선택 한 칸·영업 단계·다음 일정)과 그 아래 활동 타임라인이 붙는다. 접촉 횟수는 머리에 보인다. 승인·거산 확인 요청은 뒤 단위라 만들지 않는다.
// 머리의 [관심] 단추(#357): 검토 의견·메모·영업 기록을 저장하면 서버가 관심을 켜므로, 그 저장 뒤에 관심 값만 조용히 다시 읽는다(화면 전체를 다시 그리지 않는다).
import { useCallback, useEffect, useState } from 'react';
import { Button } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, getOpportunityDetail } from '../api/client';
import type { ContactCount, ContactMethod, Meta, OpportunityDetail } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useBookmark } from '../components/common/useBookmark';
import ApprovalEligibilityLine from '../components/detail/ApprovalEligibilityLine';
import DetailSection from '../components/detail/DetailSection';
import EvidenceSection from '../components/detail/EvidenceSection';
import HeaderSection from '../components/detail/HeaderSection';
import ProcessLinksSection from '../components/detail/ProcessLinksSection';
import ReasonsSection from '../components/detail/ReasonsSection';
import RequirementsTable from '../components/detail/RequirementsTable';
import ScoresCollapse from '../components/detail/ScoresCollapse';
import { useFrame } from '../components/frame/FrameContext';
import OpinionArea from '../components/opinion/OpinionArea';
import ActivityTimeline from '../components/records/ActivityTimeline';
import RecordsArea from '../components/records/RecordsArea';
import ReviewArea from '../components/review/ReviewArea';
import { detailSections, frame, opinionArea, recordsArea, reviewArea, states } from '../labels/ko';
import { spacing } from '../theme/tokens';

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

  const bookmarkState = useBookmark(oppId, data, data?.records.bookmark ?? null);

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
            evalId={data.evalId}
            onRelationChanged={() => {
              setReload((n) => n + 1);
              setTimelineVersion((n) => n + 1);
            }}
            header={data.header}
            evidence={data.evidence}
            bookmark={bookmarkState.bookmark}
            onBookmarkChanged={(next) => {
              bookmarkState.change(next);
              setTimelineVersion((n) => n + 1);
            }}
            contactCount={contactCount}
            ownerName={ownerName}
            classificationOverrides={config?.classificationLabels}
          />
          <ReasonsSection
            reasons={data.reasons}
            scoreItems={data.scores?.items}
            evidence={data.evidence}
            hideQuestions={data.reviewItems !== undefined}
          />
          {data.reviewItems !== undefined ? (
            <DetailSection id="detail-review" title={reviewArea.title}>
              <ReviewArea
                key={`${oppId}:${data.evalId}:review`}
                oppId={oppId}
                evalId={data.evalId}
                items={data.reviewItems}
                onReplied={() => setTimelineVersion((n) => n + 1)}
                onMemoSaved={() => setTimelineVersion((n) => n + 1)}
                homepageUrl={
                  data.header.homepageUrl && /^https?:\/\/\S+$/.test(data.header.homepageUrl)
                    ? data.header.homepageUrl
                    : null
                }
                onResearched={() => {
                  // 붙여넣고 조사하면 근거가 늘고 다시 평가되므로 상세와 활동 이력을 새로 불러온다(#260).
                  setReload((n) => n + 1);
                  setTimelineVersion((n) => n + 1);
                }}
                onProposalSaved={() => {
                  // AI 제안을 확정·고치면 점수가 바뀌어 다시 평가되므로 상세와 활동 이력을 새로 불러온다(#498).
                  setReload((n) => n + 1);
                  setTimelineVersion((n) => n + 1);
                }}
              />
            </DetailSection>
          ) : null}
          <DetailSection id="detail-requirements" title={detailSections.requirements}>
            <RequirementsTable requirements={data.requirements} />
            <ApprovalEligibilityLine eligibility={data.approvalEligibility} />
          </DetailSection>
          <ProcessLinksSection links={data.processLinks} />
          <EvidenceSection evidence={data.evidence} />
          <ScoresCollapse scores={data.scores} />
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
        </div>
      ) : null}
    </FiveStates>
  );
}
