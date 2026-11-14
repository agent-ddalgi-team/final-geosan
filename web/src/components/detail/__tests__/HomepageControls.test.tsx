// 상세 우측 상단 [다시 조사](#210, #596): 본문 붙여넣기와 실패 종류별 모양. [맞음]·[고치기]는 #596에서 없앴다.
// 서버 호출(postHomepage)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomepageControls from '../HomepageControls';
import { ApiError, postHomepage } from '../../../api/client';
import type { Envelope, HomepageResponse } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { homepageControls } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postHomepage: vi.fn(),
}));

const mockedPost = vi.mocked(postHomepage);

function frameValue(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config: null,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...overrides,
  };
}

function renderControls(
  value: FrameValue = frameValue(),
  onReload: () => void = () => {},
  oppId = 'opp-1',
) {
  return render(
    <FrameContext.Provider value={value}>
      <HomepageControls oppId={oppId} onReload={onReload} />
    </FrameContext.Provider>,
  );
}

function research(): Envelope<HomepageResponse> {
  return {
    data: { evidenceCount: 3, requirementCandidateCount: 1, questionCount: 1, evalId: 'eval-2' },
    meta: { updatedAt: '2026-11-07T09:00:00+09:00' },
  };
}

function apiError(status: number, kind: string, message = '서버 안내', ref = 'ref-123') {
  return new ApiError(status, { message, nextAction: '다음 행동 안내', ref, kind });
}

describe('HomepageControls', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  describe('조사용 AI가 꺼져 있을 때 (#719, PM 결정 2026-11-14)', () => {
    const withAi = (aiEnabled: boolean | undefined) =>
      frameValue({
        config: {
          staff: [],
          brand: { brandName: '가상', demoLabel: null },
          classificationLabels: {},
          ...(aiEnabled === undefined ? {} : { research: { aiEnabled } }),
        } as unknown as FrameValue['config'],
      });

    it('서버가 꺼짐이라고 하면 [다시 조사]를 잠그고 옆에 이유를 글자로 보인다', async () => {
      const user = userEvent.setup();
      renderControls(withAi(false));
      const button = screen.getByTestId('homepage-rerun-button');
      expect(button).toBeDisabled();
      expect(screen.getByTestId('homepage-ai-off')).toHaveTextContent('AI 조사가 꺼져 있습니다');
      await user.click(button);
      expect(mockedPost).not.toHaveBeenCalled();
    });

    it('켜짐이면 지금처럼 눌리고 안내가 없다', () => {
      renderControls(withAi(true));
      expect(screen.getByTestId('homepage-rerun-button')).toBeEnabled();
      expect(screen.queryByTestId('homepage-ai-off')).not.toBeInTheDocument();
    });

    it('서버가 이 값을 안 주면(옛 응답·설정을 아직 못 읽음) 지금처럼 눌린다', () => {
      renderControls(withAi(undefined));
      expect(screen.getByTestId('homepage-rerun-button')).toBeEnabled();
      expect(screen.queryByTestId('homepage-ai-off')).not.toBeInTheDocument();
      cleanup();
      renderControls(frameValue({ config: null }));
      expect(screen.getByTestId('homepage-rerun-button')).toBeEnabled();
    });
  });

  it('[다시 조사] 하나만 보이고 [맞음]·[고치기]·주소 칸은 없다', () => {
    renderControls();
    expect(screen.getByTestId('homepage-rerun-button')).toHaveTextContent(
      homepageControls.rerunButton,
    );
    expect(screen.queryByTestId('homepage-confirm-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('homepage-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('homepage-url-input')).not.toBeInTheDocument();
  });

  it('[다시 조사]는 빈 요청을 보내고, 끝난 안내는 새로 그려진 뒤 건수와 함께 보인다', async () => {
    mockedPost.mockResolvedValueOnce(research());
    const onReload = vi.fn();
    const first = renderControls(frameValue(), onReload, 'opp-notice');
    await userEvent.click(screen.getByTestId('homepage-rerun-button'));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith('opp-notice', {}, 'park-lee');
    // 상세를 새로 불러오면 부품이 새로 그려진다.
    first.unmount();
    renderControls(frameValue(), onReload, 'opp-notice');
    expect(screen.getByTestId('homepage-notice')).toHaveTextContent(
      homepageControls.researched(3, 1, 1),
    );
    expect(homepageControls.researched(3, 1, 1)).toBe(
      '근거 3건(확인 필요 1건 포함)·질문 1건 저장, 재평가 완료',
    );
  });

  it('홈페이지를 또 못 찾으면(422 HOMEPAGE_NOT_FOUND) 서버 안내를 보이고 [다시 조사]는 그대로 눌린다', async () => {
    mockedPost.mockRejectedValueOnce(
      apiError(422, 'HOMEPAGE_NOT_FOUND', '홈페이지를 찾지 못했습니다.'),
    );
    renderControls();
    await userEvent.click(screen.getByTestId('homepage-rerun-button'));
    expect(await screen.findByTestId('homepage-error-message')).toHaveTextContent(
      '홈페이지를 찾지 못했습니다.',
    );
    expect(screen.queryByTestId('homepage-paste-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('homepage-rerun-button')).toBeEnabled();
  });

  it('읽기 거부(422 ROBOTS_DISALLOW)면 서버 문구와 본문 붙여넣기 칸이 열리고, 붙여 넣은 본문만 보낸다', async () => {
    mockedPost.mockRejectedValueOnce(
      apiError(422, 'ROBOTS_DISALLOW', '이 사이트는 자동으로 읽을 수 없습니다.'),
    );
    mockedPost.mockResolvedValueOnce(research());
    const onReload = vi.fn();
    renderControls(frameValue(), onReload);
    await userEvent.click(screen.getByTestId('homepage-rerun-button'));
    expect(await screen.findByTestId('homepage-error-message')).toHaveTextContent(
      '이 사이트는 자동으로 읽을 수 없습니다.',
    );
    expect(screen.getByTestId('homepage-error-ref')).toHaveTextContent(
      homepageControls.ref('ref-123'),
    );
    const area = screen.getByTestId('homepage-paste-input');
    await userEvent.click(screen.getByTestId('homepage-paste-submit'));
    expect(screen.getByTestId('homepage-paste-error')).toHaveTextContent(
      homepageControls.pasteEmpty,
    );
    await userEvent.type(area, '공개된 소개 글입니다');
    await userEvent.click(screen.getByTestId('homepage-paste-submit'));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(mockedPost).toHaveBeenLastCalledWith(
      'opp-1',
      { pastedText: '공개된 소개 글입니다' },
      'park-lee',
    );
  });

  it.each(['LLM_LIMIT', 'SEARCH_LIMIT', 'USAGE_UNCONFIRMED', 'LLM_NOT_CONFIGURED'])(
    '%s 실패면 조사 단추가 잠긴다',
    async (kind) => {
      mockedPost.mockRejectedValueOnce(apiError(503, kind));
      renderControls();
      await userEvent.click(screen.getByTestId('homepage-rerun-button'));
      expect(await screen.findByTestId('homepage-locked')).toBeInTheDocument();
      expect(screen.getByTestId('homepage-rerun-button')).toBeDisabled();
    },
  );

  it.each(['TIMEOUT', 'LLM_FAILED', 'UNREACHABLE'])(
    '%s 실패면 안내만 보이고 [다시 조사]는 그대로 눌린다',
    async (kind) => {
      mockedPost.mockRejectedValueOnce(apiError(kind === 'UNREACHABLE' ? 422 : 503, kind));
      renderControls();
      await userEvent.click(screen.getByTestId('homepage-rerun-button'));
      expect(await screen.findByTestId('homepage-error')).toBeInTheDocument();
      expect(screen.queryByTestId('homepage-locked')).not.toBeInTheDocument();
      expect(screen.getByTestId('homepage-rerun-button')).toBeEnabled();
    },
  );

  it('주소가 그 사이 바뀌었으면(409 STALE_VALUE) [새로 불러오기]가 보이고 누르면 다시 읽는다', async () => {
    mockedPost.mockRejectedValueOnce(
      apiError(409, 'STALE_VALUE', '확인할 홈페이지 주소가 바뀌었습니다.'),
    );
    const onReload = vi.fn();
    renderControls(frameValue(), onReload);
    await userEvent.click(screen.getByTestId('homepage-rerun-button'));
    await userEvent.click(await screen.findByTestId('homepage-reload-button'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('담당자를 고르지 않았으면 단추가 잠기고 안내가 보이며 요청을 보내지 않는다', async () => {
    renderControls(frameValue({ staffKey: null, canRecord: false }));
    expect(screen.getByTestId('homepage-rerun-button')).toBeDisabled();
    expect(screen.getByTestId('homepage-pick-staff')).toHaveTextContent(
      homepageControls.pickStaffFirst,
    );
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('서버에 닿지 못하면(네트워크) 쉬운 말 안내를 보인다', async () => {
    mockedPost.mockRejectedValueOnce(new Error('boom'));
    renderControls();
    await userEvent.click(screen.getByTestId('homepage-rerun-button'));
    expect(await screen.findByTestId('homepage-error')).toBeInTheDocument();
  });
});
