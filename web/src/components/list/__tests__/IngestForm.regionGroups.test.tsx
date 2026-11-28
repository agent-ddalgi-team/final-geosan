// #798(PM 지시 2026-11-16): 새 후보 찾기 지역을 권역으로 고르고, 시·군 직접 고르기는 접어 두며,
// "자료 기준" 줄로 어떤 공공자료 날짜로 찾는지 보인다. 서버 호출은 가짜(실제 연결은 서버 시험).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IngestForm, { type IngestOptions } from '../IngestForm';
import { postIngest } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postIngest: vi.fn(),
  getIngestPreview: vi.fn(() => new Promise(() => {})),
}));

const mockedPost = vi.mocked(postIngest);

const OPTIONS: IngestOptions = {
  processes: [{ code: 'ZINC_PLATING', name: '전기아연도금' }],
  regions: ['충남', '천안시', '아산시', '공주시', '대전', '세종'],
  industries: [],
  regionGroups: [
    { label: '천안·아산', regions: ['천안시', '아산시'] },
    { label: '세종·대전·공주', regions: ['세종', '대전', '공주시'] },
  ],
  dataBasis: [
    { kind: 'FACTORY_FILE', asOf: '2025-12-31' },
    { kind: 'AI_JUDGMENT', asOf: '2026-11-14' },
  ],
};

function renderForm(options: IngestOptions = OPTIONS) {
  render(
    <FrameContext.Provider
      value={{
        config: null,
        staffKey: 'park-lee',
        setStaffKey: () => {},
        canRecord: true,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <IngestForm options={options} running={false} onStarted={vi.fn()} />
    </FrameContext.Provider>,
  );
}

beforeEach(() => {
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({
    data: { batchId: 'b', newCount: 0, mergeCandidateCount: 0, skippedCount: 0 },
    meta: {},
  });
});

it('Given 권역 설정 / When 처음 열기 / Then 권역 칸이 보이고 첫 권역(천안·아산)이 골라져 있으며 시·군 칸은 접혀 있다', () => {
  renderForm();
  expect(screen.getByTestId('ingest-region-group-천안·아산')).toBeChecked();
  expect(screen.getByTestId('ingest-region-group-세종·대전·공주')).not.toBeChecked();
  expect(screen.getByTestId('ingest-region-group')).toHaveTextContent('천안·아산 (천안시·아산시)');
  const direct = screen.getByTestId('ingest-region-direct');
  expect(direct.tagName).toBe('DETAILS');
  expect(direct).not.toHaveAttribute('open');
});

it('Given 권역 두 개 + 시·군 하나 / When 찾기 / Then 고른 시·군을 겹치지 않게 선택지 순서로 합쳐 보낸다', async () => {
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
  await user.click(screen.getByTestId('ingest-region-group-세종·대전·공주'));
  await user.click(screen.getByTestId('ingest-region-충남'));
  await user.click(screen.getByTestId('ingest-region-아산시'));
  await user.click(screen.getByTestId('ingest-submit'));
  await waitFor(() => expect(mockedPost).toHaveBeenCalled());
  expect(mockedPost.mock.calls[0][0]).toEqual({
    processCodes: ['ZINC_PLATING'],
    regions: ['충남', '천안시', '아산시', '공주시', '대전', '세종'],
  });
});

it('Given 권역을 모두 끄면 / When 찾기 / Then 지역 없이 보내 설정된 지역 전체에서 찾는다', async () => {
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
  await user.click(screen.getByTestId('ingest-region-group-천안·아산'));
  await user.click(screen.getByTestId('ingest-submit'));
  await waitFor(() => expect(mockedPost).toHaveBeenCalled());
  expect(mockedPost.mock.calls[0][0]).toEqual({ processCodes: ['ZINC_PLATING'] });
});

it('자료 기준을 펼치면 종류 이름과 날짜가 보인다', async () => {
  const user = userEvent.setup();
  renderForm();
  const details = screen.getByText('자료 기준', { exact: true });
  expect(screen.getByTestId('ingest-data-basis')).not.toBeVisible();
  await user.click(details);
  expect(screen.getByTestId('ingest-data-basis')).toBeVisible();
  expect(screen.getByTestId('ingest-data-basis')).toHaveTextContent(
    '산단공 공장현황 파일 2025-12-31 · 마지막 AI 판단 2026-11-14',
  );
});

it('자료 기준이 빈 목록이면 "아직 넣은 공공자료가 없습니다"', () => {
  renderForm({ ...OPTIONS, dataBasis: [] });
  expect(screen.getByTestId('ingest-data-basis')).toHaveTextContent(
    '아직 넣은 공공자료가 없습니다',
  );
});

it('옛 응답(권역·자료 기준 칸 없음)이면 지금처럼 시·군 칸만 펼쳐 보이고 자료 기준 줄은 없다', () => {
  renderForm({ processes: OPTIONS.processes, regions: OPTIONS.regions, industries: [] });
  expect(screen.queryByTestId('ingest-region-group')).not.toBeInTheDocument();
  expect(screen.queryByTestId('ingest-region-direct')).not.toBeInTheDocument();
  expect(screen.getByTestId('ingest-region')).toBeInTheDocument();
  expect(screen.queryByTestId('ingest-data-basis')).not.toBeInTheDocument();
});

it('#961 Given 권역 설정 / When 시·군 직접 고르기를 펼침 / Then 시·도 전체 줄과 권역 이름 줄로 나뉘어 보이고, 고른 시·군은 그대로 보낸다', async () => {
  const user = userEvent.setup();
  renderForm({
    ...OPTIONS,
    regions: [...OPTIONS.regions, '경기', '평택시', '오산시'],
    regionGroups: [
      ...(OPTIONS.regionGroups ?? []),
      { label: '경기 남부', regions: ['평택시', '오산시'] },
    ],
  });
  const whole = screen.getByTestId('ingest-region-section-시·도 전체');
  expect(whole).toHaveTextContent('시·도 전체');
  expect(whole).toHaveTextContent('충남');
  expect(whole).toHaveTextContent('경기');
  expect(whole).not.toHaveTextContent('평택시');
  const south = screen.getByTestId('ingest-region-section-경기 남부');
  expect(south).toHaveTextContent('경기 남부');
  expect(south).toHaveTextContent('평택시');
  expect(south).toHaveTextContent('오산시');
  expect(screen.getByTestId('ingest-region-section-세종·대전·공주')).toHaveTextContent('공주시');
  // 시·군은 한 번씩만 보인다(권역에 든 것은 시·도 전체 줄에 다시 나오지 않음).
  expect(screen.getAllByTestId('ingest-region-오산시')).toHaveLength(1);
  await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
  await user.click(screen.getByTestId('ingest-region-group-천안·아산'));
  await user.click(screen.getByTestId('ingest-region-오산시'));
  await user.click(screen.getByTestId('ingest-submit'));
  await waitFor(() => expect(mockedPost).toHaveBeenCalled());
  expect(mockedPost.mock.calls[0][0]).toEqual({
    processCodes: ['ZINC_PLATING'],
    regions: ['오산시'],
  });
});
