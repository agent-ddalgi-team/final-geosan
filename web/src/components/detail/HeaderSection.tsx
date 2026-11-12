// 상세 머리(S2): 목록으로 / 분류·점수·가상 표시·[관심] 단추 / 고객 관계·대응·담당. 이름(h1)은 공통 틀이 보인다.
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BookmarkRecord, ContactCount, DetailHeader, EvidenceView } from '../../api/types';
import BookmarkButton from '../common/BookmarkButton';
import StatusTag from '../common/StatusTag';
import { buildMapLinks } from '../common/mapLinks';
import ScoreLine from '../common/ScoreLine';
import CompanyGlance from './CompanyGlance';
import CompanySummary from './CompanySummary';
import HomepageControls from './HomepageControls';
import RelationControl from './RelationControl';
import {
  candidateSearch,
  cardRows,
  classificationLabels,
  classificationTone,
  coreEvidenceRecheckLabel,
  detailHeader,
  frame,
  labelFor,
  mapLinkLabels,
  ownPlatingLine,
  purposeLabels,
  recordsArea,
} from '../../labels/ko';
import { colors } from '../../theme/tokens';

export interface HeaderSectionProps {
  oppId: string;
  /** 지금 보고 있는 평가 ID(거래 관계를 바꿀 때 서버에 함께 보낸다). 평가 전이면 null. */
  evalId: string | null;
  /** 거래 관계를 바꿨거나 새로 불러오기를 눌렀을 때. 상세 화면이 서버에서 다시 읽는다. */
  onRelationChanged: () => void;
  header: DetailHeader;
  /** 관심 표시(#357). 한 번도 켠 적이 없으면 null. 기록을 저장하면 상세 화면이 서버 값으로 다시 맞춰 준다. */
  bookmark: BookmarkRecord | null;
  /** [관심] 단추로 켜거나 껐을 때 서버가 돌려준 값을 알린다. */
  onBookmarkChanged: (bookmark: BookmarkRecord) => void;
  /** 접촉 횟수(전화·방문·메일). 서버가 주지 않으면 줄을 보이지 않는다. 기록을 저장하면 상세 화면이 바꿔 준다. */
  contactCount?: ContactCount | null;
  /** 담당자 키를 이름으로 바꾼 값. 모르면 담당 줄을 보이지 않는다. */
  ownerName?: string | null;
  classificationOverrides?: Record<string, string>;
  /** 근거 목록. 공식 홈페이지가 없을 때 "근거가 나온 페이지" 링크를 고르는 데 쓴다(#563). */
  evidence?: EvidenceView[];
}

export default function HeaderSection({
  oppId,
  evalId,
  onRelationChanged,
  header,
  bookmark,
  onBookmarkChanged,
  contactCount,
  ownerName,
  classificationOverrides,
  evidence,
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
  const mapLinks = buildMapLinks(header.address);

  return (
    <div data-testid="detail-header" style={{ display: 'grid', gap: 12 }}>
      {/* 목록으로(왼쪽)와 [다시 조사](우측 상단, #596)를 한 줄에 둔다. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
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
        <HomepageControls oppId={oppId} onReload={onRelationChanged} />
      </div>
      <CompanyGlance header={header} evidence={evidence} />
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
          classificationCode={header.classificationCode}
          testId="detail-score"
        />
        {/* 점수가 아직 없으면 조사 상태와 멈춘 이유(#596). "홈페이지 못 찾음" 띠는 이 꼬리표로 대신한다. */}
        {header.researchState ? (
          <span data-testid="detail-research-state" data-research-state={header.researchState}>
            <StatusTag tone={header.researchState === 'RUNNING' ? 'neutral' : 'wait'}>
              {header.researchState === 'RUNNING'
                ? candidateSearch.researchRunning
                : `${candidateSearch.researchStopped} · ${labelFor(
                    candidateSearch.researchStopReason,
                    header.researchState,
                  )}`}
            </StatusTag>
          </span>
        ) : null}
        {header.isVirtual ? (
          <StatusTag tone="wait" data-testid="detail-virtual-tag">
            {cardRows.virtualTag}
          </StatusTag>
        ) : null}
        {header.datasetKind === 'BROCHURE' ? (
          <StatusTag tone="ask">{cardRows.brochureTag}</StatusTag>
        ) : null}
        {header.ownPlatingLineSuspected === true ? (
          <StatusTag tone="ask" data-testid="detail-own-plating-tag">
            {ownPlatingLine.tag}
          </StatusTag>
        ) : null}
        <BookmarkButton oppId={oppId} bookmark={bookmark} onChanged={onBookmarkChanged} />
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
        {contactCount ? (
          <span data-testid="detail-contact-count">
            {recordsArea.contactCount(
              contactCount.total,
              contactCount.call,
              contactCount.email,
              contactCount.visit,
            )}
          </span>
        ) : null}
      </div>
      {/* 한 줄 소개는 맨 위 "이 회사 한눈에"로 옮겼다(#563). 여기는 조사일·대표번호·특징. */}
      <CompanySummary
        oppId={oppId}
        header={header}
        onReload={onRelationChanged}
        showSummaryLine={false}
      />
    </div>
  );
}
