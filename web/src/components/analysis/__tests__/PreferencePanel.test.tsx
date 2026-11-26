// #943 되먹임 ③: 영업 분석 맨 위 "담당자 선호 제안". 서버 창구만 가짜다(실제 연결 확인 아님). 자료는 가상.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreferencePanel from '../PreferencePanel';
import { FrameContext } from '../../frame/FrameContext';
import type { Preferences } from '../../../api/preferences';
import { ApiError } from '../../../api/client';

const api = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  approvePreference: vi.fn(),
  revokePreference: vi.fn(),
}));
vi.mock('../../../api/preferences', () => api);

const BASIS = {
  windowDays: 180,
  minPicks: 10,
  minShare: 0.5,
  distanceKm: 50,
  minClosedForRate: 3,
  approvalDays: 90,
  pickedCount: 14,
};

const SUGGESTION = {
  kind: 'PROCESS_INDUSTRY' as const,
  processCode: 'ZINC',
  processName: '아연도금',
  industry: '자동차 부품',
  distanceKm: null,
  pickedCount: 9,
  excludedCount: 1,
  share: 8 / 14,
  closedCount: 4,
  wonCount: 2,
  otherClosedCount: 5,
  otherWonCount: 1,
};

const ACTIVE = {
  kind: 'DISTANCE' as const,
  processCode: null,
  processName: null,
  industry: null,
  distanceKm: 50,
  prefId: 'pref-1',
  approvedBy: 'choi-pm',
  approvedAt: '2026-11-26T01:00:00Z',
  expiresAt: '2027-02-24T01:00:00Z',
};

function envelope(data: Preferences) {
  return { data, meta: {} };
}

function renderPanel(staffKey = 'choi-pm') {
  return render(
    <FrameContext.Provider
      value={{
        config: null,
        staffKey,
        setStaffKey: () => {},
        canRecord: true,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <PreferencePanel />
    </FrameContext.Provider>,
  );
}

beforeEach(() => {
  api.getPreferences.mockReset();
  api.approvePreference.mockReset();
  api.revokePreference.mockReset();
});

it('설정이 꺼져 있거나 읽지 못하면 칸을 그리지 않는다', async () => {
  api.getPreferences.mockResolvedValueOnce(
    envelope({ enabled: false, canApprove: false, basis: null, suggestions: [], active: [] }),
  );
  const { container } = renderPanel();
  await waitFor(() => expect(api.getPreferences).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it('관리자에게는 제안과 숫자·[승인]이 보이고, 누르면 그 조합을 승인하고 다시 읽는다', async () => {
  api.getPreferences
    .mockResolvedValueOnce(
      envelope({
        enabled: true,
        canApprove: true,
        basis: BASIS,
        suggestions: [SUGGESTION],
        active: [ACTIVE],
      }),
    )
    .mockResolvedValueOnce(
      envelope({
        enabled: true,
        canApprove: true,
        basis: BASIS,
        suggestions: [],
        active: [ACTIVE],
      }),
    );
  api.approvePreference.mockResolvedValueOnce(envelope({} as Preferences));
  renderPanel();
  const row = await screen.findByTestId('preference-suggestion');
  expect(row).toHaveTextContent('아연도금 × 자동차 부품');
  expect(row).toHaveTextContent('고른 14곳 가운데 9곳 (제외 1곳은 빼서 셈)');
  expect(row).toHaveTextContent('성사 2/4 · 다른 곳 1/5');
  expect(screen.getByText(/최근 180일 동안 관심을 켜거나 연락한 회사 14곳/)).toBeInTheDocument();
  expect(screen.getByText(/승인은 90일 뒤 저절로 꺼짐/)).toBeInTheDocument();
  expect(screen.getByTestId('preference-active')).toHaveTextContent(
    '거산에서 50km 안11/26 승인 · 2/24까지',
  );
  await userEvent.click(screen.getByRole('button', { name: '승인' }));
  expect(api.approvePreference).toHaveBeenCalledWith(SUGGESTION, 'choi-pm');
  expect(await screen.findByTestId('preference-none')).toHaveTextContent(
    '성사·거절이 아직 각 3곳이 안 되거나',
  );
});

it('관리자가 아니면 [승인]·[끄기] 대신 안내만 보인다', async () => {
  api.getPreferences.mockResolvedValueOnce(
    envelope({
      enabled: true,
      canApprove: false,
      basis: BASIS,
      suggestions: [SUGGESTION],
      active: [ACTIVE],
    }),
  );
  renderPanel('park-lee');
  await screen.findByTestId('preference-suggestion');
  expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '끄기' })).not.toBeInTheDocument();
  expect(screen.getByTestId('preference-approve-hint')).toHaveTextContent('관리자만');
});

it('[끄기]가 실패하면 서버 안내를 보이고 줄은 그대로 남는다', async () => {
  api.getPreferences.mockResolvedValueOnce(
    envelope({ enabled: true, canApprove: true, basis: BASIS, suggestions: [], active: [ACTIVE] }),
  );
  api.revokePreference.mockRejectedValueOnce(
    new ApiError(409, {
      message: '이미 꺼진 선호입니다.',
      nextAction: '화면을 새로 고쳐 주세요.',
    } as ApiError['body']),
  );
  renderPanel();
  await userEvent.click(await screen.findByRole('button', { name: '끄기' }));
  expect(api.revokePreference).toHaveBeenCalledWith('pref-1', 'choi-pm');
  expect(await screen.findByTestId('preference-failed')).toHaveTextContent(
    '이미 꺼진 선호입니다. 화면을 새로 고쳐 주세요.',
  );
  expect(screen.getByTestId('preference-active')).toBeInTheDocument();
});

it('고른 회사가 기준보다 적으면 몇 곳 더 필요한지 알린다', async () => {
  api.getPreferences.mockResolvedValueOnce(
    envelope({
      enabled: true,
      canApprove: true,
      basis: { ...BASIS, pickedCount: 6 },
      suggestions: [],
      active: [],
    }),
  );
  renderPanel();
  expect(await screen.findByTestId('preference-none')).toHaveTextContent(
    '고른 회사 6곳 · 10곳 이상 쌓이면 봅니다.',
  );
});
