// #932 신규 거래처 찾기 "기존 고객과 닮은 조건" 줄(확장 기능, 설정 existingCustomers.enabled).
// 서버가 기존 고객 수를 센 공정·산업·지역을 많은 순으로 보이고, [적용]은 공정·산업 칸만 채운다.
// 찾기는 담당자가 [발굴 시작]을 눌러야 한다. 점수·순위는 바뀌지 않는다. 꺼져 있거나 고객이 없거나
// 읽기에 실패하면 줄을 그리지 않는다(찾기 칸은 지금과 같다).
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { getCustomerSuggestions } from '../../api/client';
import type { CustomerSuggestions } from '../../api/types';
import { candidateSearch } from '../../labels/ko';
import { colors } from '../../theme/tokens';

/** [적용]으로 채우는 공정·산업 수(많은 순 앞에서부터). 화면이 정한 값이다. */
export const APPLY_TOP = 3;

export interface CustomerLikeLineProps {
  /** 찾기 칸에 있는 공정 코드·산업 이름. 이 안의 값만 채운다. */
  processCodes: string[];
  industries: string[];
  onApply: (processCodes: string[], industries: string[]) => void;
}

export default function CustomerLikeLine({
  processCodes,
  industries,
  onApply,
}: CustomerLikeLineProps) {
  const [state, setState] = useState<{ data: CustomerSuggestions; virtual: boolean } | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getCustomerSuggestions(controller.signal)
      .then((envelope) =>
        setState({ data: envelope.data, virtual: envelope.meta.hasVirtualData === true }),
      )
      // 보조 줄이라 실패해도 찾기 칸은 그대로 쓴다(줄만 그리지 않음).
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (state === null || !state.data.enabled || state.data.total === 0) return null;
  const { data, virtual } = state;
  const processes = data.processes.filter((item) => processCodes.includes(item.code));
  const picks = data.industries.filter((item) => industries.includes(item.name));
  if (processes.length === 0 && picks.length === 0) return null;
  const items = [
    ...processes.map((item) => candidateSearch.customerLikeItem(item.label, item.count)),
    ...picks.map((item) => candidateSearch.customerLikeItem(item.name, item.count)),
  ];
  if (data.regions.length > 0) {
    items.push(candidateSearch.customerLikeRegions(data.regions.map((item) => item.name)));
  }

  return (
    <div className="prospect-estimate" data-testid="customer-like" role="group">
      <span>
        <strong>{candidateSearch.customerLikeTitle(data.total)}</strong>
        {virtual ? (
          <span data-testid="customer-like-virtual" style={{ color: colors.textSecondary }}>
            {' '}
            ({candidateSearch.customerLikeVirtual})
          </span>
        ) : null}
        {': '}
        <span data-testid="customer-like-items">{items.join(' · ')}</span>{' '}
        <Button
          size="small"
          data-testid="customer-like-apply"
          onClick={() => {
            onApply(
              processes.slice(0, APPLY_TOP).map((item) => item.code),
              picks.slice(0, APPLY_TOP).map((item) => item.name),
            );
            setApplied(true);
          }}
        >
          {candidateSearch.customerLikeApply}
        </Button>
      </span>
      <span style={{ color: colors.textSecondary }} role={applied ? 'status' : undefined}>
        {applied ? candidateSearch.customerLikeApplied : candidateSearch.customerLikeHint}
      </span>
    </div>
  );
}
