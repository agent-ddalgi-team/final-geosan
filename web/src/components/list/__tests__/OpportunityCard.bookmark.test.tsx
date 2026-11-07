// 추천 카드의 [관심] 단추(#357): 카드 응답의 관심 값 표시 / 누르면 저장하고 상세로 넘어가지 않음 /
// 검토 의견을 저장하면(서버가 관심을 켬) 관심 값을 다시 읽어 맞춤 / 목록을 새로 받으면 서버 값을 따름.
// 서버 호출은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityCard from '../OpportunityCard';
import { getOpportunityDetail, postOpinion, putBookmark } from '../../../api/client';
import type {
  BookmarkRecord,
  Envelope,
  OpportunityCard as CardData,
  OpportunityDetail,
} from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import listFixture from '../../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getOpportunityDetail: vi.fn(),
  postOpinion: vi.fn(),
  putBookmark: vi.fn(),
}));

const mockedDetail = vi.mocked(getOpportunityDetail);
const mockedOpinion = vi.mocked(postOpinion);
const mockedPut = vi.mocked(putBookmark);
const apjeong = listFixture.data[0] as unknown as CardData;
const detail = detailFixture.data as unknown as OpportunityDetail;

function bookmark(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-06T01:00:00Z',
    active: true,
    ...overrides,
  };
}

function withBookmark(value: BookmarkRecord | null): CardData {
  return { ...apjeong, records: { ...apjeong.records, bookmark: value } };
}

function detailReply(value: BookmarkRecord | null): Envelope<OpportunityDetail> {
  return { data: { ...detail, records: { ...detail.records, bookmark: value } }, meta: {} };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function tree(card: CardData) {
  return (
    <MemoryRouter initialEntries={['/opportunities?process=ANODIZING']}>
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
        <OpportunityCard card={card} />
        <LocationProbe />
      </FrameContext.Provider>
    </MemoryRouter>
  );
}

describe('OpportunityCard [관심]', () => {
  beforeEach(() => {
    mockedDetail.mockReset();
    mockedOpinion.mockReset();
    mockedPut.mockReset();
  });

  it('카드 응답의 관심 값대로 "관심"(꺼짐) 또는 "관심 기업"(켜짐)으로 보인다', () => {
    const { unmount } = render(tree(withBookmark(null)));
    expect(screen.getByTestId('bookmark-button')).toHaveTextContent(/^관심$/);
    expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
    unmount();
    render(tree(withBookmark(bookmark())));
    expect(screen.getByTestId('bookmark-button')).toHaveTextContent(/^관심 기업$/);
    expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('[관심]을 누르면 이 회사의 관심을 켜고 단추가 "관심 기업"으로 바뀌며, 상세 화면으로 넘어가지 않는다', async () => {
    const user = userEvent.setup();
    mockedPut.mockResolvedValueOnce({ data: bookmark(), meta: {} });
    render(tree(withBookmark(null)));
    await user.click(screen.getByTestId('bookmark-button'));
    expect(mockedPut).toHaveBeenCalledWith(
      apjeong.oppId,
      { active: true, expectedVersion: null },
      'park-lee',
    );
    await waitFor(() =>
      expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.getByTestId('bookmark-button')).toHaveTextContent(/^관심 기업$/);
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/opportunities\?process=ANODIZING$/,
    );
  });

  it('카드에서 검토 의견을 저장하면 관심 값을 서버에서 다시 읽어 "관심 기업"으로 맞춘다 (자동 관심)', async () => {
    const user = userEvent.setup();
    mockedOpinion.mockResolvedValueOnce({
      data: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-06T01:00:00Z',
        opinion: 'WORTH_REVIEW',
      },
      meta: {},
    });
    mockedDetail.mockResolvedValueOnce(detailReply(bookmark({ updatedBy: 'park-lee' })));
    render(tree(withBookmark(null)));
    expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByTestId('opinion-worth-review-button'));
    await waitFor(() =>
      expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(mockedDetail).toHaveBeenCalledTimes(1);
    expect(mockedDetail.mock.calls[0][0]).toBe(apjeong.oppId);
    // 관심은 서버가 켠다. 화면이 따로 켜기 요청을 보내지 않는다.
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('의견 저장 뒤 관심 값을 다시 읽지 못하면 지금 표시를 그대로 둔다(켜진 것처럼 지어내지 않는다)', async () => {
    const user = userEvent.setup();
    mockedOpinion.mockResolvedValueOnce({
      data: {
        version: 1,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-06T01:00:00Z',
        opinion: 'NEED_CHECK',
      },
      meta: {},
    });
    mockedDetail.mockRejectedValueOnce(new Error('boom'));
    render(tree(withBookmark(null)));
    await user.click(screen.getByTestId('opinion-need-check-button'));
    await waitFor(() => expect(mockedDetail).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('opinion-saved-text')).toHaveTextContent('저장됨');
    expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('목록을 새로 받아 같은 회사의 카드 값이 바뀌면 화면에서 바꾼 값 대신 서버 값을 따른다', async () => {
    const user = userEvent.setup();
    mockedPut.mockResolvedValueOnce({ data: bookmark(), meta: {} });
    const { rerender } = render(tree(withBookmark(null)));
    await user.click(screen.getByTestId('bookmark-button'));
    await waitFor(() =>
      expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true'),
    );
    // 다른 담당자가 그 사이 관심을 껐고, 목록을 다시 불러와 새 카드 값이 왔다.
    rerender(tree(withBookmark(bookmark({ version: 2, active: false, updatedBy: 'kim-gwajang' }))));
    expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
  });
});
