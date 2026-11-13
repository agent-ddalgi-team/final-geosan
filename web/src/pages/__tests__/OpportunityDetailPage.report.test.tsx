// 근거 상세의 [보고서] 링크(#565): 새 창으로 열리고, 그 주소에서 인쇄용 보고서 화면이 그려진다.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  getActivity,
  getConfigUi,
  getOpportunityDetail,
  getPeers,
  getSalesQuestions,
} from '../../api/client';
import type { ConfigUi, OpportunityDetail } from '../../api/types';
import { companyReport } from '../../labels/ko';
import AppRoutes from '../../router';
import configFixture from '../../test/fixtures/config-ui.json';
import detailFixture from '../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfigUi: vi.fn(),
  getOpportunityDetail: vi.fn(),
  getSalesQuestions: vi.fn(),
  getActivity: vi.fn(),
  getPeers: vi.fn(),
}));

describe('OpportunityDetailPage [보고서] 링크', () => {
  it('Given 근거 상세 When [보고서] 링크의 주소를 열면 Then 그 회사의 보고서 화면이 보인다', async () => {
    vi.mocked(getConfigUi).mockResolvedValue({
      data: configFixture.data as unknown as ConfigUi,
      meta: {},
    });
    vi.mocked(getOpportunityDetail).mockResolvedValue({
      data: detailFixture.data as unknown as OpportunityDetail,
      meta: { hasVirtualData: true },
    });
    vi.mocked(getSalesQuestions).mockResolvedValue({
      data: { version: 1, steps: [], questions: [] },
      meta: {},
    });
    vi.mocked(getActivity).mockResolvedValue({ data: [], meta: {} });
    vi.mocked(getPeers).mockResolvedValue({
      data: {
        summary: {
          processCount: 0,
          industryCount: 0,
          stageCounts: {},
          topLostReasons: [],
          contactReach: {},
        },
        companies: [],
      },
      meta: {},
    });

    render(
      <MemoryRouter initialEntries={['/opportunities/opp-1']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    const link = await screen.findByTestId('detail-report-link');
    expect(link).toHaveTextContent(companyReport.link);
    expect(link).toHaveAttribute('href', '/opportunities/opp-1/report');
    // 새 창으로 열어 상세에 쓰던 글이 사라지지 않게 한다.
    expect(link).toHaveAttribute('target', '_blank');
    const href = link.getAttribute('href') ?? '';
    cleanup();

    // 새 창이 여는 주소를 그대로 연다.
    render(
      <MemoryRouter initialEntries={[href]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('company-report')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A정밀');
    // 보고서 화면에는 메뉴가 있는 공통 틀이 없다.
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
    expect(vi.mocked(getOpportunityDetail)).toHaveBeenLastCalledWith(
      'opp-1',
      expect.any(AbortSignal),
    );
  });
});
