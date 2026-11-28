// 상세 "한눈에" · 요약 줄 · 확인사항이 함께 쓰는 계산(#674 → #996에서 파일을 나눔).
// 확정 공정과 AI 제안 공정을 가르는 것, "확인할 것" 낱말을 만드는 것. 화면을 그리지 않는다.
import type {
  DetailHeader,
  ProcessLinkView,
  RequirementCheckView,
  ReviewItem,
} from '../../api/types';
import { choiceMarksOf } from '../records/ChoiceQuestion';
import { processNameOf } from '../review/ReviewArea';
import type { ProcessProposal } from './ProcessDifference';

/** 확정된 공정 연결(같은 공정은 한 번)과 AI가 제안만 한 공정 이름. "왜 추천했나" 줄(#659)과 같은 기준이다. */
export function processStateOf(
  header: DetailHeader,
  processLinks: ProcessLinkView[],
  reviewItems: ReviewItem[],
): { confirmed: ProcessLinkView[]; proposedNames: string[]; proposals: ProcessProposal[] } {
  const marks = choiceMarksOf({ processLinks, reviewItems, header }).process;
  const seen = new Set<string>();
  const confirmed = processLinks.filter((link) => {
    if (marks[link.processCode] !== 'CONFIRMED' || seen.has(link.processCode)) return false;
    seen.add(link.processCode);
    return true;
  });
  const nameOfLink = new Map(
    processLinks.map((link) => [link.processCode, link.processName || link.processCode]),
  );
  const proposals: ProcessProposal[] = [];
  for (const item of reviewItems) {
    if (item.kind !== 'PROCESS_LINK_PROPOSAL') continue;
    if (proposals.some((entry) => entry.itemId === item.itemId)) continue;
    const code = item.itemId.replace(/^PL:/, '');
    proposals.push({
      itemId: item.itemId,
      name: nameOfLink.get(code) ?? processNameOf(item) ?? code,
    });
  }
  const proposedNames = [...new Set(proposals.map((entry) => entry.name))];
  return { confirmed, proposedNames, proposals };
}

export interface DetailCheckWords {
  process: boolean;
  material: boolean;
  evidence: boolean;
  /** 이름 그대로 보이는 조건(확인이 필요한 요구 이름). */
  names: string[];
}

/**
 * "확인할 것" 낱말(카드 #659와 같은 말: 공정 · 소재 · 근거 부족 + 요구 이름).
 * 카드는 서버가 준 종류로 만들지만 상세 응답에는 그 칸이 없어, 상세에 있는 값으로 만든다:
 * 공정 = 확정된 공정이 없음(AI 제안뿐이거나 평가 전), 소재 = 판정 대기인 공정 연결에 적용 소재가 없음,
 * 근거 부족 = 핵심 근거 재확인 표시이거나 평가 전, 이름 = 판정이 "확인 필요"인 요구.
 */
export function detailCheckWordsOf(
  header: DetailHeader,
  processLinks: ProcessLinkView[],
  reviewItems: ReviewItem[],
  requirements: RequirementCheckView[],
): DetailCheckWords {
  const notEvaluated = header.classificationCode === 'NOT_EVALUATED';
  const { confirmed, proposedNames } = processStateOf(header, processLinks, reviewItems);
  return {
    process: confirmed.length === 0 && (proposedNames.length > 0 || notEvaluated),
    material: processLinks.some(
      (link) => !link.appliedMaterial && (link.result === 'PENDING' || !link.result),
    ),
    evidence: header.coreEvidenceRecheck || notEvaluated,
    names: [
      ...new Set(
        requirements.filter((row) => row.result === 'QUESTION_NEEDED').map((row) => row.name),
      ),
    ],
  };
}
