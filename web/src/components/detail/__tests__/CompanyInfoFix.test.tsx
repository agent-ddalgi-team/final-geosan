// #958(PM 결정 2026-11-26): 상세 "한눈에 › 어떤 회사"의 주소·회사 이름 [고치기].
// 서버 호출(postCompanyInfo)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버는 tests/unit/u3/test_company_info_fix.py).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyInfoFix from '../CompanyInfoFix';
import { ApiError, postCompanyInfo } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postCompanyInfo: vi.fn(),
}));

function frame(overrides: Partial<FrameValue> = {}): FrameValue {
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

function renderFix({
  address = '충남 천안시 가상로 9' as string | null,
  canRename = true,
  onSaved = vi.fn(),
  value = frame(),
} = {}) {
  render(
    <FrameContext.Provider value={value}>
      <CompanyInfoFix
        oppId="opp-1"
        address={address}
        companyName="가상직접회사"
        canRename={canRename}
        onSaved={onSaved}
      />
    </FrameContext.Provider>,
  );
  return onSaved;
}

beforeEach(() => {
  vi.mocked(postCompanyInfo).mockReset();
});

describe('상세 › 한눈에 › 어떤 회사 주소·회사 이름 [고치기] (#958)', () => {
  it('Given 직접 넣은 회사 When 열면 Then [주소 고치기]·[회사 이름 고치기]가 보이고, 공장 자료 회사는 이름 단추가 없다', () => {
    renderFix();
    expect(screen.getByTestId('company-address-edit-button')).toHaveTextContent('주소 고치기');
    expect(screen.getByTestId('company-name-edit-button')).toHaveTextContent('회사 이름 고치기');
  });

  it('Given 공장 자료에서 온 회사 When 열면 Then 회사 이름 단추가 없다', () => {
    renderFix({ canRename: false });
    expect(screen.queryByTestId('company-name-edit-button')).not.toBeInTheDocument();
  });

  it('Given 주소가 없는 회사 When 열면 Then [주소 넣기]로 보인다', () => {
    renderFix({ address: null });
    expect(screen.getByTestId('company-address-edit-button')).toHaveTextContent('주소 넣기');
  });

  it('Given 새 주소 When [저장] Then 주소만 보내고 상세를 다시 읽게 알린다. 같은 값이면 [저장]이 잠긴다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCompanyInfo).mockResolvedValueOnce({
      data: { companyName: '가상직접회사', address: '충남 아산시 가상로 10' },
      meta: { reevaluated: false },
    });
    const onSaved = renderFix();
    await user.click(screen.getByTestId('company-address-edit-button'));
    const input = screen.getByRole('textbox', { name: '주소' });
    expect(input).toHaveValue('충남 천안시 가상로 9');
    expect(screen.getByTestId('company-info-save-button')).toBeDisabled();
    expect(screen.getByTestId('company-info-edit')).toHaveTextContent('거리와 지도를 새 주소로');
    await user.clear(input);
    await user.type(input, ' 충남 아산시 가상로 10 ');
    await user.click(screen.getByTestId('company-info-save-button'));
    await waitFor(() =>
      expect(postCompanyInfo).toHaveBeenCalledWith(
        'opp-1',
        { address: '충남 아산시 가상로 10' },
        'park-lee',
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByTestId('company-info-edit')).not.toBeInTheDocument();
  });

  it('Given 회사 이름 오타 When 고쳐 저장 Then 이름만 보낸다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCompanyInfo).mockResolvedValueOnce({
      data: { companyName: '가상직접정밀', address: '충남 천안시 가상로 9' },
      meta: { reevaluated: false },
    });
    renderFix();
    await user.click(screen.getByTestId('company-name-edit-button'));
    const input = screen.getByRole('textbox', { name: '회사 이름' });
    await user.clear(input);
    await user.type(input, '가상직접정밀');
    await user.click(screen.getByTestId('company-info-save-button'));
    await waitFor(() =>
      expect(postCompanyInfo).toHaveBeenCalledWith(
        'opp-1',
        { companyName: '가상직접정밀' },
        'park-lee',
      ),
    );
  });

  it('Given 서버가 거부(연락처가 섞임) When [저장] Then 서버 말과 함께 실패를 알리고 입력은 그대로 둔다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCompanyInfo).mockRejectedValueOnce(
      new ApiError(400, {
        message: '주소에 전화번호나 이메일이 있어 넣지 않았습니다.',
        nextAction: '',
        ref: 'r1',
      }),
    );
    const onSaved = renderFix();
    await user.click(screen.getByTestId('company-address-edit-button'));
    const input = screen.getByRole('textbox', { name: '주소' });
    await user.type(input, ' 041-000-0000');
    await user.click(screen.getByTestId('company-info-save-button'));
    expect(await screen.findByTestId('company-info-error')).toHaveTextContent(
      '전화번호나 이메일이 있어',
    );
    expect(input).toHaveValue('충남 천안시 가상로 9 041-000-0000');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Given 담당자를 고르기 전(기록 불가) When 열면 Then 단추가 잠겨 있다', () => {
    renderFix({ value: frame({ staffKey: null, canRecord: false }) });
    expect(screen.getByTestId('company-address-edit-button')).toBeDisabled();
    expect(screen.getByTestId('company-name-edit-button')).toBeDisabled();
  });
});
