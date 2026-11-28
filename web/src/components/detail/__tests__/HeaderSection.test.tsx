// #996(PM 결정 2026-11-29) 기업 상세 머리: 회사 이름 크게(h1) + 품목 줄, 맨 위 줄 오른쪽 끝 "이번 달 AI 사용",
// [기록 남기기 ↓]는 넘겨줄 때만(기록 칸이 본문 아래에 있는 화면), 요약 줄 → 담당자 의견 순서.
// 서버 호출(getMonthSpend)은 가짜로 바꾼 확인이다(실제 서버 연결 확인 아님). 회사 · 품목은 가상이다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { getMonthSpend } from '../../../api/client';
import type { DetailHeader } from '../../../api/types';
import { detailCompose, recordsArea } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import { detailLayout } from '../../../theme/tokens';
import { FrameContext } from '../../frame/FrameContext';
import HeaderSection from '../HeaderSection';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getMonthSpend: vi.fn(),
}));

const mockedSpend = vi.mocked(getMonthSpend);
const base = detailFixture.data.header as unknown as DetailHeader;

function renderHeader(
  header: DetailHeader,
  options: { canRecord?: boolean; onGoRecord?: () => void } = {},
) {
  const { canRecord = true, onGoRecord } = options;
  render(
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: canRecord ? 'staff-a' : null,
          setStaffKey: () => {},
          canRecord,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <HeaderSection
          oppId="opp-1"
          onReload={() => {}}
          onGoRecord={onGoRecord}
          header={header}
          bookmark={null}
          onBookmarkChanged={() => {}}
          reportLink={<a data-testid="slot-report">보고서</a>}
          summary={<div data-testid="slot-summary">요약 줄</div>}
          opinion={<div data-testid="slot-opinion">담당자 의견</div>}
        />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedSpend.mockReset();
  mockedSpend.mockResolvedValue({
    data: { month: { usedUsd: 44.87, limitUsd: 50, usedCalls: 10, limitCalls: 3000 } },
    meta: { updatedAt: '2026-11-29T10:00:00+09:00' },
  });
});

describe('상세 머리 — 이름과 품목 (#996)', () => {
  it('Given 제목 "S화스너공업(가상) · 탄소강 육각볼트 전기아연도금" When 머리 Then 이름만 큰 h1이고 품목은 그 아래 작은 줄이다', () => {
    renderHeader({ ...base, title: 'S화스너공업(가상) · 탄소강 육각볼트 전기아연도금' });
    const name = screen.getByRole('heading', { level: 1 });
    expect(name).toHaveTextContent(/^S화스너공업\(가상\)$/);
    expect(name).toHaveStyle({ fontSize: `${detailLayout.nameSize}px`, fontWeight: '700' });
    const item = screen.getByTestId('detail-company-item');
    expect(item).toHaveTextContent(
      new RegExp(`^${detailCompose.itemLabel}탄소강 육각볼트 전기아연도금$`),
    );
    // 품목은 이름(h1) 안에 섞이지 않고, 이름 다음에 온다.
    expect(name).not.toContainElement(item);
    expect(name.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Given 품목에도 " · "가 있는 제목 When 머리 Then 첫 " · " 앞만 이름이고 나머지는 모두 품목이다', () => {
    renderHeader({ ...base, title: 'K정밀(가상) · 밸브 바디 · 하우징 도금' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^K정밀\(가상\)$/);
    expect(screen.getByTestId('detail-company-item')).toHaveTextContent('밸브 바디 · 하우징 도금');
  });

  it('Given 나눌 수 없는 제목 When 머리 Then 전체가 이름이고 품목 줄은 그리지 않는다', () => {
    renderHeader({ ...base, title: 'N산업(가상)' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^N산업\(가상\)$/);
    expect(screen.queryByTestId('detail-company-item')).not.toBeInTheDocument();
  });

  it('Given 가운뎃점만 있는 품목 이름(빈칸 없는 "·") When 머리 Then 이름을 쪼개지 않는다', () => {
    renderHeader({ ...base, title: 'A볼트·너트(가상)' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^A볼트·너트\(가상\)$/);
    expect(screen.queryByTestId('detail-company-item')).not.toBeInTheDocument();
  });

  it('Given 머리 When 꼬리표를 보면 Then 분류 · 점수 · 대응이 이름과 같은 줄 묶음에 그대로 있다', () => {
    renderHeader(base);
    const line = screen.getByTestId('detail-name-line');
    expect(within(line).getByTestId('detail-classification')).toHaveTextContent(
      '지금 바로 연락 검토',
    );
    expect(within(line).getByTestId('detail-score')).toHaveTextContent('77점 · 7/8');
    expect(within(line).getByTestId('detail-meta')).toHaveTextContent('대응');
    expect(within(line).getByTestId('detail-virtual-tag')).toBeInTheDocument();
  });
});

describe('상세 머리 — 맨 위 줄과 단추 (#996)', () => {
  it('Given 기록할 수 있는 담당자 When 머리 Then "이번 달 AI 사용 $44.87 / $50.00"이 "목록으로"와 같은 맨 위 줄 오른쪽에 한 번만 보인다', async () => {
    renderHeader(base);
    const top = screen.getByTestId('detail-top-line');
    expect(within(top).getByTestId('back-to-list-link')).toHaveTextContent('목록으로');
    const spend = await within(top).findByTestId('month-spend');
    expect(spend).toHaveTextContent('이번 달 AI 사용 $44.87 / $50.00');
    // [다시 조사] 옆에는 더 이상 없다(한 번만 보인다).
    expect(screen.getAllByTestId('month-spend')).toHaveLength(1);
    expect(
      within(screen.getByTestId('homepage-controls')).queryByTestId('month-spend'),
    ).not.toBeInTheDocument();
    expect(mockedSpend).toHaveBeenCalledTimes(1);
  });

  it('Given 담당자를 고르기 전 When 머리 Then AI 사용 글은 없고 "담당자를 고르면" 안내가 한 번 보인다', () => {
    renderHeader(base, { canRecord: false });
    expect(screen.queryByTestId('month-spend')).not.toBeInTheDocument();
    expect(mockedSpend).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('detail-pick-staff')).toHaveLength(1);
  });

  it('Given 넓은 화면(이동 단추를 넘기지 않음) When 머리 Then [기록 남기기 ↓]가 없고 [관심] · [다시 조사] · 보고서는 있다', () => {
    renderHeader(base);
    expect(screen.queryByTestId('detail-go-record-button')).not.toBeInTheDocument();
    const actions = screen.getByTestId('detail-actions');
    expect(within(actions).getByTestId('bookmark-button')).toBeInTheDocument();
    expect(within(actions).getByTestId('homepage-rerun-button')).toBeInTheDocument();
    expect(within(actions).getByTestId('slot-report')).toBeInTheDocument();
  });

  it('Given 좁은 기기(이동 단추를 넘김) When [기록 남기기 ↓]를 누르면 Then 이동만 부른다', async () => {
    const user = userEvent.setup();
    const onGoRecord = vi.fn();
    renderHeader(base, { onGoRecord });
    const button = screen.getByTestId('detail-go-record-button');
    expect(button).toHaveTextContent(recordsArea.goRecord);
    await user.click(button);
    expect(onGoRecord).toHaveBeenCalledTimes(1);
  });

  it('Given 요약 줄과 의견 칸 When 머리 Then 이름 줄 → 요약 줄 → 담당자 의견 순서로 놓인다', () => {
    renderHeader(base);
    const head = screen.getByTestId('detail-header');
    const name = within(head).getByTestId('detail-name-line');
    const summary = within(head).getByTestId('slot-summary');
    const opinion = within(head).getByTestId('slot-opinion');
    expect(name.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      summary.compareDocumentPosition(opinion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 영업 단계 칸은 머리 밖(둘째 줄)으로 나갔다.
    expect(within(head).queryByTestId('detail-stage-card')).not.toBeInTheDocument();
  });
});
