// #980(PM 결정 2026-11-28): 상세 "한눈에 › 어떤 회사"의 대표번호·대표명 [고치기]와 출처 표시.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버는 tests/unit/u3/test_company_phone_representative.py).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyFieldFix from '../CompanyFieldFix';
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

function renderFix(
  field: 'mainPhone' | 'representativeName',
  value: string | null,
  onSaved = vi.fn(),
  frameValue = frame(),
) {
  render(
    <FrameContext.Provider value={frameValue}>
      <CompanyFieldFix oppId="opp-1" field={field} value={value} onSaved={onSaved} />
    </FrameContext.Provider>,
  );
  return onSaved;
}

beforeEach(() => vi.mocked(postCompanyInfo).mockReset());

describe('상세 › 대표번호·대표명 [고치기] (#980)', () => {
  it('Given 대표번호가 없는 회사 When 보면 Then [넣기]이고, 값이 있으면 [고치기]다', () => {
    renderFix('mainPhone', null);
    expect(screen.getByTestId('company-phone-fix-button')).toHaveTextContent('넣기');
  });

  it('Given 보기 전용 When 보면 Then 단추가 잠겨 있다', () => {
    renderFix('representativeName', '홍길동', vi.fn(), frame({ canRecord: false }));
    expect(screen.getByTestId('company-representative-fix-button')).toBeDisabled();
  });

  it('Given 대표번호 When 새 번호로 저장 Then 그 칸만 보내고 상세를 다시 읽게 알린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCompanyInfo).mockResolvedValueOnce({
      data: { companyName: '가상', address: null, mainPhone: '041-555-1234' },
      meta: {},
    });
    const onSaved = renderFix('mainPhone', '041-000-0000');
    await user.click(screen.getByTestId('company-phone-fix-button'));
    expect(screen.getByTestId('company-phone-fix-edit')).toHaveTextContent(
      '담당자 휴대폰은 아래 [상대 담당자 연락처]',
    );
    const input = screen.getByRole('textbox', { name: '대표번호' });
    await user.clear(input);
    await user.type(input, '041-555-1234');
    await user.click(screen.getByTestId('company-phone-fix-save'));
    expect(postCompanyInfo).toHaveBeenCalledWith(
      'opp-1',
      { mainPhone: '041-555-1234' },
      'park-lee',
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('Given 대표명 When 빈 칸으로 저장 Then 빈 글을 보내 지운다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCompanyInfo).mockResolvedValueOnce({
      data: { companyName: '가상', address: null, representativeName: null },
      meta: {},
    });
    renderFix('representativeName', '홍길동');
    await user.click(screen.getByTestId('company-representative-fix-button'));
    await user.clear(screen.getByRole('textbox', { name: '대표명' }));
    await user.click(screen.getByTestId('company-representative-fix-save'));
    expect(postCompanyInfo).toHaveBeenCalledWith('opp-1', { representativeName: '' }, 'park-lee');
  });

  it('Given 휴대폰 번호 When 저장 Then 서버 안내 문장을 그 자리에 보인다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCompanyInfo).mockRejectedValueOnce(
      new ApiError(400, {
        message: '휴대폰 번호는 [상대 담당자 연락처]에 적어 주세요.',
        nextAction: '',
        ref: 'r1',
      }),
    );
    renderFix('mainPhone', null);
    await user.click(screen.getByTestId('company-phone-fix-button'));
    await user.type(screen.getByRole('textbox', { name: '대표번호' }), '010-1234-5678');
    await user.click(screen.getByTestId('company-phone-fix-save'));
    expect(await screen.findByTestId('company-phone-fix-error')).toHaveTextContent(
      '휴대폰 번호는 [상대 담당자 연락처]에',
    );
  });
});
