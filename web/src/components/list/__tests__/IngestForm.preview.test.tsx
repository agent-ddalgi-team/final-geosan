// 맞는 공장 수 줄(#549 1단계, 약속 C1 GET /ingest/preview): 공정을 고르면 저장된 판단으로 센 숫자가 바로 보인다.
// 서버 호출(getIngestPreview)은 가짜로 바꾼 확인이며, 실제 서버 연결은 임시 DB·서버로 따로 확인했다.
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IngestForm, { type IngestOptions } from '../IngestForm';
import { ApiError, getIngestPreview, postIngest } from '../../../api/client';
import type { Envelope, IngestPreview } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postIngest: vi.fn(),
  getIngestPreview: vi.fn(),
}));

const mockedPreview = vi.mocked(getIngestPreview);
const mockedPost = vi.mocked(postIngest);

const OPTIONS: IngestOptions = {
  processes: [
    { code: 'ZINC_PLATING', name: '전기아연도금' },
    { code: 'ANODIZING', name: '아노다이징' },
  ],
  regions: ['충남', '대전', '세종'],
  industries: ['방위산업', '반도체'],
};

function envelope(data: Partial<IngestPreview> = {}): Envelope<IngestPreview> {
  return {
    data: {
      matchedCount: 1518,
      fitCounts: { HIGH: 134, MEDIUM: 1382, LOW: 2 },
      registeredCount: 102,
      addableCount: 1416,
      addableHighCount: 32,
      unjudgedCount: 0,
      addCount: 50,
      ...data,
    },
    meta: {},
  };
}

function renderForm(staffKey: string | null = 'park-lee', running = false) {
  const view = (isRunning: boolean) => (
    <FrameContext.Provider
      value={{
        config: null,
        staffKey,
        setStaffKey: () => {},
        canRecord: staffKey !== null && staffKey !== 'viewer',
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <IngestForm options={OPTIONS} running={isRunning} onStarted={() => {}} />
    </FrameContext.Provider>
  );
  const result = render(view(running));
  return { rerunning: (next: boolean) => result.rerender(view(next)) };
}

beforeEach(() => {
  mockedPreview.mockReset();
  mockedPost.mockReset();
});

describe('IngestForm 맞는 공장 수 줄 (#549)', () => {
  it('단추 이름은 [영업 후보로 더하기 💰]이고, 공정을 고르기 전에는 숫자 줄도 요청도 없다', () => {
    renderForm();
    expect(screen.getByTestId('ingest-submit')).toHaveTextContent('영업 후보로 더하기 💰');
    expect(screen.queryByTestId('ingest-preview')).not.toBeInTheDocument();
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it('공정·지역을 고르면 선택지 순서대로 조건을 보내고 "맞는 공장 · 들어온 곳 · 안 들어온 상"을 보인다', async () => {
    mockedPreview.mockResolvedValue(envelope());
    renderForm();
    await userEvent.click(screen.getByTestId('ingest-region-대전'));
    await userEvent.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    expect(screen.getByTestId('ingest-preview')).toHaveTextContent('맞는 공장을 세는 중');

    await waitFor(() =>
      expect(screen.getByTestId('ingest-preview-counts')).toHaveTextContent(
        '맞는 공장 1,518곳 (상 134 · 중 1,382 · 하 2) · 영업 후보로 들어온 곳 102곳 · 아직 안 들어온 상 32곳',
      ),
    );
    expect(screen.getByTestId('ingest-preview-counts')).not.toHaveTextContent('AI 판단 전');
    expect(screen.getByTestId('ingest-preview-add')).toHaveTextContent(
      '누르면 최대 50곳을 영업 후보로 더합니다 · 조건을 바꿔 보는 것은 비용이 들지 않습니다',
    );
    expect(mockedPreview).toHaveBeenLastCalledWith(
      { processCodes: ['ZINC_PLATING'], regions: ['대전'] },
      expect.any(AbortSignal),
    );
  });

  it('고른 지역에 AI가 아직 판단하지 않은 공장이 있으면 "아직 AI 판단 전 n곳"을 덧붙인다', async () => {
    mockedPreview.mockResolvedValue(envelope({ unjudgedCount: 9917 }));
    renderForm();
    await userEvent.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await waitFor(() =>
      expect(screen.getByTestId('ingest-preview-counts')).toHaveTextContent(
        '· 아직 AI 판단 전 9,917곳',
      ),
    );
  });

  it('더할 공장이 없으면 "더할 공장이 없습니다"를 보인다', async () => {
    mockedPreview.mockResolvedValue(
      envelope({ addableCount: 0, addableHighCount: 0, registeredCount: 1518, addCount: 0 }),
    );
    renderForm();
    await userEvent.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await waitFor(() =>
      expect(screen.getByTestId('ingest-preview-add')).toHaveTextContent('더할 공장이 없습니다'),
    );
  });

  it('숫자를 못 불러오면 실패를 알리되 단추는 막지 않는다(숫자 줄은 안내일 뿐)', async () => {
    mockedPreview.mockRejectedValue(
      new ApiError(500, { message: '오류', nextAction: '다시 시도', ref: 'r-1' }),
    );
    renderForm();
    await userEvent.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await waitFor(() =>
      expect(screen.getByTestId('ingest-preview')).toHaveTextContent(
        '맞는 공장 수를 불러오지 못했습니다',
      ),
    );
    expect(screen.getByTestId('ingest-submit')).toBeEnabled();
  });

  it('조건을 빠르게 바꾸면 마지막 조건 하나만 센다', async () => {
    mockedPreview.mockResolvedValue(envelope());
    renderForm();
    await userEvent.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await userEvent.click(screen.getByTestId('ingest-process-ANODIZING'));
    await userEvent.click(screen.getByTestId('ingest-region-세종'));
    await waitFor(() => expect(screen.getByTestId('ingest-preview-counts')).toBeInTheDocument());
    expect(mockedPreview).toHaveBeenCalledTimes(1);
    expect(mockedPreview).toHaveBeenCalledWith(
      { processCodes: ['ZINC_PLATING', 'ANODIZING'], regions: ['세종'] },
      expect.any(AbortSignal),
    );
  });

  it('더하기가 끝나면(running이 풀리면) 들어온 곳 수를 다시 센다', async () => {
    mockedPreview.mockResolvedValueOnce(envelope({ registeredCount: 102 }));
    const { rerunning } = renderForm('park-lee', true);
    await userEvent.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await waitFor(() =>
      expect(screen.getByTestId('ingest-preview-counts')).toHaveTextContent('들어온 곳 102곳'),
    );
    mockedPreview.mockResolvedValueOnce(envelope({ registeredCount: 152 }));
    act(() => rerunning(false));
    await waitFor(() =>
      expect(screen.getByTestId('ingest-preview-counts')).toHaveTextContent('들어온 곳 152곳'),
    );
    expect(mockedPreview).toHaveBeenCalledTimes(2);
  });

  it('보기 전용 계정에는 조건 칸과 숫자 줄을 그리지 않고 요청도 하지 않는다', () => {
    renderForm('viewer');
    expect(screen.queryByTestId('ingest-form')).not.toBeInTheDocument();
    expect(mockedPreview).not.toHaveBeenCalled();
  });
});
