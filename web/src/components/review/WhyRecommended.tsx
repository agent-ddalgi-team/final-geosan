// 검토사항 맨 위 "왜 추천했나"(#619, 2026-11-13). 읽기만 하는 한 줄이다.
// AI가 고른 이유와 등록 사실(공장 정보)은 바로 위 "이 회사 한눈에"에 그대로 보이므로 다시 적지 않고 그쪽을 가리킨다.
// 여기에는 한눈에 칸에 없는 "연결된 공정" 이름만 모아 보인다. 보일 값이 하나도 없으면 줄을 그리지 않는다.
// "연결된 공정"은 확정된 공정만 말한다(#659, PM 결정 2026-11-13). AI가 제안만 한 공정은 검토사항의
// "PL:<공정 코드>" 줄로 오므로 그 코드를 빼고, 확정이 하나도 없으면 "맞는 공정이 아직 확인 전입니다"로 바꿔 보인다.
import type { DetailHeader, ProcessLinkView, ReviewItem } from '../../api/types';
import { reviewArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { choiceMarksOf } from '../records/ChoiceQuestion';
import { processNameOf, REVIEW_FOLD_NAME_LIMIT } from './ReviewArea';

export default function WhyRecommended({
  header,
  processLinks,
  reviewItems = [],
}: {
  header: DetailHeader;
  processLinks: ProcessLinkView[];
  /** 검토사항 줄. AI 공정 연결 제안("PL:")을 여기서 읽어 확정된 공정과 나눈다. */
  reviewItems?: ReviewItem[];
}) {
  // 확정·제안 구분은 꼬리 질문(#652)과 같은 함수로 읽는다.
  const marks = choiceMarksOf({ processLinks, reviewItems, header }).process;
  const nameOfLink = new Map(
    processLinks.map((link) => [link.processCode, link.processName || link.processCode]),
  );
  const names = [
    ...new Set(
      processLinks
        .filter((link) => marks[link.processCode] === 'CONFIRMED')
        .map((link) => link.processName || link.processCode),
    ),
  ];
  const proposedNames = [
    ...new Set(
      reviewItems
        .filter((item) => item.kind === 'PROCESS_LINK_PROPOSAL')
        .map((item) => {
          const code = item.itemId.replace(/^PL:/, '');
          return nameOfLink.get(code) ?? processNameOf(item) ?? code;
        }),
    ),
  ];
  const unconfirmed = names.length === 0 && proposedNames.length > 0;
  // "이 회사 한눈에"가 고른 이유·적합도·공장 정보 줄을 그리는 조건과 같다.
  const glanceHasWhy =
    Boolean(header.pickReason?.trim()) ||
    Boolean(header.fitLevel) ||
    Boolean(header.factoryProfile && factoryProfileText(header.factoryProfile));
  if (names.length === 0 && !unconfirmed && !glanceHasWhy) return null;
  return (
    <div
      data-testid="review-why"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, marginBottom: 8 }}
    >
      <span style={{ fontWeight: 600 }}>{reviewArea.whyTitle}</span>
      {names.length > 0 ? (
        <span data-testid="review-why-processes">{reviewArea.whyProcesses(names)}</span>
      ) : null}
      {unconfirmed ? (
        <span data-testid="review-why-process-unconfirmed">
          {reviewArea.whyProcessUnconfirmed(
            proposedNames.length,
            proposedNames.slice(0, REVIEW_FOLD_NAME_LIMIT),
            Math.max(0, proposedNames.length - REVIEW_FOLD_NAME_LIMIT),
          )}
        </span>
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
