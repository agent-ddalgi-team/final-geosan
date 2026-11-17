// "한눈에" 공정 줄 아래의 "AI는 다르게 봄"(#677, PM 결정 2026-11-13).
// 사람이 확정한 공정이 있는 회사에 AI가 다른 공정을 제안하면 덮어쓰지 않고 이 줄로 알려 고르게 한다.
//   [확정 값 유지] = 그 AI 제안을 물리친다(기존 검토 체크 창구에 checked:false).
//   [○○도 추가]   = 기존 [확정]과 같다(checked:true). 확정 공정에 더하고, 이미 확정한 공정은 그대로다.
// 모달 없이 그 줄에서 고른다. 저장이 끝나면 점수가 다시 계산되므로 상세를 새로 불러오게 알린다.
import { useState } from 'react';
import { Button } from 'antd';
import { ApiError, postReviewCheck } from '../../api/client';
import { detailReport, errorTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import StatusTag from '../common/StatusTag';
import { useFrame } from '../frame/FrameContext';

const texts = detailReport.glance.difference;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export interface ProcessProposal {
  /** 검토사항 줄 번호 "PL:<공정 코드>". */
  itemId: string;
  name: string;
}

export interface ProcessDifferenceProps {
  oppId: string;
  /** 본 평가 ID. 없으면 고르는 단추를 잠근다. */
  evalId: string | null;
  proposals: ProcessProposal[];
  confirmedNames: string[];
  /** 고르기가 저장된 뒤(상세·활동 이력을 새로 불러오게). */
  onSaved: () => void;
}

export default function ProcessDifference({
  oppId,
  evalId,
  proposals,
  confirmedNames,
  onSaved,
}: ProcessDifferenceProps) {
  const { staffKey, canRecord } = useFrame();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = !canRecord || !staffKey || !evalId || busyId !== null;

  async function choose(itemId: string, checked: boolean) {
    if (!staffKey || !evalId) return;
    setBusyId(itemId);
    setError(null);
    try {
      await postReviewCheck(oppId, itemId, { checked, evalId }, staffKey);
      onSaved();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.failed} (${detail})`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div data-testid="glance-process-difference" style={{ display: 'grid', gap: 4 }}>
      {proposals.map((proposal) => (
        <div
          key={proposal.itemId}
          data-testid="glance-process-difference-line"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
        >
          <StatusTag tone="recheck">{texts.tag}</StatusTag>
          <span>{texts.line(proposal.name, confirmedNames)}</span>
          <Button
            size="small"
            disabled={disabled}
            loading={busyId === proposal.itemId}
            onClick={() => void choose(proposal.itemId, false)}
            data-testid="glance-process-keep"
          >
            {texts.keep}
          </Button>
          <Button
            size="small"
            disabled={disabled}
            onClick={() => void choose(proposal.itemId, true)}
            data-testid="glance-process-add"
          >
            {texts.add(proposal.name)}
          </Button>
        </div>
      ))}
      {!canRecord ? (
        <span style={secondary} data-testid="glance-process-pick-staff">
          {texts.pickStaffFirst}
        </span>
      ) : null}
      {error ? (
        <span role="alert" style={{ color: colors.error }} data-testid="glance-process-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
