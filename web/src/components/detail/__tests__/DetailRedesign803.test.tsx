// 기업 상세 다시 짜기(#803, PM 결정 2026-11-16): 한눈에 그림 줄, 빈 전달 사항 칸 없애기, 영업 코치 판 안의 요약 줄이기,
// 머리 안내 한 번, 비슷한 회사 접기. 서버 호출 없이 가상 값으로만 본다(가상·거산 실제 사양 아님).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ConfigUi, DetailHeader, ScoreItemView, SalesStepView } from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import configFixture from '../../../test/fixtures/config-ui.json';
import { coachSteps, detailHeader, glanceVisual } from '../../../labels/ko';
import { FrameContext } from '../../frame/FrameContext';
import HandoffBox from '../../records/HandoffBox';
import { SalesStepSummary } from '../../records/SalesQuestions';
import DetailGlance from '../DetailGlance';
import HeaderSection from '../HeaderSection';

const header = {
  ...(detailFixture.data.header as unknown as DetailHeader),
  address: '충청남도 아산시 가상로 1',
  distanceKm: 8.2,
};
const config = (configFixture as unknown as { data: ConfigUi }).data;

function frame(staffKey: string | null, canRecord: boolean) {
  return {
    config,
    staffKey,
    setStaffKey: () => {},
    canRecord,
    setBannerMeta: () => {},
    setPageTitle: () => {},
  };
}

const item = (code: string, evidenceIds: string[]): ScoreItemView =>
  ({ itemCode: code, label: code, evidenceIds }) as unknown as ScoreItemView;

describe('한눈에 그림 줄', () => {
  it('Given 8항목 가운데 3항목에 근거 When 한눈에 Then "점수 근거 3/8항목" 막대와 거산─8.2km─이 회사 거리 그림이 보인다', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((code, index) =>
      item(code, index < 3 ? ['ev'] : []),
    );
    render(<DetailGlance header={header} processLinks={[]} evidence={[]} scoreItems={items} />);
    expect(screen.getByTestId('glance-evidence-bar')).toHaveTextContent(
      glanceVisual.evidenceBar(3, 8),
    );
    const line = screen.getByTestId('glance-distance-line');
    expect(line).toHaveTextContent('8.2km');
    expect(line).toHaveTextContent(glanceVisual.hq);
  });

  it('Given 산업 칸에 넣을 [고치기] 칩 When 한눈에 Then 산업 줄 안에 그 칩이 놓인다', () => {
    render(
      <DetailGlance
        header={header}
        processLinks={[]}
        evidence={[]}
        industryEditor={<span data-testid="industry-editor-slot">칩</span>}
      />,
    );
    expect(
      within(screen.getByTestId('glance-fit-industry')).getByTestId('industry-editor-slot'),
    ).toBeInTheDocument();
  });
});

describe('영업 코치 판 안의 빈 칸 없애기', () => {
  it('Given 전달 사항이 없고 담당자를 고르기 전 When 그리면 Then 빈 "전달 사항" 제목이 남지 않는다', () => {
    render(
      <FrameContext.Provider value={frame(null, false)}>
        <HandoffBox oppId="opp-1" handoffs={[]} lastActor={null} onChanged={() => {}} />
      </FrameContext.Provider>,
    );
    expect(screen.queryByTestId('handoff-box')).not.toBeInTheDocument();
  });

  it('Given 전달 사항이 없지만 담당자를 골랐다 When 그리면 Then [전달 사항 남기기]만 있고 제목은 없다', () => {
    render(
      <FrameContext.Provider value={frame('park-lee', true)}>
        <HandoffBox oppId="opp-1" handoffs={[]} lastActor={null} onChanged={() => {}} />
      </FrameContext.Provider>,
    );
    expect(screen.getByTestId('handoff-open')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-box')).not.toHaveTextContent(/^전달 사항$/);
  });

  const step: SalesStepView = {
    code: 'REACHED',
    since: '2026-11-13',
    overridden: false,
    known: [
      {
        questionId: 'PLATING_NOW',
        question: '지금 도금은 어떻게 하나요?',
        answerId: 'OUTSOURCED',
        answer: '외주 줌',
        at: '2026-11-13T10:00:00+09:00',
        by: 'park-lee',
      },
    ],
    openQuestions: ['NEED_PROCESS'],
  };

  it('Given 코치 판 안(compact) When 요약 Then 지금 세부 단계·아직 모르는 것은 없고 "지금까지 들은 답 1개"로 접힌다', () => {
    render(<SalesStepSummary step={step} status={null} questions={null} compact />);
    expect(screen.queryByTestId('sales-step-current')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sales-step-unknown')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-step-known-fold')).toHaveTextContent(coachSteps.knownFold(1));
    expect(screen.getByTestId('sales-step-known')).toHaveTextContent('외주 줌');
  });

  it('Given 코치 판 안이고 들은 답이 없다 When 요약 Then 아무것도 그리지 않는다', () => {
    render(
      <SalesStepSummary step={{ ...step, known: [] }} status={null} questions={null} compact />,
    );
    expect(screen.queryByTestId('sales-step-summary')).not.toBeInTheDocument();
  });
});

describe('머리', () => {
  it('Given 담당자를 고르기 전 When 머리 Then "담당자를 고르면" 안내는 한 번만, [보고서]·의견은 머리 안에 있다', () => {
    render(
      <MemoryRouter>
        <FrameContext.Provider value={frame(null, false)}>
          <HeaderSection
            oppId="opp-1"
            onReload={() => {}}
            header={header}
            bookmark={null}
            onBookmarkChanged={() => {}}
            reportLink={<a data-testid="slot-report">보고서</a>}
            opinion={<span data-testid="slot-opinion">의견: 영업 대상</span>}
          />
        </FrameContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('detail-pick-staff')).toHaveTextContent(detailHeader.pickStaffOnce);
    expect(screen.queryByTestId('bookmark-pick-staff-text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('homepage-pick-staff')).not.toBeInTheDocument();
    const head = screen.getByTestId('detail-header');
    expect(within(head).getByTestId('slot-report')).toBeInTheDocument();
    expect(within(head).getByTestId('slot-opinion')).toBeInTheDocument();
  });
});
