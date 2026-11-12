// 검토사항 맨 위 "왜 추천했나"(#619, 2026-11-13). 읽기만 하는 한 줄이다.
// AI가 고른 이유와 등록 사실(공장 정보)은 바로 위 "이 회사 한눈에"에 그대로 보이므로 다시 적지 않고 그쪽을 가리킨다.
// 여기에는 한눈에 칸에 없는 "연결된 공정" 이름만 모아 보인다. 보일 값이 하나도 없으면 줄을 그리지 않는다.
import type { DetailHeader, ProcessLinkView } from '../../api/types';
import { reviewArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';

export default function WhyRecommended({
  header,
  processLinks,
}: {
  header: DetailHeader;
  processLinks: ProcessLinkView[];
}) {
  const names = [...new Set(processLinks.map((link) => link.processName || link.processCode))];
  // "이 회사 한눈에"가 고른 이유·적합도·공장 정보 줄을 그리는 조건과 같다.
  const glanceHasWhy =
    Boolean(header.pickReason?.trim()) ||
    Boolean(header.fitLevel) ||
    Boolean(header.factoryProfile && factoryProfileText(header.factoryProfile));
  if (names.length === 0 && !glanceHasWhy) return null;
  return (
    <div
      data-testid="review-why"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, marginBottom: 8 }}
    >
      <span style={{ fontWeight: 600 }}>{reviewArea.whyTitle}</span>
      {names.length > 0 ? (
        <span data-testid="review-why-processes">{reviewArea.whyProcesses(names)}</span>
      ) : null}
      {glanceHasWhy ? (
        <span
          data-testid="review-why-see-glance"
          style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
        >
          {reviewArea.whySeeGlance}
        </span>
      ) : null}
    </div>
  );
}
