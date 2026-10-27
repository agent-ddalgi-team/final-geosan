// 상세 머리(S2): 목록으로 / 분류·점수·가상 표시 / 고객 관계·대응·담당. 이름(h1)은 공통 틀이 보인다.
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { DetailHeader } from '../../api/types';
import StatusTag from '../common/StatusTag';
import { scoreAriaLabel, scoreText } from '../common/scoreDisplay';
import {
  cardRows,
  classificationLabels,
  classificationTone,
  coreEvidenceRecheckLabel,
  detailHeader,
  frame,
  labelFor,
  purposeLabels,
  relationStatusLabels,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export interface HeaderSectionProps {
  header: DetailHeader;
  /** 담당자 키를 이름으로 바꾼 값. 모르면 담당 줄을 보이지 않는다. */
  ownerName?: string | null;
  classificationOverrides?: Record<string, string>;
}

export default function HeaderSection({
  header,
  ownerName,
  classificationOverrides,
}: HeaderSectionProps) {
  const navigate = useNavigate();
  const classification = labelFor(
    classificationLabels,
    header.classificationCode,
    classificationOverrides,
  );
  const tone =
    header.classificationCode in classificationTone
      ? classificationTone[header.classificationCode]
      : 'neutral';
  // 서버가 "기존 (2024년 아연도금 견적)"처럼 쉬운 설명을 주면 그것을 쓰고, 없으면 코드표 문구를 쓴다.
  const relation = header.relationNote || labelFor(relationStatusLabels, header.relationStatus);

  return (
    <div data-testid="detail-header" style={{ display: 'grid', gap: 12 }}>
      <div>
        <Button
          type="link"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
          style={{ paddingLeft: 0 }}
          data-testid="back-to-list-link"
        >
          <span aria-hidden="true">‹</span> {frame.backToList}
        </Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <span
          role="group"
          aria-label={`분류: ${classification}`}
          data-testid="detail-classification"
        >
          <StatusTag tone={tone} bold={header.classificationCode === 'CONTACT_URGENT'}>
            {classification}
          </StatusTag>
        </span>
        {header.coreEvidenceRecheck ? (
          <StatusTag tone="recheck">{coreEvidenceRecheckLabel}</StatusTag>
        ) : null}
        <span
          role="group"
          aria-label={scoreAriaLabel(header.scoreDisplay)}
          data-testid="detail-score"
          style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
        >
          {scoreText(header.scoreDisplay)}
        </span>
        {header.isVirtual ? (
          <StatusTag tone="wait" data-testid="detail-virtual-tag">
            {cardRows.virtualTag}
          </StatusTag>
        ) : null}
        {header.datasetKind === 'BROCHURE' ? (
          <StatusTag tone="ask">{cardRows.brochureTag}</StatusTag>
        ) : null}
      </div>
      <div
        data-testid="detail-meta"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 24, color: colors.textSecondary }}
      >
        <span>
          {detailHeader.relation}: {relation}
        </span>
        <span>
          {detailHeader.purpose}: {labelFor(purposeLabels, header.purpose)}
        </span>
        {ownerName ? (
          <span>
            {detailHeader.owner}: {ownerName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
