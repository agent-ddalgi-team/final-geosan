// #948 "이름으로 회사 넣기": 찾기 → 고르기 → [관심 기업으로 넣기]. 이미 있는 회사는 [열기]로 보낸다.
// 서버 호출(lookupCompanies·postCompany)은 가짜로 바꾼 확인이며, 서버 쪽 동작은 파이썬 시험
// (test_staff_add_company)이 실제 임시 DB로 본다.
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CompanyAddBox from '../CompanyAddBox';
import { ApiError, lookupCompanies, postCompany } from '../../../api/client';
import type { CompanyLookup, Envelope } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  lookupCompanies: vi.fn(),
  postCompany: vi.fn(),
}));

const FOUND: CompanyLookup = {
  existing: [
    { oppId: 'opp-old', companyName: '가상진행금속', address: '충남 공주시 1', bookmarked: true },
  ],
  factories: [
    {
      rowId: 'row-a',
      companyName: '(주)가상진행금속',
      address: '충남 천안시 가상로 1',
      region: '충남',
      product: '볼트',
      industryName: null,
      oppId: null,
    },
    {
      rowId: 'row-b',
      companyName: '가상진행금속 2공장',
      address: '충남 아산시 가상로 2',
      region: '충남',
      product: null,
      industryName: null,
      oppId: 'opp-b',
    },
  ],
  truncated: false,
};

function wrap(children: ReactNode, staffKey = 'park-lee') {
  return (
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey,
          setStaffKey: () => {},
          canRecord: staffKey !== 'viewer',
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        {children}
      </FrameContext.Provider>
    </MemoryRouter>
  );
}

function envelope<T>(data: T, virtual = false): Envelope<T> {
  return { data, meta: { hasVirtualData: virtual } } as Envelope<T>;
}

beforeEach(() => {
  vi.mocked(lookupCompanies).mockReset();
  vi.mocked(postCompany).mockReset();
});

async function searchFor(name: string) {
  await userEvent.type(screen.getByTestId('company-add-name'), name);
  await userEvent.click(screen.getByTestId('company-add-search'));
}

test('찾은 공장 자료 행을 골라 넣으면 rowId와 아는 홈페이지를 보내고 목록을 다시 읽게 한다', async () => {
  vi.mocked(lookupCompanies).mockResolvedValue(envelope(FOUND, true));
  vi.mocked(postCompany).mockResolvedValue(
    envelope({ oppId: 'opp-new', created: true, researchQueued: true }),
  );
  const onAdded = vi.fn();
  render(wrap(<CompanyAddBox onAdded={onAdded} />));
  await searchFor('진행금속');
  expect(lookupCompanies).toHaveBeenCalledWith('진행금속');
  expect(await screen.findByText('가상·거산 실제 사양 아님')).toBeInTheDocument();
  // 이미 목록에 있는 회사는 고르는 칸 없이 [열기]만 보인다.
  expect(screen.getByTestId('company-add-existing')).toHaveTextContent(
    '가상진행금속 · 충남 공주시 1 · 관심 기업',
  );
  expect(
    screen.getByText(/가상진행금속 2공장 · 충남 아산시 가상로 2 · 목록에 있음/),
  ).toBeInTheDocument();
  expect(screen.getByTestId('company-add-submit')).toBeDisabled();
  expect(screen.getByTestId('company-add-row-row-a')).not.toHaveAttribute('data-picked');
  await userEvent.click(screen.getByRole('radio', { name: /\(주\)가상진행금속/ }));
  // 고른 줄 전체가 강조 연한 바탕으로 채워지고 "✓ 고름"이 붙는다(#972 선택 단추 모양).
  const pickedRow = screen.getByTestId('company-add-row-row-a');
  expect(pickedRow).toHaveAttribute('data-picked', 'true');
  expect(pickedRow).toHaveTextContent('✓ 고름');
  expect(pickedRow.style.background).not.toBe('');
  expect(screen.getByTestId('company-add-row-manual')).not.toHaveAttribute('data-picked');
  await userEvent.type(screen.getByTestId('company-add-homepage'), ' https://example.com ');
  await userEvent.click(screen.getByTestId('company-add-submit'));
  expect(postCompany).toHaveBeenCalledWith(
    { rowId: 'row-a', homepageUrl: 'https://example.com' },
    'park-lee',
  );
  expect(await screen.findByTestId('company-add-done')).toHaveTextContent(
    '관심 기업으로 넣었습니다. 홈페이지 조사가 곧 시작됩니다. 상세 열기',
  );
  expect(screen.getByRole('link', { name: '상세 열기' })).toHaveAttribute(
    'href',
    '/opportunities/opp-new',
  );
  expect(onAdded).toHaveBeenCalledTimes(1);
});

test('공장 자료에 없으면 이름과 아는 주소만으로 넣는다', async () => {
  vi.mocked(lookupCompanies).mockResolvedValue(
    envelope({ existing: [], factories: [], truncated: false }),
  );
  vi.mocked(postCompany).mockResolvedValue(
    envelope({ oppId: 'opp-new', created: true, researchQueued: false }),
  );
  render(wrap(<CompanyAddBox />));
  await searchFor('가상거래처');
  expect(await screen.findByText('공장 자료에서 이 이름을 찾지 못했습니다.')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('company-add-manual'));
  await userEvent.type(screen.getByTestId('company-add-address'), '충남 천안시');
  await userEvent.click(screen.getByTestId('company-add-submit'));
  expect(postCompany).toHaveBeenCalledWith(
    { companyName: '가상거래처', address: '충남 천안시', homepageUrl: undefined },
    'park-lee',
  );
  expect(await screen.findByTestId('company-add-done')).toHaveTextContent(
    '상세에서 [AI로 조사]를 눌러 주세요',
  );
});

test('한 글자면 찾지 않고 안내한다', async () => {
  render(wrap(<CompanyAddBox />));
  await searchFor('가');
  expect(lookupCompanies).not.toHaveBeenCalled();
  expect(screen.getByTestId('company-add-error')).toHaveTextContent('두 글자 이상');
});

test('제외로 저장한 회사는 서버 거부를 쉬운 말로 보인다', async () => {
  vi.mocked(lookupCompanies).mockResolvedValue(envelope(FOUND));
  vi.mocked(postCompany).mockRejectedValue(
    new ApiError(422, { message: '제외로 저장한 회사입니다', kind: 'BOOKMARK_EXCLUDED' } as never),
  );
  render(wrap(<CompanyAddBox />));
  await searchFor('진행금속');
  await userEvent.click(await screen.findByRole('radio', { name: /\(주\)가상진행금속/ }));
  await userEvent.click(screen.getByTestId('company-add-submit'));
  expect(await screen.findByTestId('company-add-error')).toHaveTextContent(
    '검토 의견을 바꾼 뒤 다시 넣어 주세요',
  );
});

test('보기 전용에게는 칸이 없다', () => {
  render(wrap(<CompanyAddBox />, 'viewer'));
  expect(screen.queryByTestId('company-add')).not.toBeInTheDocument();
});
