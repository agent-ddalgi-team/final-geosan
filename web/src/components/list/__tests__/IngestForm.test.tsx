// 후보 가져오기 조건 칸(#316): 공정 1개 이상 필수, 지역·산업 선택, 요청 모양, 잠금, 오류 안내.
// 서버 호출(postIngest)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IngestForm, { type IngestOptions } from '../IngestForm';
import { ApiError, postIngest } from '../../../api/client';
import type { Envelope, IngestResponse } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { candidateSearch } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postIngest: vi.fn(),
  // 숫자 줄(#549)은 IngestForm.preview.test.tsx에서 본다. 여기서는 답하지 않는 요청으로 둔다.
  getIngestPreview: vi.fn(() => new Promise(() => {})),
}));

const mockedPost = vi.mocked(postIngest);

const OPTIONS: IngestOptions = {
  processes: [
    { code: 'ZINC_PLATING', name: '전기아연도금' },
    { code: 'ANODIZING', name: '아노다이징' },
  ],
  regions: ['충남', '대전', '세종'],
  industries: ['방위산업', '반도체', '자동차 부품'],
};

const OK: Envelope<IngestResponse> = {
  data: { batchId: 'batch-1', newCount: 0, mergeCandidateCount: 0, skippedCount: 0 },
  meta: {},
};

function apiError(status: number, message: string, kind?: string) {
  return new ApiError(status, { message, nextAction: '다시 시도', ref: 'r-1', kind });
}

function renderForm(
  props: { running?: boolean; onStarted?: () => void; options?: IngestOptions } = {},
  frame: { staffKey: string | null; canRecord: boolean } = {
    staffKey: 'park-lee',
    canRecord: true,
  },
) {
  const onStarted = props.onStarted ?? vi.fn();
  render(
    <FrameContext.Provider
      value={{
        config: null,
        staffKey: frame.staffKey,
        setStaffKey: () => {},
        canRecord: frame.canRecord,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <IngestForm
        options={props.options ?? OPTIONS}
        running={props.running ?? false}
        onStarted={onStarted}
      />
    </FrameContext.Provider>,
  );
  return { onStarted };
}

describe('IngestForm', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  it('공정을 하나도 안 고르면 단추가 잠기고 안내가 보이며, 고르면 열린다', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByTestId('ingest-submit')).toBeDisabled();
    expect(screen.getByTestId('ingest-hint')).toHaveTextContent(candidateSearch.processHint);
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    expect(screen.getByTestId('ingest-submit')).toBeEnabled();
    expect(screen.queryByTestId('ingest-hint')).not.toBeInTheDocument();
    // 다시 해제하면 또 잠긴다.
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    expect(screen.getByTestId('ingest-submit')).toBeDisabled();
  });

  it('공정만 고르면 지역·산업 칸 없이 담당자 키와 함께 보내고, 성공하면 안내하고 진행을 다시 읽게 한다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce(OK);
    const { onStarted } = renderForm();
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await user.click(screen.getByTestId('ingest-submit'));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    const [body, staffKey] = mockedPost.mock.calls[0];
    expect(body).toEqual({ processCodes: ['ZINC_PLATING'] });
    expect(body).not.toHaveProperty('regions');
    expect(body).not.toHaveProperty('industries');
    expect(staffKey).toBe('park-lee');
    expect(await screen.findByTestId('ingest-notice')).toHaveTextContent(candidateSearch.started);
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it('지역·산업을 고르면 함께 보내고, 순서는 고른 순서가 아니라 선택지 순서다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce(OK);
    renderForm();
    // 일부러 거꾸로 고른다.
    await user.click(screen.getByTestId('ingest-process-ANODIZING'));
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await user.click(screen.getByTestId('ingest-region-세종'));
    await user.click(screen.getByTestId('ingest-region-충남'));
    await user.click(screen.getByTestId('ingest-industry-자동차 부품'));
    await user.click(screen.getByTestId('ingest-industry-방위산업'));
    await user.click(screen.getByTestId('ingest-submit'));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][0]).toEqual({
      processCodes: ['ZINC_PLATING', 'ANODIZING'],
      regions: ['충남', '세종'],
      industries: ['방위산업', '자동차 부품'],
    });
  });

  it('선택지가 비어 있는 지역·산업 칸은 그리지 않는다', () => {
    renderForm({ options: { ...OPTIONS, regions: [], industries: [] } });
    expect(screen.getByTestId('ingest-process')).toBeInTheDocument();
    expect(screen.queryByTestId('ingest-region')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingest-industry')).not.toBeInTheDocument();
  });

  it('보기 전용(viewer) 계정에는 조건 칸과 단추가 아예 보이지 않는다', () => {
    renderForm({}, { staffKey: 'viewer', canRecord: false });
    expect(screen.queryByTestId('ingest-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingest-submit')).not.toBeInTheDocument();
  });

  it('담당자를 고르기 전에는 단추가 잠기고 안내가 보이며 요청을 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderForm({}, { staffKey: null, canRecord: false });
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    expect(screen.getByTestId('ingest-submit')).toBeDisabled();
    expect(screen.getByTestId('ingest-hint')).toHaveTextContent(candidateSearch.pickStaffFirst);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('이미 가져오는 중(running)이면 공정을 골라도 단추가 잠기고 안내가 보인다', async () => {
    const user = userEvent.setup();
    renderForm({ running: true });
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    expect(screen.getByTestId('ingest-submit')).toBeDisabled();
    expect(screen.getByTestId('ingest-hint')).toHaveTextContent(candidateSearch.alreadyRunning);
  });

  it('보내는 동안 단추가 잠기고 "가져오는 중"으로 바뀌며, 끝나면 풀린다', async () => {
    const user = userEvent.setup();
    let resolve: (value: Envelope<IngestResponse>) => void = () => {};
    mockedPost.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderForm();
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await user.click(screen.getByTestId('ingest-submit'));
    expect(await screen.findByText(candidateSearch.fetching)).toBeInTheDocument();
    expect(screen.getByTestId('ingest-submit')).toBeDisabled();
    resolve(OK);
    await screen.findByTestId('ingest-notice');
    expect(screen.getByTestId('ingest-submit')).toBeEnabled();
  });

  it('다른 사람이 먼저 눌러 409면 "지금 가져오는 중입니다"를 보이고 진행을 다시 읽게 한다', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValueOnce(apiError(409, '지금 가져오는 중입니다', 'INGEST_RUNNING'));
    const { onStarted } = renderForm();
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await user.click(screen.getByTestId('ingest-submit'));
    const notice = await screen.findByTestId('ingest-notice');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent(candidateSearch.alreadyRunning);
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it.each([
    [503, '소스를 읽지 못했습니다', candidateSearch.sourceFailed, false],
    [400, '설정에 없는 지역입니다', candidateSearch.invalidCondition, true],
    [403, '권한이 없습니다', candidateSearch.pickStaffFirst, false],
    [500, '서버 내부 오류', candidateSearch.startFailed, true],
  ])(
    '서버가 %i로 거절하면 쉬운 말로 안내하고 진행을 다시 읽게 하지 않는다',
    async (status, message, expected, withDetail) => {
      const user = userEvent.setup();
      mockedPost.mockRejectedValueOnce(apiError(status, message));
      const { onStarted } = renderForm();
      await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
      await user.click(screen.getByTestId('ingest-submit'));
      const notice = await screen.findByTestId('ingest-notice');
      expect(notice).toHaveAttribute('role', 'alert');
      expect(notice).toHaveTextContent(expected);
      if (withDetail) expect(notice).toHaveTextContent(message);
      expect(onStarted).not.toHaveBeenCalled();
      // 실패해도 다시 누를 수 있다.
      expect(screen.getByTestId('ingest-submit')).toBeEnabled();
    },
  );

  it('서버에 닿지 못하면(네트워크) 시작하지 못했다는 안내를 보인다', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValueOnce(new Error('network'));
    renderForm();
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await user.click(screen.getByTestId('ingest-submit'));
    expect(await screen.findByTestId('ingest-notice')).toHaveTextContent(
      candidateSearch.startFailed,
    );
  });
});
