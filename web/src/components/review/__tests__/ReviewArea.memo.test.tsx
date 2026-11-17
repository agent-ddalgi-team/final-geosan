// 검토사항 자료 줄의 [메모 적기](#260): 자료 줄에만 단추, 인라인 입력(500자), 저장 요청 본문(kind RESEARCH + itemId),
// "메모: …" 표시와 링크, [메모 고치기], 실패 문구, 잠금. 서버 호출(postNote)은 가짜로 바꾼 확인이며
// 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewArea from '../ReviewArea';
import { linkifyMemo } from '../GapMemoEditor';
import { ApiError, postNote } from '../../../api/client';
import type { ConfigUi, Envelope, NoteResponse, ReviewItem } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { reviewArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postNote: vi.fn(),
}));

const mockedNote = vi.mocked(postNote);

const baseItems: ReviewItem[] = [
  {
    itemId: 'Q:q-1',
    kind: 'QUESTION',
    source: 'AI',
    text: '납품 거래처를 알려 줄 수 있는지',
    targetLabel: '상대 회사',
    checked: false,
  },
  {
    itemId: 'GAP:HOMEPAGE',
    kind: 'DATA_NOT_FOUND',
    source: 'RULE',
    text: '홈페이지를 찾지 못함',
    targetLabel: null,
    checked: false,
  },
  {
    itemId: 'GAP:ITEM:NEW_RECORD',
    kind: 'DATA_INSUFFICIENT',
    source: 'RULE',
    text: '납품 실적 근거 없음',
    targetLabel: null,
    checked: false,
    note: {
      text: '홈페이지 연혁에 2023 납품 기재 https://example.test/history.',
      by: 'park-lee',
      at: '2026-11-20T10:00:00+09:00',
    },
  },
];

const config = {
  staff: [{ key: 'park-lee', displayName: '박 이사' }],
} as unknown as ConfigUi;

const saved: Envelope<NoteResponse> = {
  data: {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-21T09:00:00+09:00',
    noteId: 'note-9',
  },
  meta: { updatedAt: '2026-11-21T09:00:00+09:00' },
};

function renderArea(
  overrides: {
    staffKey?: string | null;
    canRecord?: boolean;
    evalId?: string | null;
    items?: ReviewItem[];
    onMemoSaved?: () => void;
  } = {},
) {
  const { staffKey = 'park-lee', canRecord = true, evalId = 'eval-1' } = overrides;
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
      <ReviewArea
        oppId="opp-1"
        evalId={evalId}
        items={overrides.items ?? baseItems}
        onMemoSaved={overrides.onMemoSaved}
      />
    </FrameContext.Provider>,
  );
}

describe('ReviewArea [메모 적기]', () => {
  beforeEach(() => {
    mockedNote.mockReset();
  });

  it('자료 줄에만 단추가 있고 질문 줄에는 없다. 메모가 있는 줄은 [메모 고치기]다', () => {
    renderArea();
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[0]).queryByTestId('review-memo-button')).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId('review-memo-button')).toHaveTextContent(reviewArea.memoAdd);
    expect(within(rows[2]).getByTestId('review-memo-button')).toHaveTextContent(
      reviewArea.memoEdit,
    );
  });

  it('메모가 있으면 "메모: …"과 "박 이사 · 11/20"이 보이고 주소는 새 창 링크다(끝 마침표는 뺀다)', () => {
    renderArea();
    const memo = screen.getByTestId('review-memo');
    expect(memo).toHaveTextContent('메모: 홈페이지 연혁에 2023 납품 기재');
    expect(within(memo).getByTestId('review-memo-by')).toHaveTextContent('박 이사 · 11/20');
    const link = within(memo).getByRole('link', { name: 'https://example.test/history' });
    expect(link).toHaveAttribute('href', 'https://example.test/history');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('누르면 줄 아래에 인라인 입력이 열리고(창 없음, 500자) [취소]로 닫힌다', () => {
    renderArea();
    fireEvent.click(screen.getAllByTestId('review-memo-button')[0]);
    const editor = screen.getByTestId('review-memo-editor');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(editor).getByTestId('review-memo-input')).toHaveAttribute('maxlength', '500');
    expect(within(editor).getByTestId('review-memo-counter')).toHaveTextContent('0 / 500자');
    fireEvent.click(within(editor).getByTestId('review-memo-cancel'));
    expect(screen.queryByTestId('review-memo-editor')).not.toBeInTheDocument();
    expect(mockedNote).not.toHaveBeenCalled();
  });

  it('글이 비어 있으면 [메모 저장]이 막혀 있다', () => {
    renderArea();
    fireEvent.click(screen.getAllByTestId('review-memo-button')[0]);
    expect(screen.getByTestId('review-memo-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('review-memo-input'), { target: { value: '   ' } });
    expect(screen.getByTestId('review-memo-save')).toBeDisabled();
  });

  it('저장하면 종류 RESEARCH·줄 번호·평가 번호로 보내고, 줄 아래 "메모: …"로 바뀌고, 활동 이력을 새로 읽게 알린다', async () => {
    const onMemoSaved = vi.fn();
    mockedNote.mockResolvedValueOnce(saved);
    renderArea({ onMemoSaved });
    fireEvent.click(screen.getAllByTestId('review-memo-button')[0]);
    fireEvent.change(screen.getByTestId('review-memo-input'), {
      target: { value: '  공고에는 있음 https://example.test/notice  ' },
    });
    fireEvent.click(screen.getByTestId('review-memo-save'));

    await waitFor(() => expect(mockedNote).toHaveBeenCalledTimes(1));
    expect(mockedNote).toHaveBeenCalledWith(
      'opp-1',
      {
        text: '공고에는 있음 https://example.test/notice',
        kind: 'RESEARCH',
        itemId: 'GAP:HOMEPAGE',
        evalId: 'eval-1',
      },
      'park-lee',
    );
    await waitFor(() => expect(screen.queryByTestId('review-memo-editor')).not.toBeInTheDocument());
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[1]).getByTestId('review-memo')).toHaveTextContent(
      '메모: 공고에는 있음 https://example.test/notice',
    );
    expect(within(rows[1]).getByTestId('review-memo-by')).toHaveTextContent('박 이사 · 11/21');
    expect(within(rows[1]).getByTestId('review-memo-button')).toHaveTextContent(
      reviewArea.memoEdit,
    );
    expect(onMemoSaved).toHaveBeenCalledTimes(1);
    // 기록용이라 체크는 자동으로 바뀌지 않는다.
    expect(within(rows[1]).getByTestId('review-checkbox')).not.toBeChecked();
  });

  it('[메모 고치기]는 지금 메모를 미리 채우고 저장하면 최신 글로 바뀐다', async () => {
    mockedNote.mockResolvedValueOnce(saved);
    renderArea();
    fireEvent.click(screen.getAllByTestId('review-memo-button')[1]);
    const input = screen.getByTestId('review-memo-input') as HTMLTextAreaElement;
    expect(input.value).toBe('홈페이지 연혁에 2023 납품 기재 https://example.test/history.');
    // 입력이 열려 있는 동안에는 줄 아래 기존 메모를 따로 보이지 않는다.
    expect(screen.queryByTestId('review-memo')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '정정: 2022년 납품' } });
    fireEvent.click(screen.getByTestId('review-memo-save'));
    await waitFor(() =>
      expect(screen.getByTestId('review-memo')).toHaveTextContent('메모: 정정: 2022년 납품'),
    );
    expect(mockedNote).toHaveBeenCalledWith(
      'opp-1',
      expect.objectContaining({ itemId: 'GAP:ITEM:NEW_RECORD', kind: 'RESEARCH' }),
      'park-lee',
    );
  });

  it('평가 번호가 없으면 요청에 평가 번호를 넣지 않는다', async () => {
    mockedNote.mockResolvedValueOnce(saved);
    renderArea({ evalId: null });
    fireEvent.click(screen.getAllByTestId('review-memo-button')[0]);
    fireEvent.change(screen.getByTestId('review-memo-input'), { target: { value: '메모' } });
    fireEvent.click(screen.getByTestId('review-memo-save'));
    await waitFor(() => expect(mockedNote).toHaveBeenCalledTimes(1));
    expect(mockedNote.mock.calls[0][1]).toEqual({
      text: '메모',
      kind: 'RESEARCH',
      itemId: 'GAP:HOMEPAGE',
    });
  });

  it('저장이 실패하면 서버 문구와 함께 알리고 적은 글은 그대로 둔다. 알림은 보내지 않는다', async () => {
    const onMemoSaved = vi.fn();
    mockedNote.mockRejectedValueOnce(
      new ApiError(404, {
        message: '그 검토사항 줄이 없습니다',
        nextAction: '새로 불러오세요',
        ref: 'r-404',
      }),
    );
    renderArea({ onMemoSaved });
    fireEvent.click(screen.getAllByTestId('review-memo-button')[0]);
    fireEvent.change(screen.getByTestId('review-memo-input'), { target: { value: '적은 글' } });
    fireEvent.click(screen.getByTestId('review-memo-save'));
    const alert = await screen.findByTestId('review-memo-error');
    expect(alert).toHaveTextContent(reviewArea.memoSaveFailed);
    expect(alert).toHaveTextContent('그 검토사항 줄이 없습니다');
    expect((screen.getByTestId('review-memo-input') as HTMLTextAreaElement).value).toBe('적은 글');
    expect(screen.getByTestId('review-memo-save')).toBeEnabled();
    expect(onMemoSaved).not.toHaveBeenCalled();
  });

  it('담당자를 안 골랐거나 기록할 수 없으면 단추가 잠긴다', () => {
    renderArea({ staffKey: null, canRecord: false });
    for (const button of screen.getAllByTestId('review-memo-button')) {
      expect(button).toBeDisabled();
    }
  });

  it('한 번에 한 줄만 입력이 열린다', () => {
    renderArea();
    const buttons = screen.getAllByTestId('review-memo-button');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(screen.getAllByTestId('review-memo-editor')).toHaveLength(1);
  });
});

describe('linkifyMemo', () => {
  it('http(s) 주소만 링크로 만들고 끝의 문장부호는 주소에서 뺀다', () => {
    const parts = linkifyMemo(
      '보기 (https://a.test/x), 그리고 ftp://b.test 와 javascript:alert(1)',
    );
    const links = parts.filter((part) => typeof part !== 'string');
    expect(links).toHaveLength(1);
    expect(JSON.stringify(parts)).toContain('https://a.test/x');
    expect(JSON.stringify(parts)).not.toContain('"href":"ftp');
    expect(JSON.stringify(parts)).not.toContain('"href":"javascript');
  });
});
