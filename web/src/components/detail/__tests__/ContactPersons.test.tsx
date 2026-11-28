// #980(PM 결정 2026-11-28): 상세 [상대 담당자 연락처]. 가린 값만 보이고 확인 문구 체크 뒤에만 연다.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버는 tests/unit/u3/test_contact_persons.py).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactPersons from '../ContactPersons';
import {
  deleteContact,
  getContacts,
  keepContact,
  postContact,
  revealContact,
  updateContact,
} from '../../../api/client';
import type { ContactPersonView } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getContacts: vi.fn(),
  postContact: vi.fn(),
  updateContact: vi.fn(),
  revealContact: vi.fn(),
  deleteContact: vi.fn(),
  keepContact: vi.fn(),
}));

const CONTACT: ContactPersonView = {
  contactId: 'contact-1',
  personNameMasked: '김○○',
  role: '구매팀 과장',
  phoneMasked: '010-****-****',
  createdBy: 'park-lee',
  createdAt: '2026-11-28T01:00:00Z',
  retainUntil: '2027-11-28',
  retentionDue: false,
};

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

function renderContacts(value = frame(), onChanged = vi.fn()) {
  render(
    <FrameContext.Provider value={value}>
      <ContactPersons oppId="opp-1" onChanged={onChanged} />
    </FrameContext.Provider>,
  );
  return onChanged;
}

function listed(contacts: ContactPersonView[]) {
  vi.mocked(getContacts).mockResolvedValue({ data: { contacts }, meta: {} });
}

beforeEach(() => {
  for (const fn of [getContacts, postContact, updateContact, revealContact, deleteContact]) {
    vi.mocked(fn).mockReset();
  }
  vi.mocked(keepContact).mockReset();
});

describe('상세 › 상대 담당자 연락처 (#980)', () => {
  it('Given 적어 둔 연락처 When 열면 Then 가린 이름·번호만 보이고 원래 값은 없다', async () => {
    listed([CONTACT]);
    renderContacts();
    expect(await screen.findByTestId('contact-name')).toHaveTextContent('김○○');
    expect(screen.getByTestId('contact-phone')).toHaveTextContent('010-****-****');
    expect(screen.getByTestId('contacts')).not.toHaveTextContent('1234');
    expect(getContacts).toHaveBeenCalledWith('opp-1', 'park-lee', expect.anything());
  });

  it('Given 보기 전용 계정 When 열면 Then 목록을 부르지 않고 볼 수 없다고 알린다', () => {
    renderContacts(frame({ canRecord: false, staffKey: 'viewer' }));
    expect(screen.getByTestId('contacts-hidden')).toHaveTextContent('보기 전용 계정은');
    expect(getContacts).not.toHaveBeenCalled();
  });

  it('Given 가린 연락처 When [보기] Then 확인 문구에 체크해야 열리고, 열면 원래 번호가 보인다', async () => {
    const user = userEvent.setup();
    listed([CONTACT]);
    vi.mocked(revealContact).mockResolvedValueOnce({
      data: {
        contactId: 'contact-1',
        personName: '김철수',
        role: '구매팀 과장',
        phone: '010-1234-5678',
      },
      meta: {},
    });
    renderContacts();
    await user.click(await screen.findByTestId('contact-reveal-button'));
    expect(screen.getByTestId('contact-reveal-confirm')).toHaveTextContent(
      '영업 목적으로만 쓰고 밖으로 옮기지 않겠습니다',
    );
    expect(screen.getByTestId('contact-reveal-open-button')).toBeDisabled();
    await user.click(screen.getByTestId('contact-reveal-ack'));
    await user.click(screen.getByTestId('contact-reveal-open-button'));
    expect(revealContact).toHaveBeenCalledWith('opp-1', 'contact-1', 'park-lee');
    expect(await screen.findByTestId('contact-name')).toHaveTextContent('김철수');
    expect(screen.getByTestId('contact-phone')).toHaveTextContent('010-1234-5678');
    // [다시 가리기]를 누르면 가린 값으로 돌아간다.
    await user.click(screen.getByTestId('contact-hide'));
    expect(screen.getByTestId('contact-phone')).toHaveTextContent('010-****-****');
  });

  it('Given 열지 않은 연락처 When 보면 Then [고치기]는 잠겨 있다', async () => {
    listed([CONTACT]);
    renderContacts();
    expect(await screen.findByTestId('contact-edit-button')).toBeDisabled();
  });

  it('Given 빈 목록 When [연락처 추가] 후 저장 Then 서버에 보내고 목록과 활동 이력을 다시 읽는다', async () => {
    const user = userEvent.setup();
    listed([]);
    vi.mocked(postContact).mockResolvedValueOnce({ data: { contact: CONTACT }, meta: {} });
    const onChanged = renderContacts();
    expect(await screen.findByTestId('contacts-empty')).toBeInTheDocument();
    await user.click(screen.getByTestId('contact-add-button'));
    expect(screen.getByTestId('contact-save-button')).toBeDisabled();
    await user.type(screen.getByTestId('contact-name-input'), '김철수');
    await user.type(screen.getByTestId('contact-phone-input'), '010-1234-5678');
    await user.click(screen.getByTestId('contact-save-button'));
    expect(postContact).toHaveBeenCalledWith(
      'opp-1',
      { personName: '김철수', role: null, phone: '010-1234-5678' },
      'park-lee',
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(getContacts).toHaveBeenCalledTimes(2));
  });

  it('Given 보관 기한이 다가온 연락처 When 보면 Then [1년 더 보관]·[지우기]가 있고 지우기는 보관 이유로 보낸다', async () => {
    const user = userEvent.setup();
    listed([{ ...CONTACT, retentionDue: true }]);
    vi.mocked(keepContact).mockResolvedValueOnce({ data: { contact: CONTACT }, meta: {} });
    vi.mocked(deleteContact).mockResolvedValueOnce({
      data: { contactId: 'contact-1', deletedAt: '2026-11-28T02:00:00Z' },
      meta: {},
    });
    renderContacts();
    expect(await screen.findByTestId('contact-retention-due')).toHaveTextContent('보관 1년');
    await user.click(screen.getByTestId('contact-keep'));
    expect(keepContact).toHaveBeenCalledWith('opp-1', 'contact-1', 'park-lee');
    await user.click(await screen.findByTestId('contact-delete'));
    // 확인 말풍선의 [지우기](줄의 [지우기]와 이름이 같아 마지막 것).
    const confirm = await screen.findAllByRole('button', { name: '지우기' });
    await user.click(confirm[confirm.length - 1]!);
    await waitFor(() =>
      expect(deleteContact).toHaveBeenCalledWith('opp-1', 'contact-1', 'RETENTION', 'park-lee'),
    );
  });
});
