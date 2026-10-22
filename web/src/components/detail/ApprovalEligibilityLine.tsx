// "승인 가능 여부" 한 줄. 승인 버튼 자체는 뒤 단위(P1)이고, 여기서는 가능/막힘과 이유만 글자로 보인다.
// 시점 우선 요건 체크박스(기한 대응)도 뒤 단위. 다시 확인이 필요하면 경고 글자만 보인다.
import { Alert } from 'antd';
import type { ApprovalEligibility } from '../../api/types';
import { approvalLine, detailSections } from '../../labels/ko';

export default function ApprovalEligibilityLine({
  eligibility,
}: {
  eligibility: ApprovalEligibility;
}) {
  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="approval-eligibility">
      <Alert
        type={eligibility.eligible ? 'success' : 'warning'}
        data-testid="approval-eligibility-line"
        message={
          <span>
            {detailSections.approvalEligible}:{' '}
            <span aria-hidden="true">
              {eligibility.eligible ? approvalLine.eligible : approvalLine.notEligible}
            </span>{' '}
            {eligibility.reason}
          </span>
        }
      />
      {eligibility.readinessNeedsRecheck ? (
        <span role="alert" data-testid="approval-recheck">
          {approvalLine.recheck}
        </span>
      ) : null}
    </div>
  );
}
