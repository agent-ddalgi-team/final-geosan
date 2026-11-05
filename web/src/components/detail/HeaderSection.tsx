// 상세 머리(S2): 목록으로 / 분류·점수·가상 표시 / 고객 관계·대응·담당. 이름(h1)은 공통 틀이 보인다.
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { DetailHeader } from '../../api/types';
import StatusTag from '../common/StatusTag';
import { buildMapLinks } from '../common/mapLinks';
import ScoreLine from '../common/ScoreLine';
import RelationControl from './RelationControl';
import {
  cardRows,
  classificationLabels,
  classificationTone,
  coreEvidenceRecheckLabel,
  detailHeader,
  frame,
  homepageLinkLabel,
  labelFor,
  mapLinkLabels,
  purposeLabels,
} from '../../labels/ko';
import { colors } from '../../theme/tokens';

export interface HeaderSectionProps {
  oppId: string;
  /** 지금 보고 있는 평가 ID(거래 관계를 바꿀 때 서버에 함께 보낸다). 평가 전이면 null. */
  evalId: string | null;
  /** 거래 관계를 바꿨거나 새로 불러오기를 눌렀을 때. 상세 화면이 서버에서 다시 읽는다. */
  onRelationChanged: () => void;
  header: DetailHeader;
  /** 담당자 키를 이름으로 바꾼 값. 모르면 담당 줄을 보이지 않는다. */
  ownerName?: string | null;
  classificationOverrides?: Record<string, string>;
}

export default function HeaderSection({
  oppId,
  evalId,
  onRelationChanged,
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
  // http(s) 주소일 때만 링크로 보인다. 그 밖의 값(javascript: 등)은 보이지 않는다.
  const homepage =
    header.homepageUrl && /^https?:\/\/\S+$/.test(header.homepageUrl) ? header.homepageUrl : null;
  const mapLinks = buildMapLinks(header.address);

  return (
    <div data-testid="detail-header" style={{ display: 'grid', gap: 12 }}>
      <div>
        <Button
          type="link"
          href="/opportunities"
          onClick={(event) => {
            event.preventDefault();
            navigate('/opportunities');
          }}
          style={{ paddingLeft: 0 }}
          data-testid="back-to-list-link"
        >
          <span aria-hidden="true">‹</span> {frame.backToList}
        </Button>
      </div>
      {mapLinks ? (
        <div
          data-testid="detail-map-links"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}
        >
          <span style={{ color: colors.textSecondary }}>{header.address}</span>
          <a
            href={mapLinks.naver}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'underline' }}
            data-testid="detail-map-naver"
          >
            {mapLinkLabels.naver} ↗
          </a>
          <a
            href={mapLinks.kakao}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'underline' }}
            data-testid="detail-map-kakao"
          >
            {mapLinkLabels.kakao} ↗
          </a>
        </div>
      ) : null}
      {homepage ? (
        <div data-testid="detail-homepage">
          <a
            href={homepage}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'underline' }}
          >
            {homepageLinkLabel} ↗ {homepage}
          </a>
        </div>
      ) : null}
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
        <ScoreLine
          scoreDisplay={header.scoreDisplay}
          scoreState={header.scoreState}
          relationStatus={header.relationStatus}
          testId="detail-score"
        />
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
        <RelationControl
          oppId={oppId}
          evalId={evalId}
          status={header.relationStatus}
          note={header.relationNote}
          confirmedAt={header.relationConfirmedAt}
          confirmedBy={header.relationConfirmedBy}
          onChanged={onRelationChanged}
        />
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
