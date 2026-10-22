// 2. 고객이 요구하는 것과 거산의 준비 상태: 진짜 표(머리글 행 th scope="col"), 10행 넘으면 안에서 스크롤.
// 판정은 색+글자+아이콘 글자로 보인다(접근성 A3, S2-3).
import type { RequirementCheckView } from '../../api/types';
import StatusTag from '../common/StatusTag';
import {
  checkDisplayIcons,
  checkDisplayLabels,
  checkDisplayTone,
  detailSections,
  labelFor,
  neededStageLabels,
  reqLevelLabels,
  requirementCells,
  reviewStatusLabels,
  reviewStatusTone,
  states,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

/** 이 행 수를 넘으면 표 안에서 세로 스크롤한다. */
export const SCROLL_AFTER_ROWS = 10;

const cell = {
  padding: '8px 12px',
  textAlign: 'left',
  verticalAlign: 'top',
  borderBottom: `1px solid ${colors.borderSecondary}`,
} as const;

export default function RequirementsTable({
  requirements,
}: {
  requirements: RequirementCheckView[];
}) {
  if (requirements.length === 0) {
    return <p data-testid="requirements-empty">{states.noRequirements}</p>;
  }
  const columns = detailSections.requirementColumns;
  const scroll = requirements.length > SCROLL_AFTER_ROWS;
  return (
    <div
      data-testid="requirements-scroll"
      // 스크롤 영역은 키보드로 움직일 수 있어야 한다(S2-3). 가로는 좁은 화면에서 항상 허용.
      tabIndex={0}
      role="region"
      aria-label={detailSections.requirements}
      style={{ overflowX: 'auto', ...(scroll ? { maxHeight: 320, overflowY: 'auto' } : {}) }}
    >
      <table data-testid="requirements-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {[columns.name, columns.level, columns.stage, columns.capability, columns.result].map(
              (name) => (
                <th
                  key={name}
                  scope="col"
                  style={{
                    ...cell,
                    background: colors.bgLayout,
                    position: 'sticky',
                    top: 0,
                    fontWeight: 600,
                  }}
                >
                  {name}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {requirements.map((req) => (
            <tr key={req.reqId} data-testid="requirement-row">
              <th scope="row" style={{ ...cell, fontWeight: 400 }}>
                {req.name}
              </th>
              <td style={cell}>{labelFor(reqLevelLabels, req.reqLevel)}</td>
              <td style={cell}>{labelFor(neededStageLabels, req.neededStage)}</td>
              <td style={cell}>
                {req.capabilityStatus ? (
                  <StatusTag tone={reviewStatusTone[req.capabilityStatus] ?? 'neutral'}>
                    {labelFor(reviewStatusLabels, req.capabilityStatus)}
                  </StatusTag>
                ) : (
                  requirementCells.notApplicable
                )}
              </td>
              <td style={cell}>
                <StatusTag
                  tone={checkDisplayTone[req.result] ?? 'neutral'}
                  icon={checkDisplayIcons[req.result]}
                  data-testid="requirement-result"
                >
                  {labelFor(checkDisplayLabels, req.result)}
                </StatusTag>
                <div
                  style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
                >
                  {req.reason}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
