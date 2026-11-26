// #932 "기존 고객과 닮은 조건" 줄: 켜졌을 때만 보이고, [적용]은 공정·산업 칸만 채운다(찾기는 시작하지 않음).
// 서버 호출(getCustomerSuggestions)은 가짜로 바꾼 확인이며, 서버 쪽 셈은 파이썬 시험(test_existing_customers)이 본다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerLikeLine from '../CustomerLikeLine';
import IngestForm, { type IngestOptions } from '../IngestForm';
import { getCustomerSuggestions, getIngestPreview, postIngest } from '../../../api/client';
import type { CustomerSuggestions, Envelope } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getCustomerSuggestions: vi.fn(),
  getIngestPreview: vi.fn(),
  postIngest: vi.fn(),
}));

const mocked = vi.mocked(getCustomerSuggestions);

function envelope(
  data: Partial<CustomerSuggestions>,
  virtual = false,
): Envelope<CustomerSuggestions> {
  return {
    data: {
      enabled: true,
      total: 7,
      processes: [
        { code: 'ZINC_PLATING', label: '아연도금', count: 4 },
        { code: 'ANODIZING', label: '아노다이징', count: 1 },
        { code: 'CHROMATE', label: '크로메이트', count: 1 },
      ],
      industries: [
        { name: '자동차 부품', count: 3 },
        { name: '방위산업', count: 1 },
      ],
      regions: [
        { name: '충남', count: 4 },
        { name: '천안시', count: 2 },
      ],
      ...data,
    },
    meta: { hasVirtualData: virtual },
  };
}

beforeEach(() => {
  mocked.mockReset();
  vi.mocked(getIngestPreview).mockReset();
  vi.mocked(postIngest).mockReset();
});

test('켜졌으면 공정·산업·지역을 고객 수와 함께 보이고 [적용]은 칸 안 값만 넘긴다', async () => {
  mocked.mockResolvedValue(envelope({}, true));
  const onApply = vi.fn();
  render(
    <CustomerLikeLine
      processCodes={['ZINC_PLATING', 'ANODIZING']}
      industries={['자동차 부품', '반도체']}
      onApply={onApply}
    />,
  );
  const items = await screen.findByTestId('customer-like-items');
  // 찾기 칸에 없는 크로메이트·방위산업은 보이지 않는다.
  expect(items).toHaveTextContent(
    '아연도금 4곳 · 아노다이징 1곳 · 자동차 부품 3곳 · 주로 충남·천안시',
  );
  expect(screen.getByText('기존 고객과 닮은 조건(기존 고객 7곳 기준)')).toBeInTheDocument();
  expect(screen.getByTestId('customer-like-virtual')).toHaveTextContent('가상·거산 실제 사양 아님');
  await userEvent.click(screen.getByTestId('customer-like-apply'));
  expect(onApply).toHaveBeenCalledWith(['ZINC_PLATING', 'ANODIZING'], ['자동차 부품']);
  expect(screen.getByRole('status')).toHaveTextContent('[발굴 시작]을 눌러야');
});

test.each([
  ['꺼짐', envelope({ enabled: false, total: 0, processes: [], industries: [], regions: [] })],
  ['고객 없음', envelope({ total: 0 })],
  [
    '칸에 맞는 값 없음',
    envelope({ processes: [{ code: 'X', label: '없는 공정', count: 2 }], industries: [] }),
  ],
])('%s이면 줄을 그리지 않는다', async (_name, value) => {
  mocked.mockResolvedValue(value);
  render(
    <CustomerLikeLine
      processCodes={['ZINC_PLATING']}
      industries={['자동차 부품']}
      onApply={vi.fn()}
    />,
  );
  await waitFor(() => expect(mocked).toHaveBeenCalled());
  expect(screen.queryByTestId('customer-like')).not.toBeInTheDocument();
});

test('읽기에 실패해도 줄만 없고 오류를 띄우지 않는다', async () => {
  mocked.mockRejectedValue(new Error('network'));
  render(<CustomerLikeLine processCodes={['ZINC_PLATING']} industries={[]} onApply={vi.fn()} />);
  await waitFor(() => expect(mocked).toHaveBeenCalled());
  expect(screen.queryByTestId('customer-like')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

const OPTIONS: IngestOptions = {
  processes: [
    { code: 'ZINC_PLATING', name: '전기아연도금' },
    { code: 'ANODIZING', name: '아노다이징' },
  ],
  regions: ['충남', '대전', '세종'],
  industries: ['방위산업', '자동차 부품'],
};

test('찾기 칸에서 [적용]을 누르면 공정·산업이 체크되고 찾기 요청은 나가지 않는다', async () => {
  mocked.mockResolvedValue(envelope({}));
  vi.mocked(getIngestPreview).mockReturnValue(new Promise(() => undefined));
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
      <IngestForm options={OPTIONS} running={false} onStarted={vi.fn()} />
    </FrameContext.Provider>,
  );
  await userEvent.click(await screen.findByTestId('customer-like-apply'));
  expect(screen.getByTestId('ingest-process-ZINC_PLATING')).toBeChecked();
  expect(screen.getByTestId('ingest-process-ANODIZING')).toBeChecked();
  expect(screen.getByTestId('ingest-industry-자동차 부품')).toBeChecked();
  expect(screen.getByTestId('ingest-industry-방위산업')).toBeChecked();
  expect(postIngest).not.toHaveBeenCalled();
});
