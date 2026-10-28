// 근거 상세(S2, BR10.5·BR10.7): 위에서부터 ① 추천 이유 ② 요구 판정 ③ 공정 연결 ④ 근거 자료 ⑤ 점수(접힘) + 맨 아래 의견.
// 진행 단계·승인·결과·활동 이력·거산 확인 요청은 뒤 단위(P1)라 만들지 않는다.
import { useCallback, useEffect, useState } from 'react';
import { Button } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, getOpportunityDetail } from '../api/client';
import type { Meta, OpportunityDetail } from '../api/types';
import FiveStates from '../components/common/FiveStates';
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
import { detailSections, frame, opinionArea, states } from '../labels/ko';
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
  const goList = () => navigate('/');

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
          href="/"
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
            header={data.header}
            ownerName={ownerName}
            classificationOverrides={config?.classificationLabels}
          />
          <ReasonsSection
            reasons={data.reasons}
            scoreItems={data.scores?.items}
            evidence={data.evidence}
          />
          <DetailSection id="detail-requirements" title={detailSections.requirements}>
            <RequirementsTable requirements={data.requirements} />
            <ApprovalEligibilityLine eligibility={data.approvalEligibility} />
          </DetailSection>
          <ProcessLinksSection links={data.processLinks} />
          <EvidenceSection
            evidence={data.evidence}
            homepageNeedsConfirm={data.homepageNeedsConfirm}
          />
          <ScoresCollapse scores={data.scores} />
          <DetailSection id="detail-opinion" title={opinionArea.groupLabel}>
            {data.evalId ? (
              <OpinionArea
                key={`${oppId}:${data.evalId}`}
                oppId={oppId}
                evalId={data.evalId}
                record={data.records.opinion ?? null}
              />
            ) : (
              <p style={{ margin: 0 }}>{states.notEvaluatedYet}</p>
            )}
          </DetailSection>
        </div>
      ) : null}
    </FiveStates>
  );
}
