// 상세 머리(S2, #674 PM 결정 2026-11-13): 목록으로 / [관심]·[다시 조사] / 단계 진행 막대 / 분류·점수·가상 표시 / 대응·담당.
// 이름(h1)은 공통 틀이 보인다. 읽는 곳이라 단추는 [목록으로]·[관심]·[다시 조사]와, 기록 칸으로 내려가는 [기록 남기기](#691, 이동만)뿐이다.
// 홈페이지·대표번호·공장 정보·산업·접촉 횟수는 바로 아래 "한눈에" 상자(`DetailGlance.tsx`)로 모았다.
// 거래 관계 입력(`RelationControl`)과 점수 옆 "거래 확인 전" 표시는 뺐다(재접촉 관리를 하지 않는다). "기존 거래처" 표시는 남는다.
// 분류 꼬리표 "필수조건 확인 필요"·"핵심 근거 재확인 필요"·"평가 전"은 카드(#659)와 같게 보이지 않는다.
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import type {
  BookmarkRecord,
  DetailHeader,
  OutcomeRecord,
  SalesQuestions,
  SalesStepView,
} from '../../api/types';
import BookmarkButton from '../common/BookmarkButton';
import StatusTag from '../common/StatusTag';
import ScoreLine from '../common/ScoreLine';
import HomepageControls from './HomepageControls';
import SalesProgressBar from './SalesProgressBar';
import {
  candidateSearch,
  cardRows,
  classificationLabels,
  classificationTone,
  detailHeader,
  frame,
  labelFor,
  ownPlatingLine,
  purposeLabels,
  recordsArea,
} from '../../labels/ko';
import { colors } from '../../theme/tokens';

export interface HeaderSectionProps {
  oppId: string;
  /** [다시 조사]가 끝났거나 새로 불러오기를 눌렀을 때. 상세 화면이 서버에서 다시 읽는다. */
  onReload: () => void;
  /** [기록 남기기](#691): 적는 곳의 기록 남기기 칸으로 내려간다. 없으면 단추를 보이지 않는다. */
  onGoRecord?: () => void;
  header: DetailHeader;
  /** 관심 표시(#357). 한 번도 켠 적이 없으면 null. 기록을 저장하면 상세 화면이 서버 값으로 다시 맞춰 준다. */
  bookmark: BookmarkRecord | null;
  /** [관심] 단추로 켜거나 껐을 때 서버가 돌려준 값을 알린다. */
  onBookmarkChanged: (bookmark: BookmarkRecord) => void;
  /** 단계 진행 막대에 쓰는 값: 세부 단계, 큰 단계·거절 이유·다음 일정, 접촉 수, 질문 파일(단계 이름·순서). */
  salesStep?: SalesStepView | null;
  outcome?: OutcomeRecord | null;
  contactTotal?: number;
  questions?: SalesQuestions | null;
  /** 담당자 키를 이름으로 바꾼 값. 모르면 담당 줄을 보이지 않는다. */
  ownerName?: string | null;
  classificationOverrides?: Record<string, string>;
}

/** 머리에 꼬리표로 보이지 않는 분류(#659 카드와 같다). 무엇을 확인할지는 "한눈에"의 "확인할 것"이 말한다. */
const HIDDEN_CLASSIFICATIONS = new Set(['FILTER_PENDING', 'NOT_EVALUATED']);

export default function HeaderSection({
  oppId,
  onReload,
  onGoRecord,
  header,
  bookmark,
  onBookmarkChanged,
  salesStep = null,
  outcome = null,
  contactTotal = 0,
  questions = null,
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
  const showClassification = !HIDDEN_CLASSIFICATIONS.has(header.classificationCode);

  return (
    <div data-testid="detail-header" style={{ display: 'grid', gap: 12 }}>
      {/* 목록으로(왼쪽)와 [관심]·[다시 조사](우측 상단, #596)를 한 줄에 둔다. */}
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
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          {onGoRecord ? (
            <Button type="primary" onClick={onGoRecord} data-testid="detail-go-record-button">
              {recordsArea.goRecord} <span aria-hidden="true">↓</span>
            </Button>
          ) : null}
          <BookmarkButton oppId={oppId} bookmark={bookmark} onChanged={onBookmarkChanged} />
          <HomepageControls oppId={oppId} onReload={onReload} />
        </div>
      </div>
      <SalesProgressBar
        salesStep={salesStep}
        outcome={outcome}
        contactTotal={contactTotal}
        questions={questions}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {showClassification ? (
          <span
            role="group"
            aria-label={`분류: ${classification}`}
            data-testid="detail-classification"
          >
            <StatusTag tone={tone} bold={header.classificationCode === 'CONTACT_URGENT'}>
              {classification}
            </StatusTag>
          </span>
        ) : null}
        <ScoreLine
          scoreDisplay={header.scoreDisplay}
          scoreState={header.scoreState}
          relationStatus={header.relationStatus}
          classificationCode={header.classificationCode}
          hidePendingTag
          testId="detail-score"
        />
        {/* 점수가 아직 없으면 조사 상태와 멈춘 이유(#596). */}
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
        <span
          data-testid="detail-meta"
          style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 16, color: colors.textSecondary }}
        >
          <span>
            {detailHeader.purpose}: {labelFor(purposeLabels, header.purpose)}
          </span>
          {ownerName ? (
            <span>
              {detailHeader.owner}: {ownerName}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
