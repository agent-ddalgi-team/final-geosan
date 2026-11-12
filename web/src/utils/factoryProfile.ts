// 공장 등록 정보(#573) 한 줄 만들기. 카드와 상세 "이 회사 한눈에"가 같은 글자를 쓴다.
// 예: "업종 절삭가공 및 유사처리업 · 원자재 강판, SUS · 종업원 약 12명(추정) · 소기업".
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
    profile.employeeCount ? factoryProfileLabels.employees(profile.employeeCount) : null,
    profile.scale?.trim() || null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
