// #972: 회사 카드가 표 줄 모양이 됐다.
// #981(PM 결정 2026-11-28): 거래처 후보 줄은 세 칸이다. 회사 이름·품목·산업·"지역 · 거리" | 추천 근거 + 검토사항 + 꼬리표 |
// 적합도·점수(숫자만)·관심 별 + 의견 고르기. [자세히 보기]는 없고 회사 이름을 누른다.
// #987(PM 결정 2026-11-28): 거래처 후보 줄 첫 칸은 회사 이름 아래 이름표가 붙은 줄 세 개(품목 · 산업 · 지역)다.
// 거리 · 들어온 날짜 · "거래 확인 전" 꼬리표는 거래처 후보 줄에서 뺐다(관심 기업 줄에는 그대로).
// "추천 근거"·"고른 이유"는 "추천 이유" 한 말로 보이고, 꼬리표와 의견 고르기는 줄 맨 아래(cand-row__bottom)에 놓인다.
// 카드 때 보이던 정보가 줄 안에 제 칸에 있는지 본다. 서버 호출 없이 줄만 그린다(가상 값).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpportunityCard from '../OpportunityCard';
import type { OpportunityCard as CardData } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { listTable } from '../../../labels/ko';
import { accent, colors, listTheme, opinionNudge } from '../../../theme/tokens';
import listFixture from '../../../test/fixtures/opportunities-apjeong.json';

const apjeong = listFixture.data[0] as unknown as CardData;

function renderRow(
  changes: Partial<CardData>,
  canRecord = true,
  layout: 'table' | 'bookmark' = 'table',
) {
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
          layout={layout}
          showRank={layout === 'table'}
        />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
  const row = screen.getByTestId('opportunity-card');
  // 줄의 칸들(거래처 후보 줄도 관심 기업 줄도 셋)이 시안 순서대로 있다.
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

/** 관심(★)을 켠 기록. */
const bookmarkOn = {
  version: 1,
  updatedBy: 'park-lee',
  updatedAt: '2026-11-06T01:00:00Z',
  active: true,
};

/** 앞 요소가 뒤 요소보다 문서에서 먼저 나오는지. */
const comesBefore = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('OpportunityCard 표 줄 (#972, #981 세 칸)', () => {
  /** 첫 칸의 이름표 줄들(이름표 글은 CSS가 data-label로 그린다)을 [이름표, 글]로 읽는다. */
  const factsOf = (cell: HTMLElement) =>
    Array.from(cell.querySelectorAll<HTMLElement>('.cand-row__fact')).map((fact) => [
      fact.getAttribute('data-label'),
      fact.textContent,
    ]);

  it('줄은 칸 세 개다: 회사 이름·품목·산업·지역 | 추천 이유·검토사항·꼬리표 | 적합도·점수·관심·의견', () => {
    const { row, cells } = renderRow(full);
    expect(row).toHaveAttribute('data-layout', 'table');
    expect(row).toHaveClass('cand-row');
    expect(row).not.toHaveClass('cand-row--three');
    expect(cells).toHaveLength(3);
    const [company, reason, actions] = cells;

    // 1칸: 번호 · 회사 이름(상세 링크) 아래에 이름표가 붙은 줄 세 개(품목 · 산업 · 지역).
    expect(within(company).getByTestId('card-rank')).toHaveTextContent(/^3$/);
    expect(within(company).getByTestId('card-rank')).toHaveAttribute('aria-label', '순위 3');
    expect(within(company).getByTestId('card-title')).toHaveTextContent(apjeong.title);
    expect(within(company).getByTestId('card-title-link')).toHaveAttribute(
      'href',
      `/opportunities/${encodeURIComponent(apjeong.oppId)}`,
    );
    expect(factsOf(company)).toEqual([
      ['품목', '밸브 바디 아노다이징'],
      ['산업', '자동차 부품 · 방위산업'],
      ['지역', '아산시'],
    ]);
    expect(
      within(company)
        .getAllByTestId('card-industry-tag')
        .map((tag) => tag.textContent),
    ).toEqual(['자동차 부품', '방위산업']);
    expect(within(company).getByTestId('card-region')).toHaveTextContent(/^아산시$/);
    // 거리와 들어온 날짜는 거래처 후보 줄에 보이지 않는다(#987). 값이 응답에 있어도 그리지 않는다.
    expect(within(row).queryByTestId('card-distance-tag')).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent('거산에서');
    expect(within(row).queryByTestId('card-ingested-tag')).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent('들어옴');

    // 2칸: 추천 이유 · 검토사항 · 순서 조정 · 표면처리 직접 근거 · 꼬리표들(적합도 꼬리표는 여기 없다).
    expect(reason).toHaveClass('cand-row__reason');
    expect(within(reason).getByTestId('card-reason')).toHaveTextContent(apjeong.reason);
    expect(within(reason).getByTestId('card-blocker')).toHaveTextContent(/^확인할 것: 소재$/);
    expect(within(reason).getByTestId('card-rank-adjust')).toHaveTextContent('성사 2곳');
    expect(within(reason).getByTestId('card-own-plating-basis')).toHaveTextContent(
      '생산품 "알루미늄 아노다이징"',
    );
    expect(within(reason).getByTestId('card-classification')).toBeInTheDocument();
    expect(within(reason).queryByTestId('card-fit-level')).not.toBeInTheDocument();
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

    // 3칸 첫 줄: 적합도 · 점수(숫자만) · 점수 꼬리표(확인 전 · 기존 거래처) + 관심 별. 그 아래 의견 고르기.
    expect(actions).toHaveClass('cand-row__actions');
    const scoreLine = actions.querySelector('.cand-row__score-line') as HTMLElement;
    const scoreBox = scoreLine.querySelector('.cand-row__score') as HTMLElement;
    expect(within(scoreBox).getByTestId('card-fit-level')).toHaveTextContent(/^적합도 상 ↑$/);
    expect(within(scoreBox).getByTestId('card-score')).toHaveTextContent(/^참고 63점$/);
    expect(within(scoreBox).getByTestId('card-score-ai-proposal-tag')).toBeInTheDocument();
    expect(within(scoreBox).getByTestId('card-score-existing-tag')).toBeInTheDocument();
    expect(within(scoreLine).getByTestId('bookmark-button')).toBeInTheDocument();
    const opinion = within(actions).getByTestId('opinion-select');
    expect(opinion).toBeEnabled();
    expect(scoreLine).not.toContainElement(opinion);
    expect(comesBefore(scoreLine, opinion)).toBe(true);
  });

  describe('첫 칸의 이름표 줄 (#987)', () => {
    it('이름표 글은 글 대응표의 "품목"·"산업"·"지역"이고, 화면 글자가 아니라 data-label로 붙어 제목 글은 "회사 · 품목" 그대로다', () => {
      const { cells } = renderRow(full);
      expect(listTable.facts).toEqual({ item: '품목', industry: '산업', region: '지역' });
      const item = within(cells[0]).getByTestId('card-title-item');
      expect(item).toHaveClass('cand-row__fact');
      expect(item).toHaveAttribute('data-label', listTable.facts.item);
      // 이름표는 CSS가 그리므로 품목 글자에도, 제목(화면 낭독 · 검색이 읽는 글)에도 "품목"이 섞이지 않는다.
      expect(item.textContent).toBe('밸브 바디 아노다이징');
      expect(within(cells[0]).getByTestId('card-title').textContent).toBe(apjeong.title);
      const industry = within(cells[0])
        .getAllByTestId('card-industry-tag')[0]
        .closest('.cand-row__fact');
      expect(industry).toHaveAttribute('data-label', listTable.facts.industry);
      const region = within(cells[0]).getByTestId('card-region').closest('.cand-row__fact');
      expect(region).toHaveAttribute('data-label', listTable.facts.region);
      expect(region?.textContent).toBe('아산시');
      // 줄 순서: 회사 이름 → 품목 → 산업 → 지역.
      const link = within(cells[0]).getByTestId('card-title-link');
      expect(comesBefore(link, item)).toBe(true);
      expect(comesBefore(item, industry as Element)).toBe(true);
      expect(comesBefore(industry as Element, region as Element)).toBe(true);
    });

    it('산업이 비어 있으면 "산업 미확정", 주소가 없으면 "지역 미확인"을 이름표 옆에 보인다', () => {
      const { cells } = renderRow({ ...full, industries: [], region: null, distanceKm: null });
      expect(factsOf(cells[0])).toEqual([
        ['품목', '밸브 바디 아노다이징'],
        ['산업', '산업 미확정'],
        ['지역', '지역 미확인'],
      ]);
    });

    it('품목이 없는 제목(" · " 없음)은 품목 줄 없이 산업 · 지역 줄만 있다', () => {
      const { cells } = renderRow({ ...full, title: '가상정밀' });
      expect(factsOf(cells[0])).toEqual([
        ['산업', '자동차 부품 · 방위산업'],
        ['지역', '아산시'],
      ]);
    });

    it('거리와 들어온 날짜는 거래처 후보 줄에는 없고 관심 기업 줄에는 꼬리표로 그대로 있다', () => {
      const table = renderRow(full);
      expect(within(table.row).queryByTestId('card-distance-tag')).not.toBeInTheDocument();
      expect(within(table.row).queryByTestId('card-ingested-tag')).not.toBeInTheDocument();
      document.body.innerHTML = '';
      const bookmark = renderRow(full, true, 'bookmark');
      expect(within(bookmark.row).getByTestId('card-distance-tag')).toHaveTextContent(
        /^거산에서 8\.2km$/,
      );
      expect(within(bookmark.row).getByTestId('card-ingested-tag')).toHaveTextContent(
        /^11\/24 들어옴$/,
      );
      // 관심 기업 줄에는 이름표 줄이 없다(품목은 이름표 없이 회사 이름 아래).
      expect(bookmark.row.querySelectorAll('.cand-row__fact')).toHaveLength(0);
      expect(within(bookmark.row).getByTestId('card-title-item')).not.toHaveAttribute('data-label');
    });
  });

  describe('가운데 칸 "추천 이유" (#987)', () => {
    it('이름표 "추천 이유"가 눈에 보이는 한 줄로 한 번만 있고, 그 아래 근거 글이 놓인다. "추천 근거"·"고른 이유"라는 말은 줄에 없다', () => {
      const { row, cells } = renderRow(full);
      expect(listTable.reasonLabel).toBe('추천 이유');
      const labels = within(row).getAllByText('추천 이유');
      expect(labels).toHaveLength(1);
      expect(cells[1]).toContainElement(labels[0]);
      // 좁은 화면·낭독용 숨은 이름표가 아니라 늘 보이는 한 줄이다.
      expect(labels[0]).not.toHaveClass('cand-row__label');
      expect(labels[0]).toHaveStyle({ display: 'block' });
      const reason = within(cells[1]).getByTestId('card-reason');
      expect(reason.textContent).toBe(apjeong.reason);
      expect(reason.parentElement).toBe(labels[0].parentElement);
      expect(comesBefore(labels[0], reason)).toBe(true);
      expect(within(cells[1]).queryByTestId('card-pick-reason')).not.toBeInTheDocument();
      expect(row).not.toHaveTextContent('추천 근거');
      expect(row).not.toHaveTextContent('고른 이유');
    });

    it('근거 글과 고른 이유 글이 다르면 이름표 하나 아래에 한 줄씩(근거 → 고른 이유) 놓인다', () => {
      const { row, cells } = renderRow({
        ...full,
        pickReason: '앵커 볼트를 생산하고 원자재가 강재',
      });
      const labels = within(row).getAllByText('추천 이유');
      expect(labels).toHaveLength(1);
      const reason = within(cells[1]).getByTestId('card-reason');
      const pick = within(cells[1]).getByTestId('card-pick-reason');
      expect(reason.textContent).toBe(apjeong.reason);
      expect(pick.textContent).toBe('앵커 볼트를 생산하고 원자재가 강재');
      expect(Array.from((labels[0].parentElement as HTMLElement).children)).toEqual([
        labels[0],
        reason,
        pick,
      ]);
      expect(reason).toHaveStyle({ display: 'block' });
      expect(pick).toHaveStyle({ display: 'block' });
      expect(row).not.toHaveTextContent('추천 근거');
      expect(row).not.toHaveTextContent('고른 이유');
    });

    it('두 글이 같으면 근거 글은 그리지 않고 고른 이유 글 한 줄만 이름표 아래에 보인다', () => {
      const { row, cells } = renderRow({ ...full, pickReason: ` ${apjeong.reason} ` });
      expect(within(row).getAllByText('추천 이유')).toHaveLength(1);
      expect(within(cells[1]).queryByTestId('card-reason')).not.toBeInTheDocument();
      expect(within(cells[1]).getByTestId('card-pick-reason')).toHaveTextContent(apjeong.reason);
    });

    it('관심 기업 줄도 이름표가 "추천 이유" 하나이고 "추천 근거"·"고른 이유"라는 말이 없다', () => {
      const { row, cells } = renderRow(
        { ...full, pickReason: '앵커 볼트를 생산하고 원자재가 강재' },
        true,
        'bookmark',
      );
      const labels = within(row).getAllByText('추천 이유');
      expect(labels).toHaveLength(1);
      expect(cells[1]).toContainElement(labels[0]);
      expect(within(cells[1]).getByTestId('card-reason').textContent).toBe(apjeong.reason);
      expect(within(cells[1]).getByTestId('card-pick-reason').textContent).toBe(
        '앵커 볼트를 생산하고 원자재가 강재',
      );
      expect(row).not.toHaveTextContent('추천 근거');
      expect(row).not.toHaveTextContent('고른 이유');
    });
  });

  describe('줄 맨 아래에 맞춘 것 (#987)', () => {
    it('가운데 칸의 꼬리표 묶음과 오른쪽 칸의 의견 고르기는 cand-row__bottom 안에 있고, 추천 이유·점수 줄은 그 밖(위)에 있다', () => {
      const { cells } = renderRow(full);
      const [, reason, actions] = cells;
      const tagBottom = reason.querySelector(':scope > .cand-row__bottom') as HTMLElement;
      const tags = within(reason).getByRole('group', { name: listTable.tagsLabel });
      expect(tagBottom).toContainElement(tags);
      expect(tagBottom).toContainElement(within(reason).getByTestId('card-classification'));
      expect(tagBottom).toContainElement(within(reason).getByTestId('card-process-tag'));
      // 추천 이유 · 검토사항은 꼬리표보다 위, cand-row__bottom 밖에 있다.
      const reasonText = within(reason).getByTestId('card-reason');
      expect(tagBottom).not.toContainElement(reasonText);
      expect(tagBottom).not.toContainElement(within(reason).getByTestId('card-blocker'));
      expect(comesBefore(reasonText, tagBottom)).toBe(true);
      expect(reason.lastElementChild).toBe(tagBottom);

      const opinionBottom = actions.querySelector(':scope > .cand-row__bottom') as HTMLElement;
      expect(opinionBottom).toHaveClass('cand-row__actions-main');
      expect(opinionBottom).toContainElement(within(actions).getByTestId('opinion-select'));
      expect(opinionBottom).not.toContainElement(within(actions).getByTestId('card-score'));
      expect(opinionBottom).not.toContainElement(within(actions).getByTestId('bookmark-button'));
      expect(actions.lastElementChild).toBe(opinionBottom);
      // 줄 전체에서 맨 아래에 맞추는 묶음은 이 둘뿐이다.
      expect(cells[0].querySelector('.cand-row__bottom')).toBeNull();
    });

    it('꼬리표가 하나도 없는 줄은 가운데 칸에 빈 묶음을 그리지 않는다(의견 고르기는 그대로 맨 아래)', () => {
      const { cells } = renderRow({
        ...full,
        classificationCode: 'FILTER_PENDING',
        confirmedProcessCodes: [],
        isVirtual: false,
        datasetKind: 'COMPANY_CONFIRMED',
        reevaluated: false,
        ownPlatingLineSuspected: false,
        supplyTier: null,
        records: { opinion: null, bookmark: null, outcome: null },
      });
      expect(cells[1].querySelector('.cand-row__bottom')).toBeNull();
      expect(within(cells[1]).queryByRole('group', { name: listTable.tagsLabel })).toBeNull();
      expect(cells[2].querySelector(':scope > .cand-row__bottom')).toContainElement(
        within(cells[2]).getByTestId('opinion-select'),
      );
    });
  });

  describe('"거래 확인 전" 꼬리표 (#987)', () => {
    /** 거래 관계 확인을 기다리는 점수: 서버는 분류가 필수조건 확인 대기일 때만 이 상태를 준다. */
    const pending: Partial<CardData> = {
      ...full,
      scoreState: 'PENDING',
      classificationCode: 'FILTER_PENDING',
      relationStatus: 'UNCONFIRMED',
      scoreDisplay: '50점 · 3/8',
    };

    it('거래처 후보 줄에는 "거래 확인 전" 꼬리표가 붙지 않고, 점수 글자의 흐림 표시는 그대로다', () => {
      const { row, cells } = renderRow(pending);
      const score = within(cells[2]).getByTestId('card-score');
      expect(score).toHaveTextContent(/^50점$/);
      expect(score).toHaveAttribute('data-score-state', 'PENDING');
      expect(score).toHaveStyle({ color: colors.textDimmed });
      expect(within(score).getByText('50')).toHaveStyle({ color: colors.textDimmed });
      expect(within(row).queryByTestId('card-score-pending-tag')).not.toBeInTheDocument();
      expect(row).not.toHaveTextContent('거래 확인 전');
    });

    it('관심 기업 줄에는 "거래 확인 전" 꼬리표가 그대로 붙는다', () => {
      const { cells } = renderRow(pending, true, 'bookmark');
      const score = within(cells[2]).getByTestId('card-score');
      expect(score).toHaveAttribute('data-score-state', 'PENDING');
      expect(within(cells[2]).getByTestId('card-score-pending-tag')).toHaveTextContent(
        /^거래 확인 전$/,
      );
    });

    it('거래처 후보 줄에서도 "근거로 낸 점수 · 확인 전"과 "기존 거래처" 꼬리표는 그대로 붙는다', () => {
      // full: 확정 전인데 분류가 확인 대기가 아님(AI 제안으로 낸 점수) + 기존 거래처.
      const { cells } = renderRow(full);
      expect(within(cells[2]).getByTestId('card-score-ai-proposal-tag')).toHaveTextContent(
        /^근거로 낸 점수 · 확인 전$/,
      );
      expect(within(cells[2]).getByTestId('card-score-existing-tag')).toHaveTextContent(
        /^기존 거래처$/,
      );
      expect(within(cells[2]).queryByTestId('card-score-pending-tag')).not.toBeInTheDocument();
    });
  });

  it('회사 이름과 품목이 따로 놓이고, 제목 글은 "회사 · 품목" 그대로이며 링크 글은 회사 이름만이다', () => {
    const { cells } = renderRow({ ...full, title: 'A정밀 · 밸브 바디 아노다이징' });
    const title = within(cells[0]).getByTestId('card-title');
    // 화면 낭독·검색에는 서버 글자 그대로("회사 · 품목")가 읽힌다. 사이의 " · "만 눈에 숨긴 글자다.
    expect(title.textContent).toBe('A정밀 · 밸브 바디 아노다이징');
    expect(within(cells[0]).getByRole('heading', { level: 2 })).toBe(title);
    const link = within(title).getByTestId('card-title-link');
    expect(link.textContent).toBe('A정밀');
    expect(link).toHaveClass('cand-row__name');
    const item = within(title).getByTestId('card-title-item');
    expect(item.textContent).toBe('밸브 바디 아노다이징');
    expect(link).not.toContainElement(item);
    const separator = title.querySelector('.cand-row__sep') as HTMLElement;
    expect(separator.textContent).toBe(' · ');
    expect(comesBefore(link, separator)).toBe(true);
    expect(comesBefore(separator, item)).toBe(true);
  });

  it('품목에 " · "가 더 있어도 첫 " · "에서만 가른다', () => {
    const { cells } = renderRow({ ...full, title: '가상정밀 · 볼트 · 너트' });
    expect(within(cells[0]).getByTestId('card-title-link').textContent).toBe('가상정밀');
    expect(within(cells[0]).getByTestId('card-title-item').textContent).toBe('볼트 · 너트');
    expect(within(cells[0]).getByTestId('card-title').textContent).toBe('가상정밀 · 볼트 · 너트');
  });

  it('" · "가 없는 제목은 통째로 회사 이름이고 품목 줄이 없다', () => {
    const { cells } = renderRow({ ...full, title: '가상정밀' });
    const title = within(cells[0]).getByTestId('card-title');
    expect(title.textContent).toBe('가상정밀');
    expect(within(title).getByTestId('card-title-link').textContent).toBe('가상정밀');
    expect(within(title).queryByTestId('card-title-item')).not.toBeInTheDocument();
    expect(title.querySelector('.cand-row__sep')).toBeNull();
  });

  it('점수는 숫자만("63점") 크게 보이고 "· 5/8"은 보이지 않지만, 화면 낭독 문구는 전체를 읽는다', () => {
    const first = renderRow({ ...full, scoreState: 'CONFIRMED', scoreDisplay: '63점 · 5/8' });
    const score = within(first.cells[2]).getByTestId('card-score');
    expect(score).toHaveTextContent(/^63점$/);
    expect(score).toHaveAttribute('aria-label', '점수 63점, 8개 항목 중 5개 조사');
    expect(within(score).getByText('63')).toHaveStyle({
      fontSize: `${listTheme.scoreSize}px`,
      fontWeight: 700,
    });
    expect(first.row).not.toHaveTextContent('5/8');
    document.body.innerHTML = '';
    // "참고"는 그대로 보이고 낭독 문구에도 들어간다.
    const second = renderRow({ ...full, scoreState: 'CONFIRMED' });
    const reference = within(second.cells[2]).getByTestId('card-score');
    expect(reference).toHaveTextContent(/^참고 63점$/);
    expect(reference).toHaveAttribute('aria-label', '참고 점수 63점, 8개 항목 중 5개 조사');
  });

  it('점수가 없는 회사("--")는 "점수 --" 그대로 보인다', () => {
    const { cells } = renderRow({ ...full, scoreState: 'NONE', scoreDisplay: '--' });
    const score = within(cells[2]).getByTestId('card-score');
    expect(score).toHaveTextContent(/^점수 --$/);
    expect(score).toHaveAttribute('aria-label', '점수 산정 전');
  });

  it('적합도는 점수 앞에 놓이고, 적합도가 없는 줄은 점수만 있다', () => {
    const first = renderRow(full);
    const firstBox = first.cells[2].querySelector('.cand-row__score') as HTMLElement;
    const fit = within(firstBox).getByTestId('card-fit-level');
    expect(comesBefore(fit, within(firstBox).getByTestId('card-score'))).toBe(true);
    // 적합도 상은 눈에 띄는 색, 그 밖에는 보통 색이다(글자가 늘 함께 있다).
    expect(fit).toHaveAttribute('data-tone', 'ask');
    document.body.innerHTML = '';
    const medium = renderRow({ ...full, fitLevel: 'MEDIUM', previousFitLevel: null });
    const mediumFit = within(medium.cells[2]).getByTestId('card-fit-level');
    expect(mediumFit).toHaveTextContent(/^적합도 중$/);
    expect(mediumFit).toHaveAttribute('data-tone', 'neutral');
    document.body.innerHTML = '';
    const none = renderRow({ ...full, fitLevel: null, previousFitLevel: null });
    const noneBox = none.cells[2].querySelector('.cand-row__score') as HTMLElement;
    expect(within(none.row).queryByTestId('card-fit-level')).not.toBeInTheDocument();
    expect(within(noneBox).getByTestId('card-score')).toHaveTextContent(/^참고 63점$/);
  });

  it('거래처 후보 줄에는 [자세히 보기]가 없고(회사 이름이 상세 링크), 관심 기업 줄에는 그대로 있다', () => {
    const table = renderRow(full);
    expect(within(table.row).queryByTestId('card-view-detail-link')).not.toBeInTheDocument();
    expect(within(table.row).queryByText(/자세히 보기/)).not.toBeInTheDocument();
    expect(within(table.row).getByTestId('card-title-link')).toHaveAttribute(
      'href',
      `/opportunities/${encodeURIComponent(apjeong.oppId)}`,
    );
    document.body.innerHTML = '';
    const bookmark = renderRow(full, true, 'bookmark');
    expect(within(bookmark.row).getByTestId('card-view-detail-link')).toHaveAttribute(
      'href',
      `/opportunities/${encodeURIComponent(apjeong.oppId)}`,
    );
  });

  it('확인할 것이 있으면 검토사항 줄이 주의 글자색이고, 없으면("없음 — …") 보통 글자색이다', () => {
    const first = renderRow(full);
    expect(within(first.cells[1]).getByTitle('확인할 것: 소재')).toHaveStyle({
      color: listTheme.checkFg,
    });
    document.body.innerHTML = '';
    const second = renderRow({ ...full, checkPoints: [], checkKinds: [] });
    expect(within(second.cells[1]).getByTitle(apjeong.blocker.text)).toHaveStyle({
      color: listTheme.bodyFg,
    });
  });

  it('점수 전 회사는 점수 자리에 "점수 전 · 조사 중", 추천 이유 칸에 고른 이유 글이 보인다', () => {
    const { cells } = renderRow({
      ...full,
      bucket: 'NOT_RESEARCHED',
      scoreState: 'NONE',
      scoreDisplay: '--',
      pickReason: '앵커 볼트를 생산하고 원자재가 강재',
      researchState: 'RUNNING',
    });
    expect(within(cells[2]).getByTestId('card-score')).toHaveTextContent(/^점수 전 · 조사 중$/);
    expect(within(cells[1]).getByTestId('card-pick-reason')).toHaveTextContent(
      '앵커 볼트를 생산하고 원자재가 강재',
    );
    // #987: "고른 이유"라는 줄 이름은 없어졌다. 글은 이름표 "추천 이유" 아래에 놓인다.
    expect(within(cells[1]).queryByText('고른 이유')).not.toBeInTheDocument();
    const label = within(cells[1]).getByText('추천 이유');
    expect(label.parentElement).toContainElement(within(cells[1]).getByTestId('card-pick-reason'));
  });

  it('주소가 없는 회사는 "지역 미확인", 지역·산업 칸이 없는 옛 응답은 그 줄이 아예 없다', () => {
    const first = renderRow({ ...full, region: null, distanceKm: null });
    const region = within(first.cells[0]).getByTestId('card-region');
    expect(region).toHaveTextContent(/^지역 미확인$/);
    // 이름표 "지역"은 data-label로 붙고(화면 글자 아님) 그 옆 글은 "지역 미확인"뿐이다.
    expect(region.parentElement).toHaveClass('cand-row__fact');
    expect(region.parentElement).toHaveAttribute('data-label', '지역');
    expect(region.parentElement?.textContent).toBe('지역 미확인');
    expect(within(first.row).queryByTestId('card-distance-tag')).not.toBeInTheDocument();
    document.body.innerHTML = '';
    const second = renderRow({});
    expect(second.cells).toHaveLength(3);
    expect(within(second.row).queryByTestId('card-region')).not.toBeInTheDocument();
    expect(within(second.row).queryByTestId('card-distance-tag')).not.toBeInTheDocument();
    expect(within(second.row).queryByTestId('card-industry-tag')).not.toBeInTheDocument();
    // 지역·산업 이름표 줄도 그리지 않는다(값을 지어내지 않는다). 남는 이름표 줄은 품목 하나다.
    expect(factsOf(second.cells[0])).toEqual([['품목', '밸브 바디 아노다이징']]);
  });

  describe('의견 전 알림 (#981)', () => {
    // 알림의 기준은 영업 홈 "의견 전" 칸과 같다: 관심이 켜져 있고 + 의견이 없고 + 영업 단계가 아직 없거나 미접촉.
    type Records = CardData['records'];
    const stageOf = (status: string): Records['outcome'] =>
      ({
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-20T01:00:00Z',
        status,
      }) as Records['outcome'];
    /** 관심을 켜고 의견은 없고 영업 단계도 없는 줄(알림이 뜨는 기본 모양). 조건 하나씩만 바꿔 가며 본다. */
    const waiting = (changes: Partial<Records> = {}): Partial<CardData> => ({
      ...full,
      records: { opinion: null, bookmark: bookmarkOn, outcome: null, ...changes },
    });

    it('Given 관심이 켜져 있고 의견도 영업 단계도 없음 When 거래처 후보 줄 Then 고르기 칸이 띄워지고 "의견을 골라 주세요"가 보인다', () => {
      const { cells } = renderRow(waiting());
      const nudge = within(cells[2]).getByTestId('opinion-nudge');
      expect(nudge).toHaveTextContent(/^의견을 골라 주세요$/);
      const select = within(cells[2]).getByTestId('opinion-select');
      expect(select).toHaveAttribute('data-nudge', 'true');
      // 고르기 칸이 알림 글을 설명으로 읽는다(색만으로 알리지 않는다).
      expect(select).toHaveAttribute('aria-describedby', nudge.id);
      expect(select).toHaveStyle({ background: opinionNudge.bg });
    });

    it('Given 관심이 켜져 있고 의견이 없고 영업 단계가 미접촉 When 줄 Then 알림이 보인다(단계 꼬리표는 없다)', () => {
      const { row } = renderRow(waiting({ outcome: stageOf('NOT_EXECUTED') }));
      expect(within(row).getByTestId('opinion-nudge')).toHaveTextContent(/^의견을 골라 주세요$/);
      expect(within(row).getByTestId('opinion-select')).toHaveAttribute('data-nudge', 'true');
      expect(within(row).queryByTestId('card-stage-tag')).not.toBeInTheDocument();
    });

    it.each([
      ['접촉', 'IN_PROGRESS'],
      ['견적·샘플', 'SAMPLE_OR_REGISTRATION_APPROVED'],
      ['보류', 'ON_HOLD'],
      ['성사', 'WON'],
      ['거절', 'LOST'],
    ])(
      'Given 관심이 켜져 있고 의견이 없지만 영업 단계가 이미 "%s" When 줄 Then 알리지 않는다(영업 홈 "의견 전"에도 세지 않는 회사)',
      (label, status) => {
        const { row } = renderRow(waiting({ outcome: stageOf(status) }));
        // 단계가 정말 그 값으로 그려졌는지 먼저 본다(꼬리표), 그다음 알림이 없는지 본다.
        expect(within(row).getByTestId('card-stage-tag')).toHaveTextContent(label);
        expect(within(row).queryByTestId('opinion-nudge')).not.toBeInTheDocument();
        const select = within(row).getByTestId('opinion-select');
        expect(select).toHaveValue('');
        expect(select).not.toHaveAttribute('data-nudge');
        expect(select).not.toHaveAttribute('aria-describedby');
      },
    );

    it('Given 관심이 켜져 있고 영업 단계는 없지만 의견이 이미 있음 When 줄 Then 알림이 없다', () => {
      const { row } = renderRow(
        waiting({
          opinion: {
            version: 1,
            updatedBy: 'park-lee',
            updatedAt: '2026-11-06T01:00:00Z',
            opinion: 'NEED_CHECK',
          },
        }),
      );
      expect(within(row).queryByTestId('opinion-nudge')).not.toBeInTheDocument();
      expect(within(row).getByTestId('opinion-select')).not.toHaveAttribute('data-nudge');
      expect(within(row).getByTestId('opinion-select')).toHaveValue('NEED_CHECK');
    });

    it.each([
      ['관심 기록이 없음', null],
      ['관심을 껐음', { ...bookmarkOn, active: false }],
    ])('Given %s When 줄 Then 의견도 영업 단계도 없어도 알림이 없다', (_name, bookmark) => {
      const { row } = renderRow(waiting({ bookmark }));
      expect(within(row).queryByTestId('opinion-nudge')).not.toBeInTheDocument();
      expect(within(row).getByTestId('opinion-select')).not.toHaveAttribute('data-nudge');
    });

    it('Given 관심이 켜져 있고 의견도 영업 단계도 없음 When 관심 기업 줄 Then 같은 알림이 보이고, 단계가 접촉이면 관심 기업 줄에서도 알리지 않는다', () => {
      const first = renderRow(waiting(), true, 'bookmark');
      expect(within(first.cells[2]).getByTestId('opinion-nudge')).toHaveTextContent(
        /^의견을 골라 주세요$/,
      );
      document.body.innerHTML = '';
      const second = renderRow(waiting({ outcome: stageOf('IN_PROGRESS') }), true, 'bookmark');
      expect(within(second.row).getByTestId('card-stage-tag')).toHaveTextContent('접촉');
      expect(within(second.row).queryByTestId('opinion-nudge')).not.toBeInTheDocument();
    });

    it('Given 담당자를 고르기 전 When 알림이 뜰 줄(관심 켜짐 · 의견 없음 · 단계 없음) Then 알림 대신 "먼저 담당자를 고르세요"만 보인다', () => {
      const { row } = renderRow(waiting(), false);
      expect(within(row).queryByTestId('opinion-nudge')).not.toBeInTheDocument();
      expect(within(row).getByTestId('opinion-pick-staff-text')).toBeInTheDocument();
    });
  });

  it('관심 단추는 별 그림이고 이름은 "관심"/"관심 기업" 그대로다', () => {
    const first = renderRow(full);
    const off = within(first.row).getByRole('button', { name: '관심', pressed: false });
    expect(off).toHaveAttribute('data-variant', 'star');
    expect(off.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(off).toHaveStyle({ background: listTheme.starOff.bg });
    document.body.innerHTML = '';
    const second = renderRow({ ...full, records: { ...full.records, bookmark: bookmarkOn } });
    const on = within(second.row).getByRole('button', { name: '관심 기업', pressed: true });
    expect(on).toHaveStyle({ background: listTheme.starOn.bg, color: listTheme.starOn.fg });
  });

  it('담당자를 고르기 전에는 의견 칸과 별이 잠기고, 안내는 의견 칸 아래 한 줄과 별의 손 올림 글로 보인다', () => {
    const { row } = renderRow(full, false);
    expect(within(row).getByTestId('opinion-select')).toBeDisabled();
    expect(within(row).getByTestId('opinion-pick-staff-text')).toBeInTheDocument();
    const star = within(row).getByTestId('bookmark-button');
    expect(star).toBeDisabled();
    expect(star).toHaveAttribute('title', '담당자를 고르면 관심으로 담을 수 있습니다');
  });
});

describe('OpportunityCard 관심 기업 줄 (#972)', () => {
  beforeEach(() => {
    // 오늘을 2026-11-27(한국 시각)로 고정한다. 지난 일정인지는 한국 날짜로 가른다.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T03:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 영업 단계 기록에 다음 일정을 붙인다(가짜 값 — 지금 서버 목록 응답은 단계만 싣는다). */
  const withSchedule = (at: string | null, note?: string): Partial<CardData> => ({
    ...full,
    records: {
      ...full.records,
      outcome: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-20T01:00:00Z',
        status: 'IN_PROGRESS',
        nextScheduleAt: at,
        nextScheduleNote: note ?? null,
      },
    },
  });

  it('줄은 세 칸이다: 회사·품목·꼬리표 | 추천 이유 / 검토사항 | 큰 점수 · 의견 · [자세히 보기]', () => {
    const { row, cells } = renderRow({ ...full, scoreState: 'CONFIRMED' }, true, 'bookmark');
    expect(row).toHaveAttribute('data-layout', 'bookmark');
    expect(row).toHaveClass('cand-row', 'cand-row--three');
    expect(cells).toHaveLength(3);
    const [company, reason, side] = cells;

    // 1칸: 회사 이름(상세 링크) · 품목 · 산업 · 꼬리표들(적합도도, 거리도 꼬리표로). 번호는 관심 기업 보기에 없다.
    expect(within(company).queryByTestId('card-rank')).not.toBeInTheDocument();
    expect(within(company).getByTestId('card-title')).toHaveTextContent(apjeong.title);
    expect(within(company).getByTestId('card-title-link').textContent).toBe('A정밀');
    expect(within(company).getByTestId('card-title-item').textContent).toBe('밸브 바디 아노다이징');
    expect(
      within(company)
        .getAllByTestId('card-industry-tag')
        .map((tag) => tag.textContent),
    ).toEqual(['자동차 부품', '방위산업']);
    for (const testId of [
      'card-classification',
      'card-fit-level',
      'card-process-tag',
      'card-virtual-tag',
      'card-brochure-tag',
      'card-stage-tag',
      'card-reevaluated-tag',
      'card-own-plating-tag',
      'card-supply-tier-tag',
      'card-ingested-tag',
    ]) {
      expect(within(company).getByTestId(testId)).toBeInTheDocument();
    }
    // 관심 기업 줄은 지역 줄이 없어 거리를 꼬리표로 보인다. 적합도도 점수 옆이 아니라 꼬리표 묶음 안이다.
    const distance = within(company).getByTestId('card-distance-tag');
    expect(distance).toHaveTextContent('거산에서 8.2km');
    expect(distance).toHaveAttribute('data-tone', 'neutral');
    expect(within(company).queryByTestId('card-region')).not.toBeInTheDocument();

    // 2칸: 이름표가 글 위에 보이고(숨기지 않는다) 추천 이유 · 검토사항 · 그 밖의 줄이 그대로 있다.
    // #987: 이름표 말이 "추천 근거"에서 "추천 이유"로 바뀌었다.
    expect(within(reason).queryByText('추천 근거')).not.toBeInTheDocument();
    const reasonLabel = within(reason).getByText('추천 이유');
    const blockerLabel = within(reason).getByText('검토사항');
    expect(reasonLabel).not.toHaveClass('cand-row__label');
    expect(blockerLabel).not.toHaveClass('cand-row__label');
    expect(within(reason).getByTestId('card-reason')).toHaveTextContent(apjeong.reason);
    expect(within(reason).getByTestId('card-blocker')).toHaveTextContent(/^확인할 것: 소재$/);
    expect(within(reason).getByTestId('card-rank-adjust')).toBeInTheDocument();
    expect(within(reason).getByTestId('card-own-plating-basis')).toBeInTheDocument();

    // 3칸: "참고 63"의 숫자가 크게, 글자는 서버가 준 그대로("· 5/8"까지 보인다). 의견 고르기 · 관심 별 · [자세히 보기](주 단추).
    expect(within(side).queryByTestId('card-fit-level')).not.toBeInTheDocument();
    const score = within(side).getByTestId('card-score');
    expect(score).toHaveTextContent(/^참고 63점 · 5\/8$/);
    expect(score).toHaveAttribute('aria-label', '참고 점수 63점, 8개 항목 중 5개 조사');
    expect(within(score).getByText('63')).toHaveStyle({
      fontSize: `${listTheme.scoreSizeLarge}px`,
      fontWeight: 700,
    });
    expect(within(side).getByTestId('card-score-existing-tag')).toBeInTheDocument();
    expect(within(side).getByTestId('opinion-select')).toBeInTheDocument();
    expect(within(side).getByRole('button', { name: '관심', pressed: false })).toHaveAttribute(
      'data-variant',
      'star',
    );
    const detail = within(side).getByTestId('card-view-detail-link');
    expect(detail).toHaveAttribute('href', `/opportunities/${encodeURIComponent(apjeong.oppId)}`);
    expect(detail).toHaveClass('ant-btn-primary');
  });

  it('다음 일정이 오늘이거나 뒤면 "다음 일정 12/1 · 전화"로 보인다', () => {
    const { cells } = renderRow(withSchedule('2026-12-01', '전화'), true, 'bookmark');
    const line = within(cells[2]).getByTestId('card-next-schedule');
    expect(line).toHaveTextContent(/^다음 일정 12\/1 · 전화$/);
    expect(line).not.toHaveAttribute('data-overdue');
    expect(line).not.toHaveStyle({ fontWeight: 600 });
  });

  it('오늘 일정은 지난 일정이 아니고, 할 일 글이 없으면 날짜만 보인다', () => {
    const { cells } = renderRow(withSchedule('2026-11-27'), true, 'bookmark');
    const line = within(cells[2]).getByTestId('card-next-schedule');
    expect(line).toHaveTextContent(/^다음 일정 11\/27$/);
    expect(line).not.toHaveAttribute('data-overdue');
  });

  it('지난 일정은 "지난 일정 11/10"으로 주의색 굵게 보인다', () => {
    const { cells } = renderRow(withSchedule('2026-11-10', '견적'), true, 'bookmark');
    const line = within(cells[2]).getByTestId('card-next-schedule');
    expect(line).toHaveTextContent(/^지난 일정 11\/10$/);
    expect(line).toHaveAttribute('data-overdue', 'true');
    expect(line).toHaveStyle({ color: listTheme.overdueFg, fontWeight: 600 });
  });

  describe('접촉 요약과 다음 일정 칸 (#976)', () => {
    it('Given 방법별 접촉 수와 마지막 접촉 날짜 When 관심 기업 줄 Then "접촉 2회 (전화 1 · 메일 1) · 마지막 접촉 11/25"와 다음 일정이 연보라 칸에 보인다', () => {
      const { cells } = renderRow(
        {
          ...withSchedule('2026-12-01', '전화'),
          contactByMethod: { call: 1, email: 1, visit: 0 },
          lastContactAt: '2026-11-25',
        },
        true,
        'bookmark',
      );
      const box = within(cells[2]).getByRole('group', { name: listTable.contactBoxLabel });
      expect(box).toHaveAttribute('data-testid', 'card-contact-box');
      expect(box).toHaveStyle({ background: accent.soft });
      expect(within(box).getByTestId('card-contact-summary')).toHaveTextContent(
        /^접촉 2회 \(전화 1 · 메일 1\) · 마지막 접촉 11\/25$/,
      );
      expect(within(box).getByTestId('card-next-schedule')).toHaveTextContent(
        /^다음 일정 12\/1 · 전화$/,
      );
      // 큰 점수 아래, 의견 고르기 위에 놓인다.
      const order = [
        within(cells[2]).getByTestId('card-score-big'),
        box,
        within(cells[2]).getByTestId('opinion-select'),
      ];
      for (let i = 1; i < order.length; i += 1) {
        expect(
          order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });

    it('방문만 있으면 그 방법만 적고, 지난 일정은 칸 안에서도 주의색 굵게 보인다', () => {
      const { cells } = renderRow(
        {
          ...withSchedule('2026-11-10', '견적'),
          contactByMethod: { call: 0, email: 0, visit: 1 },
          lastContactAt: '2026-11-10',
        },
        true,
        'bookmark',
      );
      expect(within(cells[2]).getByTestId('card-contact-summary')).toHaveTextContent(
        /^접촉 1회 \(방문 1\) · 마지막 접촉 11\/10$/,
      );
      const line = within(cells[2]).getByTestId('card-next-schedule');
      expect(line).toHaveTextContent(/^지난 일정 11\/10$/);
      expect(line).toHaveAttribute('data-overdue', 'true');
      expect(line).toHaveStyle({ color: listTheme.overdueFg, fontWeight: 600 });
    });

    it('접촉도 일정도 없으면 "접촉 기록 없음"과 "다음 일정 없음"을 적는다(서버가 0과 없음을 알려 준 것)', () => {
      const { cells } = renderRow(
        {
          ...full,
          records: { opinion: null, bookmark: null, outcome: null },
          contactByMethod: { call: 0, email: 0, visit: 0 },
          lastContactAt: null,
        },
        true,
        'bookmark',
      );
      expect(within(cells[2]).getByTestId('card-contact-summary')).toHaveTextContent(
        /^접촉 기록 없음$/,
      );
      const line = within(cells[2]).getByTestId('card-next-schedule');
      expect(line).toHaveTextContent(/^다음 일정 없음$/);
      expect(line).not.toHaveAttribute('data-overdue');
    });

    it('표 줄(거래처 후보)에는 접촉 요약 칸을 그리지 않는다', () => {
      const { row } = renderRow(
        { ...full, contactByMethod: { call: 1, email: 0, visit: 0 }, lastContactAt: '2026-11-25' },
        true,
        'table',
      );
      expect(within(row).queryByTestId('card-contact-box')).not.toBeInTheDocument();
      expect(row).not.toHaveTextContent('마지막 접촉');
    });
  });

  it('응답에 다음 일정이 없으면(지금 서버 목록 응답) 일정 줄을 그리지 않고 지어내지 않는다', () => {
    const first = renderRow(full, true, 'bookmark');
    expect(within(first.row).queryByTestId('card-next-schedule')).not.toBeInTheDocument();
    expect(first.row).not.toHaveTextContent('다음 일정');
    // 접촉 요약(접촉 횟수 · 마지막 접촉)은 목록 응답에 없어 만들지 않는다(단계 꼬리표 "접촉"만 있다).
    expect(first.row).not.toHaveTextContent('마지막 접촉');
    expect(first.row).not.toHaveTextContent(/접촉 \d+회/);
    document.body.innerHTML = '';
    const second = renderRow(withSchedule(null), true, 'bookmark');
    expect(within(second.row).queryByTestId('card-next-schedule')).not.toBeInTheDocument();
  });

  it('점수 전 회사는 오른쪽에 "점수 전"이 보이고, 끝난 회사처럼 점수가 없는 줄은 점수 자리를 비운다', () => {
    const first = renderRow(
      { ...full, scoreState: 'NONE', scoreDisplay: '--', pickReason: '강재 볼트 생산' },
      true,
      'bookmark',
    );
    expect(within(first.cells[2]).getByTestId('card-score')).toHaveTextContent(/^점수 전$/);
    expect(within(first.cells[1]).getByTestId('card-pick-reason')).toHaveTextContent(
      '강재 볼트 생산',
    );
    document.body.innerHTML = '';
    const second = renderRow({ ...full, bucket: 'CLOSED' }, true, 'bookmark');
    expect(within(second.row).queryByTestId('card-score')).not.toBeInTheDocument();
    expect(within(second.row).queryByTestId('card-score-big')).not.toBeInTheDocument();
  });
});
