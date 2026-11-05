// 기업 요약(#210): 조사일·오래됨·사례 파일 기준 / 거리 / 대표번호(링크·출처·확인 전·[맞음]) / 한 줄·특징 AI 제안 /
// 홈페이지 상태 띠. 서버 호출(postMainPhoneConfirm)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanySummary, { HomepageBand } from '../CompanySummary';
import { ApiError, postMainPhoneConfirm } from '../../../api/client';
import type { DetailHeader } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { companySummary } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postMainPhoneConfirm: vi.fn(),
}));

const mockedConfirm = vi.mocked(postMainPhoneConfirm);
const NOW = new Date('2026-11-05T03:00:00Z'); // 한국 시각 11/5 12:00
const baseHeader = detailFixture.data.header as unknown as DetailHeader;

function frameValue(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config: {
      records: { approvalEnabled: false, noteMaxLength: 200 },
      staff: [{ key: 'park-lee', displayName: '영업 담당' }],
      brand: { logoUrl: null, brandName: '', colorPrimary: '', demoLabel: null },
      classificationLabels: {},
      activeDatasetKind: 'VIRTUAL_REVIEWED',
      accessProtectionEnabled: false,
      ruleVersion: 'v',
    },
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...overrides,
  };
}

function renderSummary(
  header: Partial<DetailHeader> = {},
  value: FrameValue = frameValue(),
  onReload: () => void = () => {},
) {
  return render(
    <FrameContext.Provider value={value}>
      <CompanySummary
        oppId="opp-1"
        header={{ ...baseHeader, ...header }}
        onReload={onReload}
        now={NOW}
      />
    </FrameContext.Provider>,
  );
}

function apiError(status: number, message: string) {
  return new ApiError(status, { message, nextAction: '다시 시도', ref: 'x' });
}

describe('CompanySummary', () => {
  beforeEach(() => {
    mockedConfirm.mockReset();
  });

  it('조사일은 "조사 11/2 (3일 전)", AI 조사면 한 줄·특징에 "AI 제안"이 붙는다', () => {
    renderSummary();
    expect(screen.getByTestId('company-research')).toHaveTextContent('조사 11/2 (3일 전)');
    expect(screen.getByTestId('company-summary-line')).toHaveTextContent(
      '한 줄: 알루미늄 주물 표면처리 전문 가상 기업',
    );
    expect(screen.getByTestId('company-summary-line')).toHaveTextContent(
      companySummary.aiSuggestion,
    );
    const highlights = screen.getByTestId('company-highlights');
    expect(highlights).toHaveTextContent('아노다이징 외주 협력사 모집');
    expect(highlights).toHaveTextContent('알루미늄 주물 중심');
    expect(highlights).toHaveTextContent(companySummary.aiSuggestion);
    expect(screen.queryByTestId('company-stale-tag')).not.toBeInTheDocument();
  });

  it('조사가 오래됐으면 "오래됨" 꼬리표가 붙고, 오늘 조사했으면 "오늘"이라 쓴다', () => {
    renderSummary({ researchStale: true, researchedAt: '2026-11-05T01:00:00+09:00' });
    expect(screen.getByTestId('company-stale-tag')).toHaveTextContent(companySummary.stale);
    expect(screen.getByTestId('company-research')).toHaveTextContent('조사 11/5 (오늘)');
  });

  it('사례 파일로만 만든 요약은 "사례 파일 기준"으로 보이고 "AI 제안"은 붙지 않는다', () => {
    renderSummary({ researchSource: 'CASE_FILE', researchedAt: '2026-10-27T09:00:00+09:00' });
    expect(screen.getByTestId('company-research')).toHaveTextContent('사례 파일 기준 · 10/27');
    expect(screen.getByTestId('company-summary-line')).not.toHaveTextContent(
      companySummary.aiSuggestion,
    );
  });

  it('거리는 값이 있을 때만 "거산에서 12.3km"로 보이고 null이면 숨는다', () => {
    const { unmount } = renderSummary({ distanceKm: 12.3 });
    expect(screen.getByTestId('company-distance')).toHaveTextContent('거산에서 12.3km');
    unmount();
    renderSummary({ distanceKm: null });
    expect(screen.queryByTestId('company-distance')).not.toBeInTheDocument();
  });

  it('대표번호는 전화 링크·출처 링크·"담당자 확인 전"과 [맞음]으로 보인다', () => {
    renderSummary();
    expect(screen.getByTestId('company-phone-link')).toHaveAttribute('href', 'tel:0410000000');
    expect(screen.getByTestId('company-phone-link')).toHaveTextContent('041-000-0000');
    expect(screen.getByTestId('company-phone-source')).toHaveAttribute(
      'href',
      'https://example.invalid/apjeong',
    );
    expect(screen.getByTestId('company-phone-status')).toHaveTextContent(
      companySummary.phoneUnconfirmed,
    );
    expect(screen.getByTestId('company-phone-confirm-button')).toBeEnabled();
  });

  it('출처가 공장현황 자료면 링크 없이 글자로 보이고, 위험한 출처 주소는 링크로 만들지 않는다', () => {
    const { unmount } = renderSummary({ mainPhoneSource: 'CSV', mainPhoneSourceUrl: null });
    expect(screen.getByTestId('company-phone-source')).toHaveTextContent(
      `${companySummary.phoneSource}: ${companySummary.phoneSourceCsv}`,
    );
    expect(screen.getByTestId('company-phone-source').tagName).toBe('SPAN');
    unmount();
    renderSummary({ mainPhoneSource: 'HOMEPAGE', mainPhoneSourceUrl: 'javascript:alert(1)' });
    expect(screen.queryByTestId('company-phone-source')).not.toBeInTheDocument();
  });

  it('이미 확인한 번호는 "담당자 확인 11/4 영업 담당"으로 보이고 [맞음]은 없다', () => {
    renderSummary({
      mainPhoneConfirmedAt: '2026-11-04T01:00:00Z',
      mainPhoneConfirmedBy: 'park-lee',
    });
    expect(screen.getByTestId('company-phone-status')).toHaveTextContent(
      '담당자 확인 11/4 영업 담당',
    );
    expect(screen.queryByTestId('company-phone-confirm-button')).not.toBeInTheDocument();
  });

  it('[맞음]을 누르면 지금 보이는 번호를 보내고 "담당자 확인"으로 바뀐다', async () => {
    const user = userEvent.setup();
    mockedConfirm.mockResolvedValueOnce({
      data: {
        mainPhone: '041-000-0000',
        mainPhoneConfirmedAt: '2026-11-05T02:00:00Z',
        mainPhoneConfirmedBy: 'park-lee',
      },
      meta: {},
    });
    renderSummary();
    await user.click(screen.getByTestId('company-phone-confirm-button'));
    expect(mockedConfirm).toHaveBeenCalledWith(
      'opp-1',
      { expectedPhone: '041-000-0000' },
      'park-lee',
    );
    await waitFor(() =>
      expect(screen.getByTestId('company-phone-status')).toHaveTextContent(
        '담당자 확인 11/5 영업 담당',
      ),
    );
    expect(screen.queryByTestId('company-phone-confirm-button')).not.toBeInTheDocument();
  });

  it.each([
    ['담당자를 고르기 전', { canRecord: false, staffKey: null }],
    ['보기 전용', { canRecord: false, staffKey: 'viewer' }],
  ])('%s에는 [맞음]이 잠겨 서버를 부르지 않는다', async (_name, frame) => {
    const user = userEvent.setup();
    renderSummary({}, frameValue(frame));
    const button = screen.getByTestId('company-phone-confirm-button');
    expect(button).toBeDisabled();
    await user.click(button);
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('company-phone-pick-staff')).toHaveTextContent(
      companySummary.pickStaffFirst,
    );
  });

  it('번호가 그 사이 바뀌었으면(409) 안내와 [새로 불러오기]가 보이고, 그 밖의 오류는 서버의 쉬운 말과 함께 보인다', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    mockedConfirm.mockRejectedValueOnce(apiError(409, '번호가 바뀌었습니다.'));
    mockedConfirm.mockRejectedValueOnce(apiError(403, '기록할 수 없는 담당자입니다.'));
    renderSummary({}, frameValue(), onReload);
    await user.click(screen.getByTestId('company-phone-confirm-button'));
    expect(await screen.findByTestId('company-phone-error')).toHaveTextContent(
      companySummary.phoneStale,
    );
    await user.click(screen.getByTestId('company-phone-reload-button'));
    expect(onReload).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('company-phone-confirm-button'));
    await waitFor(() =>
      expect(screen.getByTestId('company-phone-error')).toHaveTextContent(
        '기록할 수 없는 담당자입니다.',
      ),
    );
    expect(screen.queryByTestId('company-phone-reload-button')).not.toBeInTheDocument();
  });

  it('보여 줄 값이 하나도 없으면 아무것도 그리지 않는다', () => {
    const { container } = renderSummary({
      researchedAt: null,
      summaryLine: null,
      highlights: [],
      mainPhone: null,
      distanceKm: null,
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HomepageBand', () => {
  it.each([
    ['NEEDS_CONFIRMATION', companySummary.bandNeedsConfirmation],
    ['NOT_FOUND', companySummary.bandNotFound],
  ] as const)('%s이면 띠가 "%s"로 보인다', (status, text) => {
    render(<HomepageBand status={status} />);
    expect(screen.getByTestId('homepage-band')).toHaveTextContent(text);
  });

  it.each(['AI_FOUND', 'CONFIRMED', null, undefined] as const)('%s이면 띠가 없다', (status) => {
    const { container } = render(<HomepageBand status={status} />);
    expect(container).toBeEmptyDOMElement();
  });
});
