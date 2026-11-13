// 검토사항 맨 위 "왜 추천했나"(#619, 2026-11-13). 읽기만 하는 한 줄이다.
// AI가 고른 이유와 등록 사실(공장 정보)은 바로 위 "이 회사 한눈에"에 그대로 보이므로 다시 적지 않고 그쪽을 가리킨다.
// 공정 얘기는 상세에서 여기 한 곳에만 적는다(#659, PM 지시 2026-11-13: "공정 적합성 검토" 구역을 빼고 한 줄로).
// 확정된 공정이 있으면 "공정: 아연도금 · 소재 철 · 통과 외 1개"(첫 공정만 소재·판정, 전체는 마우스를 올리면 보인다),
// 확정이 없고 AI 제안만 있으면 "공정 확인 전 · AI 제안 5개(…)". AI가 제안만 한 공정은 검토사항의 "PL:<공정 코드>" 줄로 온다.
// 보일 값이 하나도 없으면 줄을 그리지 않는다.
import type { DetailHeader, ProcessLinkView, ReviewItem } from '../../api/types';
import { filterStateLabels, labelFor, materialLabels, reviewArea } from '../../labels/ko';
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
  // 확정된 공정 연결: 같은 공정이 두 번 오면 처음 것만 쓴다.
  const seenCodes = new Set<string>();
  const confirmed = processLinks.filter((link) => {
    if (marks[link.processCode] !== 'CONFIRMED' || seenCodes.has(link.processCode)) return false;
    seenCodes.add(link.processCode);
    return true;
  });
  const names = confirmed.map((link) => link.processName || link.processCode);
  const partsOf = (link: ProcessLinkView) =>
    [
      link.processName || link.processCode,
      link.appliedMaterial ? labelFor(materialLabels, link.appliedMaterial) : null,
      link.result ? labelFor(filterStateLabels, link.result) : null,
    ] as const;
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
      {confirmed.length > 0 ? (
        <span
          data-testid="review-why-processes"
          title={confirmed
            .map((link) => reviewArea.whyProcessDetail(...partsOf(link), link.reason ?? null))
            .join(' / ')}
        >
          {reviewArea.whyProcessLine(...partsOf(confirmed[0]), confirmed.length - 1)}
        </span>
      ) : null}
      {unconfirmed ? (
        <span data-testid="review-why-process-unconfirmed">
          {reviewArea.whyProcessPending(
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
