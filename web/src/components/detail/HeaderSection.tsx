// 상세 머리(S2, #674 PM 결정 2026-11-13): 목록으로 / [관심]·[다시 조사] / 분류·점수·가상 표시 · 대응·담당 · 의견 / 영업 단계 카드.
// #972 새 시안: 꼬리표 줄(분류·점수·대응·담당, 오른쪽 끝에 의견)을 단추 줄 바로 아래에 두고,
// 영업 단계 그림은 그 아래 흰 카드 안에 그린다. 넓은 화면에서는 같은 카드 아래쪽에 "지금까지 들은 답 · 다음 일정"이 붙는다.
// 이름(h1)은 공통 틀이 보인다. 읽는 곳이라 단추는 [목록으로]·[관심]·[다시 조사]와, 기록 칸으로 내려가는 [기록 남기기](#691, 이동만)뿐이다.
// 홈페이지·대표번호·공장 정보·산업·접촉 횟수는 바로 아래 "한눈에" 상자(`DetailGlance.tsx`)로 모았다.
// 거래 관계 입력(`RelationControl`)과 점수 옆 "거래 확인 전" 표시는 뺐다(재접촉 관리를 하지 않는다). "기존 거래처" 표시는 남는다.
// 분류 꼬리표 "필수조건 확인 필요"·"핵심 근거 재확인 필요"·"평가 전"은 카드(#659)와 같게 보이지 않는다.
import type { ReactNode } from 'react';
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
import { useFrame } from '../frame/FrameContext';
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
import { colors, detailTheme, radius, spacing, tagPalette, typography } from '../../theme/tokens';
import { daysAgo } from '../../utils/time';

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
  /** #803: 단추 줄 끝에 붙는 [보고서 ↗] 링크. */
  reportLink?: ReactNode;
  /** #803: 꼬리표 줄에 붙는 검토 의견("의견: 영업 대상 (수정)"). 전에는 아래 따로 카드였다. */
  opinion?: ReactNode;
  /** #972: 영업 단계 카드 안, 단계 그림 아래에 붙는 것(넓은 화면의 "지금까지 들은 답 · 단계 고치기 · 다음 일정" 자리). */
  stageExtra?: ReactNode;
  /** #980(PM 결정 2026-11-28): 영업 단계 카드 맨 아래 "상대 담당자 연락처". 바로 연락할지 같은 카드에서 본다. */
  stageContacts?: ReactNode;
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
  reportLink = null,
  opinion = null,
  stageExtra = null,
  stageContacts = null,
}: HeaderSectionProps) {
  const navigate = useNavigate();
  const { canRecord } = useFrame();
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
  // #677: 서버가 다시 조사를 제안한 관심 회사. 화면에서 관심을 끄면 바로 숨긴다.
  const suggestDays =
    header.researchSuggestAgain && bookmark?.active ? daysAgo(header.researchedAt) : null;

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
          style={{ paddingLeft: 0, color: colors.textSecondary }}
          data-testid="back-to-list-link"
        >
          <span aria-hidden="true">←</span> {frame.backToList}
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
          <BookmarkButton
            oppId={oppId}
            bookmark={bookmark}
            onChanged={onBookmarkChanged}
            hideStaffHint
          />
          <HomepageControls
            oppId={oppId}
            onReload={onReload}
            suggestDays={suggestDays}
            hideStaffHint
          />
          {reportLink}
        </div>
      </div>
      {!canRecord ? (
        // #803: 전에는 [관심]·[다시 조사] 옆에 같은 안내가 두 번 붙었다.
        <span
          data-testid="detail-pick-staff"
          style={{
            color: colors.textSecondary,
            fontSize: typography.fontSizeSecondary,
            justifySelf: 'end',
          }}
        >
          {detailHeader.pickStaffOnce}
        </span>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
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
                : header.researchState === 'NOT_TRIED'
                  ? candidateSearch.researchNotYet
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
        {/* 대응·담당은 중립 꼬리표로(#972). 읽는 글은 "대응 · 영업"처럼 이름표와 값이 함께다. */}
        <dl data-testid="detail-meta" style={{ display: 'contents' }}>
          {[
            {
              key: 'purpose',
              label: detailHeader.purpose,
              value: labelFor(purposeLabels, header.purpose),
            },
            ...(ownerName ? [{ key: 'owner', label: detailHeader.owner, value: ownerName }] : []),
          ].map((cell) => (
            <div
              key={cell.key}
              style={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 6,
                padding: '2px 10px',
                borderRadius: radius.tag,
                background: tagPalette.neutral.bg,
                color: tagPalette.neutral.fg,
                fontSize: typography.fontSizeSecondary,
                lineHeight: 1.6,
              }}
            >
              <dt>{cell.label}</dt>
              <dd style={{ margin: 0, fontWeight: 600, color: colors.text }}>{cell.value}</dd>
            </div>
          ))}
        </dl>
        {/* 의견은 줄 오른쪽 끝에(좁으면 아래 줄로 내려간다). */}
        {opinion ? <span style={{ marginLeft: 'auto' }}>{opinion}</span> : null}
      </div>
      {/* 영업 단계 카드. 제목 "영업 단계"는 그림 부품이 스스로 그린다. */}
      <div
        data-testid="detail-stage-card"
        style={{
          display: 'grid',
          gap: 14,
          padding: spacing.cardPadding,
          background: colors.bgContainer,
          border: `1px solid ${detailTheme.border}`,
          borderRadius: detailTheme.radius,
        }}
      >
        <SalesProgressBar
          salesStep={salesStep}
          outcome={outcome}
          contactTotal={contactTotal}
          questions={questions}
        />
        {stageExtra ? (
          <div
            data-testid="detail-stage-extra"
            style={{ paddingTop: 14, borderTop: `1px solid ${detailTheme.border}` }}
          >
            {stageExtra}
          </div>
        ) : null}
        {stageContacts ? (
          <div
            data-testid="detail-stage-contacts"
            style={{ paddingTop: 14, borderTop: `1px solid ${detailTheme.border}` }}
          >
            {stageContacts}
          </div>
        ) : null}
      </div>
    </div>
  );
}
