// 상세 머리(S2). #996(PM 결정 2026-11-29) 구성:
//   맨 위 줄  — 왼쪽 "← 목록으로", 오른쪽 끝 "이번 달 AI 사용 $… / $…"(전에는 [다시 조사] 옆)
//   이름 줄   — 회사 이름을 크게 굵게(h1) + 꼬리표(분류 · 점수 · 조사 상태 · 가상 · 대응 · 담당), 오른쪽에 [관심] · [다시 조사] · 보고서 ↗
//   품목 줄   — 이름 아래 작은 글 "품목 탄소강·합금강 육각볼트·스터드 전기아연도금"
//   요약 줄   — 산업 · 공정 · 소재 · 위치 · 홈페이지(`DetailSummaryRow.tsx`, 페이지가 넣는다)
//   담당자 의견 — 요약 줄 아래 오른쪽 끝(`OpinionArea` variant="box", 페이지가 넣는다)
// 전에는 서버 제목 "회사 이름 · 품목"이 공통 틀의 h1 한 줄이라 이름이 품목에 묻혔다. 목록 줄과 같은 도우미(`splitTitle`)로
// 이름과 품목을 나눈다. 나눌 수 없는 제목이면 전체를 이름으로 보이고 품목 줄은 그리지 않는다.
// [기록 남기기 ↓](#691, 이동만)는 기록 칸이 본문 아래에 있는 화면(좁은 기기)에서만 그린다. 넓은 화면은 영업 코치 칸이
// 늘 옆에 있어 눌러도 달라지는 것이 안 보였다. 페이지가 `onGoRecord`를 넘길 때만 그린다.
// 영업 단계 카드는 머리 밖 둘째 줄로 나갔다(`StageCard.tsx`).
// 분류 꼬리표 "필수조건 확인 필요"·"평가 전"은 카드(#659)와 같게 보이지 않는다.
import type { ReactNode } from 'react';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BookmarkRecord, DetailHeader } from '../../api/types';
import BookmarkButton from '../common/BookmarkButton';
import MonthSpendLine from '../common/MonthSpendLine';
import { useFrame } from '../frame/FrameContext';
import StatusTag from '../common/StatusTag';
import ScoreLine from '../common/ScoreLine';
import { splitTitle } from '../list/OpportunityCard';
import HomepageControls from './HomepageControls';
import {
  candidateSearch,
  cardRows,
  classificationLabels,
  classificationTone,
  detailCompose,
  detailHeader,
  frame,
  labelFor,
  ownPlatingLine,
  purposeLabels,
  recordsArea,
} from '../../labels/ko';
import { colors, detailLayout, radius, tagPalette, typography } from '../../theme/tokens';
import { daysAgo } from '../../utils/time';

export interface HeaderSectionProps {
  oppId: string;
  /** [다시 조사]가 끝났거나 새로 불러오기를 눌렀을 때. 상세 화면이 서버에서 다시 읽는다. */
  onReload: () => void;
  /**
   * [기록 남기기 ↓](#691): 적는 곳의 기록 남기기 칸으로 내려간다. 없으면 단추를 보이지 않는다.
   * #996: 기록 칸이 본문 아래에 있는 화면(좁은 기기)에서만 넘긴다.
   */
  onGoRecord?: () => void;
  header: DetailHeader;
  /** 관심 표시(#357). 한 번도 켠 적이 없으면 null. 기록을 저장하면 상세 화면이 서버 값으로 다시 맞춰 준다. */
  bookmark: BookmarkRecord | null;
  /** [관심] 단추로 켜거나 껐을 때 서버가 돌려준 값을 알린다. */
  onBookmarkChanged: (bookmark: BookmarkRecord) => void;
  /** 담당자 키를 이름으로 바꾼 값. 모르면 담당 줄을 보이지 않는다. */
  ownerName?: string | null;
  classificationOverrides?: Record<string, string>;
  /** #803: 단추 줄 끝에 붙는 [보고서 ↗] 링크. */
  reportLink?: ReactNode;
  /** #996: 이름 · 품목 아래의 요약 줄(산업 · 공정 · 소재 · 위치 · 홈페이지 + [정보 고치기]). */
  summary?: ReactNode;
  /** #996: 요약 줄 아래 오른쪽 끝의 "담당자 의견" 칸. */
  opinion?: ReactNode;
}

/** 머리에 꼬리표로 보이지 않는 분류(#659 카드와 같다). 무엇을 확인할지는 "한눈에"의 "확인할 점"이 말한다. */
const HIDDEN_CLASSIFICATIONS = new Set(['FILTER_PENDING', 'NOT_EVALUATED']);

export default function HeaderSection({
  oppId,
  onReload,
  onGoRecord,
  header,
  bookmark,
  onBookmarkChanged,
  ownerName,
  classificationOverrides,
  reportLink = null,
  summary = null,
  opinion = null,
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
  // 이름과 품목: 목록 줄과 같은 규칙(" · " 앞이 이름). 나눌 수 없으면 전체가 이름이다.
  const { name, item } = splitTitle(header.title);

  return (
    <div data-testid="detail-header" style={{ display: 'grid', gap: 10 }}>
      {/* 맨 위 줄: 목록으로(왼쪽) · 이번 달 AI 사용(오른쪽 끝). */}
      <div
        data-testid="detail-top-line"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '4px 12px',
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
        {/* 돈이 드는 단추([다시 조사])를 쓸 수 있는 사람에게만 보인다(전과 같다). */}
        {canRecord ? (
          <span data-testid="detail-month-spend" style={{ marginLeft: 'auto' }}>
            <MonthSpendLine />
          </span>
        ) : null}
      </div>
      {/* 이름 줄: 이름(h1) + 꼬리표, 오른쪽에 [관심] · [다시 조사] · 보고서. 좁으면 단추들이 아래 줄로 내려간다. */}
      <div
        data-testid="detail-name-line"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '10px 16px',
        }}
      >
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
            <h1
              data-testid="detail-company-name"
              style={{
                margin: 0,
                fontSize: detailLayout.nameSize,
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: '-0.5px',
                overflowWrap: 'anywhere',
              }}
            >
              {name}
            </h1>
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
                ...(ownerName
                  ? [{ key: 'owner', label: detailHeader.owner, value: ownerName }]
                  : []),
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
          </div>
          {item ? (
            <div
              data-testid="detail-company-item"
              style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
            >
              <span
                style={{
                  marginRight: 8,
                  color: colors.textDimmed,
                  fontSize: detailLayout.smallFont,
                }}
              >
                {detailCompose.itemLabel}
              </span>
              {item}
            </div>
          ) : null}
        </div>
        <div
          data-testid="detail-actions"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            alignItems: 'flex-start',
            gap: 8,
            marginLeft: 'auto',
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
            hideSpend
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
      {summary}
      {opinion ? (
        <div data-testid="detail-opinion-line" style={{ display: 'grid', justifyItems: 'end' }}>
          {opinion}
        </div>
      ) : null}
    </div>
  );
}
