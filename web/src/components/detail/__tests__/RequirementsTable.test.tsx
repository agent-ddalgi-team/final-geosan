// 요구 판정 표와 "승인 가능 여부" 한 줄의 모양 시험.
// 2026-11-13 PM 결정(#659)으로 상세 화면이 이 구역을 그리지 않게 되어, 상세 화면 시험에 있던 검사를
// 부품 시험으로 옮겼다(부품은 남겨 둔다). 저장된 값만 보이는 화면 부품 시험이다(서버 호출 없음).
import { render, screen, within } from '@testing-library/react';
import ApprovalEligibilityLine from '../ApprovalEligibilityLine';
import RequirementsTable from '../RequirementsTable';
import type { OpportunityDetail } from '../../../api/types';
import { detailSections, states } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';

const detail = detailFixture.data as unknown as OpportunityDetail;

describe('요구 판정 표 (지금 상세 화면에서는 쓰지 않는 부품)', () => {
  it('확인된 요구가 없으면 표 대신 안내 문구를 보인다', () => {
    render(<RequirementsTable requirements={[]} />);
    expect(screen.getByTestId('requirements-empty')).toHaveTextContent(states.noRequirements);
    expect(screen.queryByTestId('requirements-table')).not.toBeInTheDocument();
  });

  it('요구 표는 머리글 행이 있는 진짜 표이고 판정이 색 아닌 글자로도 보인다', () => {
    render(<RequirementsTable requirements={detail.requirements} />);
    const table = screen.getByTestId('requirements-table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    for (const th of within(table).getAllByRole('columnheader')) {
      expect(th).toHaveAttribute('scope', 'col');
    }
    const rows = screen.getAllByTestId('requirement-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('ISO 9001');
    expect(rows[0]).toHaveTextContent('통과 (응모 가능)');
    expect(rows[1]).toHaveTextContent('품질팀 샘플 승인');
    expect(rows[1]).toHaveTextContent('나중 단계');
    expect(rows[2]).toHaveTextContent('Nadcap');
    expect(rows[2]).toHaveTextContent('질문 필요 (승인은 막지 않음)');
  });

  it('승인 가능 여부 줄은 제목과 이유를 글자로 보인다', () => {
    render(<ApprovalEligibilityLine eligibility={detail.approvalEligibility} />);
    const line = screen.getByTestId('approval-eligibility-line');
    expect(line).toHaveTextContent(detailSections.approvalEligible);
    expect(line).toHaveTextContent(detail.approvalEligibility.reason);
  });
});
