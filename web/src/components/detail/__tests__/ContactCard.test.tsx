// #996(PM 결정 2026-11-29) 기업 상세 둘째 줄 오른쪽 "담당자 연락처" 칸:
// 회사 대표번호(값 · 출처 · 확인 · [고치기]) · 대표명(값 · 출처 · [넣기/고치기]) · 상대 담당자 줄.
// 대표번호 · 대표명 줄은 전에 "한눈에 › 어떤 회사"에 있던 것이라, 그때의 기대를 이 자리로 옮겼다.
// 서버 호출(getContacts)은 가짜로 바꾼 확인이다(실제 서버 연결 확인 아님). 번호 · 이름은 가상이다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getContacts } from '../../../api/client';
import type { ConfigUi, DetailHeader } from '../../../api/types';
import { companyFieldFixTexts, contactPersonsTexts } from '../../../labels/ko';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import { FrameContext } from '../../frame/FrameContext';
import ContactCard from '../ContactCard';
import ContactPersons from '../ContactPersons';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getContacts: vi.fn(),
}));

const header: DetailHeader = {
  ...(detailFixture.data.header as unknown as DetailHeader),
  mainPhone: '042-000-0000',
  mainPhoneSource: 'CSV',
  mainPhoneSourceUrl: null,
  mainPhoneConfirmedAt: null,
  mainPhoneConfirmedBy: null,
  representativeName: null,
  representativeNameSource: null,
};
const config = { staff: [{ key: 'staff-a', displayName: '영업 담당' }] } as unknown as ConfigUi;

function renderCard(
  props: Partial<Parameters<typeof ContactCard>[0]> = {},
  frame: { staffKey?: string | null; canRecord?: boolean } = {},
) {
  const { staffKey = 'staff-a', canRecord = true } = frame;
  render(
    <FrameContext.Provider
      value={{
        config,
        staffKey,
        setStaffKey: () => {},
        canRecord,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <ContactCard header={header} {...props} />
    </FrameContext.Provider>,
  );
}

beforeEach(() => vi.mocked(getContacts).mockReset());

describe('담당자 연락처 칸 (#996)', () => {
  it('Given 대표번호가 있는 회사 When 칸을 보면 Then 제목은 "담당자 연락처"이고 번호 · 출처 · 확인 상태 · [고치기]가 한 줄에 있다', () => {
    renderCard({ fix: { oppId: 'opp-1', onSaved: () => {} } });
    const card = screen.getByRole('region', { name: '담당자 연락처' });
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent(/^담당자 연락처$/);
    expect(contactPersonsTexts.title).toBe('담당자 연락처');
    const phone = within(card).getByTestId('company-phone');
    expect(phone).toHaveTextContent(contactPersonsTexts.mainPhoneRow);
    const link = within(phone).getByTestId('company-phone-link');
    expect(link).toHaveTextContent('042-000-0000');
    expect(link).toHaveAttribute('href', 'tel:0420000000');
    expect(within(phone).getByTestId('company-phone-source')).toHaveTextContent(
      '출처: 공장현황 자료',
    );
    expect(within(phone).getByTestId('company-phone-status')).toHaveTextContent('담당자 확인 전');
    expect(within(phone).getByTestId('company-phone-fix-button')).toHaveTextContent(
      companyFieldFixTexts.edit,
    );
  });

  it('Given 홈페이지에서 가져온 번호 · 담당자가 확인한 번호 When 칸을 보면 Then 출처는 새 창 링크, 확인은 "담당자 확인 11/5 영업 담당"', () => {
    renderCard({
      header: {
        ...header,
        mainPhoneSource: 'HOMEPAGE',
        mainPhoneSourceUrl: 'https://example.invalid/contact',
        mainPhoneConfirmedAt: '2026-11-05T10:00:00+09:00',
        mainPhoneConfirmedBy: 'staff-a',
      },
    });
    const source = screen.getByTestId('company-phone-source');
    expect(source).toHaveAttribute('href', 'https://example.invalid/contact');
    expect(source).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('company-phone-status')).toHaveTextContent(
      '담당자 확인 11/5 영업 담당',
    );
  });

  it('Given 대표명이 없는 회사 When 칸을 보면 Then "없음"과 [넣기]가 보이고, 있으면 이름 · 출처 · [고치기]가 보인다', () => {
    renderCard({ fix: { oppId: 'opp-1', onSaved: () => {} } });
    const empty = screen.getByTestId('company-representative');
    expect(empty).toHaveTextContent(companyFieldFixTexts.representativeLabel);
    expect(empty).toHaveTextContent(companyFieldFixTexts.none);
    expect(within(empty).getByTestId('company-representative-fix-button')).toHaveTextContent(
      companyFieldFixTexts.add,
    );
  });

  it('Given 공장등록 조회에서 온 대표명 When 칸을 보면 Then 이름과 "출처: 공장등록 조회"와 [고치기]가 보인다', () => {
    renderCard({
      header: { ...header, representativeName: '홍가상', representativeNameSource: 'REGISTRY' },
      fix: { oppId: 'opp-1', onSaved: () => {} },
    });
    const row = screen.getByTestId('company-representative');
    expect(within(row).getByTestId('company-representative-name')).toHaveTextContent('홍가상');
    expect(within(row).getByTestId('company-representative-source')).toHaveTextContent(
      '출처: 공장등록 조회',
    );
    expect(within(row).getByTestId('company-representative-fix-button')).toHaveTextContent(
      companyFieldFixTexts.edit,
    );
  });

  it('Given 대표번호 [고치기] When 누르면 Then 그 줄 아래에 입력칸이 열린다(모달 없음)', async () => {
    const user = userEvent.setup();
    renderCard({ fix: { oppId: 'opp-1', onSaved: () => {} } });
    await user.click(screen.getByTestId('company-phone-fix-button'));
    const edit = within(screen.getByTestId('company-phone')).getByTestId('company-phone-fix-edit');
    expect(
      within(edit).getByRole('textbox', { name: companyFieldFixTexts.phoneLabel }),
    ).toHaveValue('042-000-0000');
    // 휴대폰은 같은 칸의 "상대 담당자" 줄에 적으라고 안내한다.
    expect(edit).toHaveTextContent('"상대 담당자" 줄에 적어 주세요');
  });

  it('Given 고치기 값을 넘기지 않음(읽기만) · 값도 없음 When 칸을 보면 Then 대표번호 · 대표명 줄을 그리지 않는다', () => {
    renderCard({ header: { ...header, mainPhone: null } });
    expect(screen.queryByTestId('company-phone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('company-representative')).not.toBeInTheDocument();
    expect(screen.queryByTestId('company-phone-fix-button')).not.toBeInTheDocument();
  });

  it('Given 상대 담당자 한 명 When 칸을 보면 Then 대표번호 · 대표명 아래 "상대 담당자" 줄에 가린 이름 · 번호 · 보관 기한 · [+ 연락처 추가]가 있다', async () => {
    vi.mocked(getContacts).mockResolvedValue({
      data: {
        contacts: [
          {
            contactId: 'contact-1',
            personNameMasked: '김○○',
            role: '구매팀 과장',
            phoneMasked: '010-****-****',
            createdBy: 'staff-a',
            createdAt: '2026-11-28T01:00:00Z',
            retainUntil: '2027-11-28',
            retentionDue: false,
          },
        ],
      },
      meta: { updatedAt: '2026-11-28T01:00:00Z' },
    });
    renderCard({
      fix: { oppId: 'opp-1', onSaved: () => {} },
      children: <ContactPersons oppId="opp-1" />,
    });
    const card = screen.getByTestId('detail-contacts-card');
    const persons = within(card).getByTestId('detail-contact-persons');
    expect(persons).toHaveTextContent(contactPersonsTexts.personsRow);
    const row = await within(persons).findByTestId('contact-row');
    expect(row).toHaveTextContent('김○○');
    expect(row).toHaveTextContent('구매팀 과장');
    expect(within(row).getByTestId('contact-phone')).toHaveTextContent('010-****-****');
    expect(within(row).getByTestId('contact-reveal-button')).toBeEnabled();
    expect(within(row).getByTestId('contact-retain')).toHaveTextContent('보관 2027-11-28까지');
    expect(within(persons).getByTestId('contact-add-button')).toHaveTextContent('+ 연락처 추가');
    // 순서: 회사 대표번호 → 대표명 → 상대 담당자.
    const phone = within(card).getByTestId('company-phone');
    const representative = within(card).getByTestId('company-representative');
    expect(
      phone.compareDocumentPosition(representative) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      representative.compareDocumentPosition(persons) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('Given 보기 전용 계정 When 칸을 보면 Then 상대 담당자 줄은 목록을 부르지 않고 볼 수 없다고 알린다', () => {
    renderCard(
      { children: <ContactPersons oppId="opp-1" /> },
      { staffKey: 'viewer', canRecord: false },
    );
    expect(screen.getByTestId('contacts-hidden')).toHaveTextContent(
      contactPersonsTexts.viewerHidden,
    );
    expect(getContacts).not.toHaveBeenCalled();
  });
});
