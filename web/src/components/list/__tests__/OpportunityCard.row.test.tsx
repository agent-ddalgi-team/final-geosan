// #972: 회사 카드가 표 줄 모양이 됐다. 회사·품목 | 지역·거리 | 추천 근거 + 검토사항 + 꼬리표 | 점수 | 의견 + 관심 별.
// 카드 때 보이던 정보가 줄 안에 하나도 빠지지 않고 제 칸에 있는지 본다. 서버 호출 없이 줄만 그린다(가상 값).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpportunityCard from '../OpportunityCard';
import type { OpportunityCard as CardData } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { listTheme } from '../../../theme/tokens';
import listFixture from '../../../test/fixtures/opportunities-apjeong.json';

const apjeong = listFixture.data[0] as unknown as CardData;

function renderRow(changes: Partial<CardData>, canRecord = true) {
  render(
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: canRecord ? 'park-lee' : null,
          setStaffKey: () => {},
          canRecord,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <OpportunityCard
          card={{ ...apjeong, ...changes }}
          processNames={{ ZINC_PLATING: '전기아연도금' }}
        />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
  const row = screen.getByTestId('opportunity-card');
  // 칸 다섯 개가 시안 순서대로 있다.
  const cells = Array.from(row.children) as HTMLElement[];
  return { row, cells };
}

/** 점수가 있는 "근거 있음" 회사: 꼬리표가 붙을 수 있는 값을 모두 채운다. */
const full: Partial<CardData> = {
  rank: 3,
  region: '아산시',
  distanceKm: 8.2,
  industries: ['자동차 부품', '방위산업'],
  confirmedProcessCodes: ['ZINC_PLATING'],
  proposedProcessCount: 0,
  bucket: 'EVIDENCE_READY',
  bucketBasis: 'EVIDENCE_ENOUGH',
  fitLevel: 'HIGH',
  fitBasis: 'HOMEPAGE',
  previousFitLevel: 'MEDIUM',
  classificationCode: 'CONTACT_URGENT',
  scoreDisplay: '참고 63점 · 5/8',
  scoreState: 'PENDING',
  relationStatus: 'EXISTING_CONFIRMED',
  isVirtual: true,
  datasetKind: 'BROCHURE',
  reevaluated: true,
  ingestedAt: '2026-11-24T01:00:00Z',
  ownPlatingLineSuspected: true,
  ownPlatingLineBasis: '생산품 "알루미늄 아노다이징"',
  supplyTier: 'TIER2_3',
  supplyTierBasis: '볼트·너트를 직접 가공',
  salesStep: null,
  checkPoints: ['소재 확인 전'],
  checkKinds: ['MATERIAL'],
  rankAdjust: {
    level: 1,
    processName: '전기아연도금',
    industry: '자동차 부품',
    wonCount: 2,
    lostCount: 0,
    countedLostReasons: [],
    windowDays: 365,
  } as unknown as CardData['rankAdjust'],
  records: {
    opinion: null,
    bookmark: null,
    outcome: {
      version: 1,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-20T01:00:00Z',
      status: 'IN_PROGRESS',
    },
  },
};

describe('OpportunityCard 표 줄 (#972)', () => {
  it('줄은 칸 다섯 개다: 회사·품목 | 지역·거리 | 추천 근거·검토사항·꼬리표 | 점수 | 의견·관심', () => {
    const { row, cells } = renderRow(full);
    expect(row).toHaveAttribute('data-layout', 'table');
    expect(row).toHaveClass('cand-row');
    expect(cells).toHaveLength(5);
    const [company, region, reason, score, actions] = cells;

    // 1칸: 번호 · 회사 이름(상세 링크) · 들어온 날짜 · 산업.
    expect(within(company).getByTestId('card-rank')).toHaveTextContent(/^3$/);
    expect(within(company).getByTestId('card-rank')).toHaveAttribute('aria-label', '순위 3');
    expect(within(company).getByTestId('card-title-link')).toHaveTextContent(apjeong.title);
    expect(within(company).getByTestId('card-ingested-tag')).toHaveTextContent('11/24 들어옴');
    expect(
      within(company)
        .getAllByTestId('card-industry-tag')
        .map((tag) => tag.textContent),
    ).toEqual(['자동차 부품', '방위산업']);

    // 2칸: 지역(시·군)과 거산에서의 거리.
    expect(within(region).getByTestId('card-region')).toHaveTextContent(/^아산시$/);
    expect(within(region).getByTestId('card-distance-tag')).toHaveTextContent('거산에서 8.2km');

    // 3칸: 추천 근거 · 검토사항 · 순서 조정 · 표면처리 직접 근거 · 꼬리표들.
    expect(within(reason).getByTestId('card-reason')).toHaveTextContent(apjeong.reason);
    expect(within(reason).getByTestId('card-blocker')).toHaveTextContent(/^확인할 것: 소재$/);
    expect(within(reason).getByTestId('card-rank-adjust')).toHaveTextContent('성사 2곳');
    expect(within(reason).getByTestId('card-own-plating-basis')).toHaveTextContent(
      '생산품 "알루미늄 아노다이징"',
    );
    expect(within(reason).getByTestId('card-classification')).toBeInTheDocument();
    expect(within(reason).getByTestId('card-fit-level')).toHaveTextContent('적합도 상 ↑');
    expect(within(reason).getByTestId('card-process-tag')).toHaveTextContent('전기아연도금');
    expect(within(reason).getByTestId('card-virtual-tag')).toBeInTheDocument();
    expect(within(reason).getByTestId('card-brochure-tag')).toBeInTheDocument();
    expect(within(reason).getByTestId('card-stage-tag')).toBeInTheDocument();
    expect(within(reason).getByTestId('card-reevaluated-tag')).toBeInTheDocument();
    expect(within(reason).getByTestId('card-own-plating-tag')).toBeInTheDocument();
    expect(within(reason).getByTestId('card-supply-tier-tag')).toHaveAttribute(
      'title',
      '볼트·너트를 직접 가공',
    );

    // 4칸: 점수 글자는 서버가 준 그대로이고 꼬리표(확인 전 · 기존 거래처)도 여기 있다.
    expect(within(score).getByTestId('card-score')).toHaveTextContent(/^참고 63점 · 5\/8$/);
    expect(within(score).getByTestId('card-score-ai-proposal-tag')).toBeInTheDocument();
    expect(within(score).getByTestId('card-score-existing-tag')).toBeInTheDocument();

    // 5칸: 의견 고르기 · 관심 별 · 자세히 보기.
    expect(within(actions).getByTestId('opinion-select')).toBeEnabled();
    expect(within(actions).getByTestId('bookmark-button')).toBeInTheDocument();
    expect(within(actions).getByTestId('card-view-detail-link')).toHaveAttribute(
      'href',
      `/opportunities/${encodeURIComponent(apjeong.oppId)}`,
    );
  });

  it('점수는 숫자만 크게 띄우고 글자는 서버가 준 그대로다', () => {
    const { cells } = renderRow({ ...full, scoreState: 'CONFIRMED' });
    const score = within(cells[3]).getByTestId('card-score');
    expect(score).toHaveTextContent(/^참고 63점 · 5\/8$/);
    expect(within(score).getByText('63')).toHaveStyle({
      fontSize: `${listTheme.scoreSize}px`,
      fontWeight: 700,
    });
  });

  it('확인할 것이 있으면 검토사항 줄이 주의 글자색이고, 없으면("없음 — …") 보통 글자색이다', () => {
    const first = renderRow(full);
    expect(within(first.cells[2]).getByTitle('확인할 것: 소재')).toHaveStyle({
      color: listTheme.checkFg,
    });
    document.body.innerHTML = '';
    const second = renderRow({ ...full, checkPoints: [], checkKinds: [] });
    expect(within(second.cells[2]).getByTitle(apjeong.blocker.text)).toHaveStyle({
      color: listTheme.bodyFg,
    });
  });

  it('점수 전 회사는 점수 칸에 "점수 전 · 조사 중", 추천 근거 칸에 고른 이유가 보인다', () => {
    const { cells } = renderRow({
      ...full,
      bucket: 'NOT_RESEARCHED',
      scoreState: 'NONE',
      scoreDisplay: '--',
      pickReason: '앵커 볼트를 생산하고 원자재가 강재',
      researchState: 'RUNNING',
    });
    expect(within(cells[3]).getByTestId('card-score')).toHaveTextContent(/^점수 전 · 조사 중$/);
    expect(within(cells[2]).getByTestId('card-pick-reason')).toHaveTextContent(
      '앵커 볼트를 생산하고 원자재가 강재',
    );
    expect(within(cells[2]).getByText('고른 이유')).toBeInTheDocument();
  });

  it('주소가 없는 회사는 "지역 미확인", 지역·거리 칸이 없는 옛 응답은 지역 칸이 비어 있다', () => {
    const first = renderRow({ ...full, region: null, distanceKm: null });
    expect(within(first.cells[1]).getByTestId('card-region')).toHaveTextContent('지역 미확인');
    expect(within(first.cells[1]).queryByTestId('card-distance-tag')).not.toBeInTheDocument();
    document.body.innerHTML = '';
    const second = renderRow({});
    expect(second.cells).toHaveLength(5);
    expect(second.cells[1]).toBeEmptyDOMElement();
  });

  it('관심 단추는 별 그림이고 이름은 "관심"/"관심 기업" 그대로다', () => {
    const first = renderRow(full);
    const off = within(first.row).getByRole('button', { name: '관심', pressed: false });
    expect(off).toHaveAttribute('data-variant', 'star');
    expect(off.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(off).toHaveStyle({ background: listTheme.starOff.bg });
    document.body.innerHTML = '';
    const second = renderRow({
      ...full,
      records: {
        ...full.records,
        bookmark: {
          version: 1,
          updatedBy: 'park-lee',
          updatedAt: '2026-11-06T01:00:00Z',
          active: true,
        },
      },
    });
    const on = within(second.row).getByRole('button', { name: '관심 기업', pressed: true });
    expect(on).toHaveStyle({ background: listTheme.starOn.bg, color: listTheme.starOn.fg });
  });

  it('담당자를 고르기 전에는 의견 칸과 별이 잠기고, 안내는 의견 칸 옆 한 줄과 별의 손 올림 글로 보인다', () => {
    const { row } = renderRow(full, false);
    expect(within(row).getByTestId('opinion-select')).toBeDisabled();
    expect(within(row).getByTestId('opinion-pick-staff-text')).toBeInTheDocument();
    const star = within(row).getByTestId('bookmark-button');
    expect(star).toBeDisabled();
    expect(star).toHaveAttribute('title', '담당자를 고르면 관심으로 담을 수 있습니다');
  });
});
