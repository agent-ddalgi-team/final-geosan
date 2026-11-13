// 공장 등록 정보(#573) 한 줄 만들기. 카드와 상세 "이 회사 한눈에"가 같은 글자를 쓴다.
// 예: "업종 절삭가공 및 유사처리업 · 원자재 강판, SUS · 소기업".
// 종업원 수는 공장 등록 때 값이라 실제와 많이 달라 보이지 않는다(#635, PM 결정 2026-11-13). 규모만 보인다.
// 업종은 공장 등록 업종명(#617)이다. 값이 하나도 없으면 null.
import type { FactoryProfile } from '../api/types';
import { factoryProfileLabels } from '../labels/ko';

export function factoryProfileText(profile: FactoryProfile | null | undefined): string | null {
  if (!profile) return null;
  const industry = profile.industryName?.trim();
  const parts = [
    industry ? factoryProfileLabels.industry(industry) : null,
    profile.rawMaterials?.trim()
      ? factoryProfileLabels.rawMaterials(profile.rawMaterials.trim())
      : null,
    profile.scale?.trim() || null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
