// 검토사항 묶음·접기(#619): 줄이 많으면 "확인 필요"만 펼쳐 두고 "근거·자료가 없는 항목"과 "AI 공정 연결 제안"은 접어 둔다.
// 펼치면 원래 줄·단추가 그대로 나오고 체크·답·메모 저장도 그대로다. 전체 줄이 적으면 접지 않는다.
// 서버 호출(postReviewCheck·postQuestionReply·postNote)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewArea, { REVIEW_FOLD_MIN_TOTAL, processNameOf, reviewGroupOf } from '../ReviewArea';
import { postNote, postQuestionReply, postReviewCheck } from '../../../api/client';
import type { ConfigUi, ReviewItem } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { reviewArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postReviewCheck: vi.fn(),
  postQuestionReply: vi.fn(),
  postNote: vi.fn(),
}));

const mockedCheck = vi.mocked(postReviewCheck);
const mockedReply = vi.mocked(postQuestionReply);
const mockedNote = vi.mocked(postNote);

const SCORE_LABELS = [
  '소재와 보유 공정 일치',
  '납품 실적',
  '인증·규격',
  '생산 규모',
  '지역 접근성',
  '시점 신호',
  '외주 가능성',
  '산업 적합',
];
const PROCESS_NAMES = [
  '아연도금',
  '아노다이징',
  '니켈도금',
  '크롬도금',
  '인산염피막',
  '무전해니켈',
  '흑색산화',
];

function line(itemId: string, kind: ReviewItem['kind'], text: string): ReviewItem {
  return { itemId, kind, source: 'RULE', text, targetLabel: null, checked: false };
}

/** 조사 전 회사 예: 근거 없음 8 + 자료 못 찾음 2 + 공정 제안 7 = 17줄. */
function beforeResearchItems(): ReviewItem[] {
  return [
    line('GAP:HOMEPAGE', 'DATA_NOT_FOUND', '홈페이지를 찾지 못함'),
    line('GAP:EVIDENCE', 'DATA_NOT_FOUND', '확인할 근거 자료가 없음'),
    ...SCORE_LABELS.map((label, index) =>
      line(`GAP:ITEM:ITEM_${index}`, 'DATA_INSUFFICIENT', `${label} 근거 없음`),
    ),
    ...PROCESS_NAMES.map((name, index) =>
      line(
        `PL:PROC_${index}`,
        'PROCESS_LINK_PROPOSAL',
        `AI 공정 연결 제안 · ${name} · 근거: 인용 없음`,
      ),
    ),
  ];
}

const question = (id: string, text: string): ReviewItem => ({
  ...line(`Q:${id}`, 'QUESTION', text),
  targetLabel: '상대 회사',
});

const config = {
  staff: [{ key: 'park-lee', displayName: '박 이사' }],
} as unknown as ConfigUi;

function renderArea(items: ReviewItem[], onMemoSaved?: () => void) {
  render(
    <FrameContext.Provider
      value={{
        config,
        staffKey: 'park-lee',
        setStaffKey: () => {},
        canRecord: true,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <ReviewArea oppId="opp-1" evalId="eval-1" items={items} onMemoSaved={onMemoSaved} />
    </FrameContext.Provider>,
  );
}

describe('ReviewArea · 묶음과 접기 (#619)', () => {
  beforeEach(() => {
    mockedCheck.mockReset();
    mockedReply.mockReset();
    mockedNote.mockReset();
  });

  describe('조사 전 회사(17줄)', () => {
    it('처음에는 줄이 하나도 펼쳐져 있지 않고 접힌 머리 두 줄에 개수와 공정 이름이 보인다', () => {
      renderArea(beforeResearchItems());
      expect(screen.queryAllByTestId('review-item').length).toBeLessThanOrEqual(5);
      expect(screen.queryAllByTestId('review-item')).toHaveLength(0);
      expect(screen.getByTestId('review-ask-empty')).toHaveTextContent(reviewArea.askEmpty);
      expect(screen.queryByTestId('review-progress')).not.toBeInTheDocument();

      const gap = screen.getByTestId('review-fold-toggle-gap');
      expect(gap).toHaveTextContent('▸ 아직 근거·자료가 없는 항목 10개 보기');
      expect(gap).toHaveAttribute('aria-expanded', 'false');
      const process = screen.getByTestId('review-fold-toggle-process');
      expect(process).toHaveTextContent(
        '▸ AI 공정 연결 제안 7개 보기 · 아연도금, 아노다이징, 니켈도금 외 4개',
      );
      expect(process).toHaveAttribute('aria-expanded', 'false');
    });

    it('접힌 머리는 단추라 누르면 펼쳐지고 다시 누르면 접힌다. 펼치면 원래 줄과 단추가 모두 나온다', () => {
      renderArea(beforeResearchItems());
      const gapToggle = screen.getByTestId('review-fold-toggle-gap');
      expect(gapToggle.tagName).toBe('BUTTON');
      fireEvent.click(gapToggle);
      expect(gapToggle).toHaveAttribute('aria-expanded', 'true');
      expect(gapToggle).toHaveTextContent('▾ 아직 근거·자료가 없는 항목 10개 접기');

      const gapRows = within(screen.getByTestId('review-fold-gap')).getAllByTestId('review-item');
      expect(gapRows).toHaveLength(10);
      expect(within(gapRows[0]).getByTestId('review-text')).toHaveTextContent(
        '홈페이지를 찾지 못함',
      );
      expect(within(gapRows[2]).getByTestId('review-text')).toHaveTextContent(
        '소재와 보유 공정 일치 근거 없음',
      );
      for (const row of gapRows) {
        expect(within(row).getByTestId('review-checkbox')).toBeInTheDocument();
        expect(within(row).getByTestId('review-memo-button')).toHaveTextContent(reviewArea.memoAdd);
        expect(within(row).getByTestId('review-paste-button')).toBeInTheDocument();
      }

      fireEvent.click(screen.getByTestId('review-fold-toggle-process'));
      const processRows = within(screen.getByTestId('review-fold-process')).getAllByTestId(
        'review-item',
      );
      expect(processRows).toHaveLength(7);
      expect(within(processRows[0]).getByTestId('review-text')).toHaveTextContent(
        'AI 공정 연결 제안 · 아연도금 · 근거: 인용 없음',
      );
      for (const row of processRows) {
        expect(within(row).getByTestId('review-proposal-confirm')).toBeInTheDocument();
        expect(within(row).queryByTestId('review-checkbox')).not.toBeInTheDocument();
      }

      fireEvent.click(gapToggle);
      expect(gapToggle).toHaveAttribute('aria-expanded', 'false');
      expect(
        within(screen.getByTestId('review-fold-gap')).queryAllByTestId('review-item'),
      ).toHaveLength(0);
    });

    it('펼친 줄에서 체크하면 그 줄 번호와 평가 ID로 저장하고, 줄은 그 자리에 남는다', async () => {
      mockedCheck.mockResolvedValueOnce({
        data: {
          itemId: 'GAP:ITEM:ITEM_0',
          checked: true,
          checkedBy: 'park-lee',
          checkedAt: '2026-11-13T10:00:00+09:00',
        },
        meta: { updatedAt: '2026-11-13T10:00:00+09:00' },
      });
      renderArea(beforeResearchItems());
      fireEvent.click(screen.getByTestId('review-fold-toggle-gap'));
      const row = within(screen.getByTestId('review-fold-gap')).getAllByTestId('review-item')[2];
      fireEvent.click(within(row).getByTestId('review-checkbox'));

      await waitFor(() => expect(mockedCheck).toHaveBeenCalledTimes(1));
      expect(mockedCheck).toHaveBeenCalledWith(
        'opp-1',
        'GAP:ITEM:ITEM_0',
        { checked: true, evalId: 'eval-1' },
        'park-lee',
      );
      const after = await waitFor(() => {
        const rows = within(screen.getByTestId('review-fold-gap')).getAllByTestId('review-item');
        expect(within(rows[2]).getByTestId('review-checkbox')).toBeChecked();
        return rows;
      });
      expect(within(after[2]).getByTestId('review-checked-by')).toHaveTextContent(
        '박 이사 · 11/13 확인',
      );
      // 접어도 기록이 있다는 것이 머리 줄에 보인다.
      fireEvent.click(screen.getByTestId('review-fold-toggle-gap'));
      expect(screen.getByTestId('review-fold-toggle-gap')).toHaveTextContent('기록한 줄 1개');
    });

    it('펼친 줄에서 메모를 저장하면 줄 번호와 함께 보내고 줄 아래 "메모: …"가 보인다', async () => {
      const onMemoSaved = vi.fn();
      mockedNote.mockResolvedValueOnce({
        data: {
          version: 1,
          updatedBy: 'park-lee',
          updatedAt: '2026-11-13T10:00:00+09:00',
          noteId: 'note-1',
        },
        meta: { updatedAt: '2026-11-13T10:00:00+09:00' },
      });
      renderArea(beforeResearchItems(), onMemoSaved);
      fireEvent.click(screen.getByTestId('review-fold-toggle-gap'));
      const row = within(screen.getByTestId('review-fold-gap')).getAllByTestId('review-item')[0];
      fireEvent.click(within(row).getByTestId('review-memo-button'));
      fireEvent.change(screen.getByTestId('review-memo-input'), {
        target: { value: '블로그만 있음' },
      });
      fireEvent.click(screen.getByTestId('review-memo-save'));

      await waitFor(() => expect(mockedNote).toHaveBeenCalledTimes(1));
      expect(mockedNote).toHaveBeenCalledWith(
        'opp-1',
        { text: '블로그만 있음', kind: 'RESEARCH', itemId: 'GAP:HOMEPAGE', evalId: 'eval-1' },
        'park-lee',
      );
      expect(await screen.findByTestId('review-memo')).toHaveTextContent('메모: 블로그만 있음');
      expect(onMemoSaved).toHaveBeenCalledTimes(1);
    });

    it('펼친 공정 제안 줄의 [확정]은 그 줄 번호로 checked:true를 보낸다', async () => {
      mockedCheck.mockResolvedValueOnce({
        data: {
          itemId: 'PL:PROC_1',
          checked: true,
          checkedBy: 'park-lee',
          checkedAt: '2026-11-13T10:00:00+09:00',
        },
        meta: { updatedAt: '2026-11-13T10:00:00+09:00' },
      });
      renderArea(beforeResearchItems());
      fireEvent.click(screen.getByTestId('review-fold-toggle-process'));
      fireEvent.click(screen.getAllByTestId('review-proposal-confirm')[1]);
      await waitFor(() => expect(mockedCheck).toHaveBeenCalledTimes(1));
      expect(mockedCheck).toHaveBeenCalledWith(
        'opp-1',
        'PL:PROC_1',
        { checked: true, evalId: 'eval-1' },
        'park-lee',
      );
    });
  });

  describe('확인 필요 묶음', () => {
    const mixed = (): ReviewItem[] => [
      question('q-1', '납품 거래처를 알려 줄 수 있는지'),
      line('GAP:REQ:req-3', 'DATA_INSUFFICIENT', '내식성 시험: 시험 시간이 적혀 있지 않음'),
      {
        ...line(
          'FLAG:OWN_PLATING_LINE_SUSPECTED',
          'OWN_PLATING_LINE_SUSPECTED',
          '표면처리를 직접 하는 회사일 수 있음',
        ),
      },
      ...beforeResearchItems(),
    ];

    it('질문·표시·요구 조건 확인 줄은 처음부터 보이고 머리에 "확인 필요 0 / 3"이 보인다', () => {
      renderArea(mixed());
      expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 필요 0 / 3');
      const rows = screen.getAllByTestId('review-item');
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => within(row).getByTestId('review-text').textContent)).toEqual([
        '납품 거래처를 알려 줄 수 있는지',
        '내식성 시험: 시험 시간이 적혀 있지 않음',
        '표면처리를 직접 하는 회사일 수 있음',
      ]);
      expect(within(rows[0]).getByTestId('review-reply-button')).toBeInTheDocument();
      expect(screen.queryByTestId('review-ask-empty')).not.toBeInTheDocument();
    });

    it('체크·메모가 이미 달린 줄은 종류와 상관없이 "확인 필요"에 남고 접힌 묶음 개수에서 빠진다', () => {
      const items = beforeResearchItems();
      items[0] = {
        ...items[0],
        note: { text: '블로그만 있음', by: 'park-lee', at: '2026-11-12T10:00:00+09:00' },
      };
      items[3] = {
        ...items[3],
        checked: true,
        checkedBy: 'park-lee',
        checkedAt: '2026-11-12T10:00:00+09:00',
      };
      items[10] = {
        ...items[10],
        checked: true,
        checkedBy: 'park-lee',
        checkedAt: '2026-11-12T10:00:00+09:00',
      };
      renderArea(items);
      const rows = screen.getAllByTestId('review-item');
      expect(rows).toHaveLength(3);
      expect(within(rows[0]).getByTestId('review-memo')).toHaveTextContent('메모: 블로그만 있음');
      expect(within(rows[1]).getByTestId('review-checkbox')).toBeChecked();
      expect(within(rows[2]).getByTestId('review-checked-by')).toHaveTextContent(
        '박 이사 · 11/12 확인',
      );
      expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 필요 2 / 3');
      expect(screen.getByTestId('review-fold-toggle-gap')).toHaveTextContent('항목 8개 보기');
      expect(screen.getByTestId('review-fold-toggle-process')).toHaveTextContent('제안 6개 보기');
    });

    it('"확인 필요" 줄에서 답을 저장하면 질문 번호로 보내고 줄 아래 "답: …"이 보인다', async () => {
      mockedReply.mockResolvedValueOnce({
        data: {
          questionId: 'q-1',
          replyText: '현대 계열 2곳',
          repliedAt: '2026-11-13',
          repliedBy: 'park-lee',
        },
        meta: { updatedAt: '2026-11-13T10:00:00+09:00' },
      } as never);
      renderArea(mixed());
      fireEvent.click(screen.getByTestId('review-reply-button'));
      fireEvent.change(screen.getByTestId('review-reply-input'), {
        target: { value: '현대 계열 2곳' },
      });
      fireEvent.click(screen.getByTestId('review-reply-save'));
      await waitFor(() => expect(mockedReply).toHaveBeenCalledTimes(1));
      expect(mockedReply.mock.calls[0][0]).toBe('q-1');
      expect(mockedReply.mock.calls[0][1]).toMatchObject({ replyText: '현대 계열 2곳' });
      expect(await screen.findByTestId('review-reply')).toHaveTextContent('답: 현대 계열 2곳');
    });
  });

  describe('줄이 적을 때', () => {
    it(`전체 ${REVIEW_FOLD_MIN_TOTAL}줄 이하면 접지 않고 예전처럼 한 목록과 "확인 n / m"으로 보인다`, () => {
      const items = [
        question('q-1', '납품 거래처를 알려 줄 수 있는지'),
        ...beforeResearchItems().slice(0, 3),
        beforeResearchItems()[10],
      ];
      expect(items).toHaveLength(REVIEW_FOLD_MIN_TOTAL);
      renderArea(items);
      expect(screen.getAllByTestId('review-item')).toHaveLength(5);
      expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 0 / 5');
      expect(screen.queryByTestId('review-fold-toggle-gap')).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-fold-toggle-process')).not.toBeInTheDocument();
    });

    it('한 줄 더 많으면 접는다', () => {
      const items = [
        question('q-1', '납품 거래처를 알려 줄 수 있는지'),
        ...beforeResearchItems().slice(0, 4),
        beforeResearchItems()[10],
      ];
      renderArea(items);
      expect(screen.getAllByTestId('review-item')).toHaveLength(1);
      expect(screen.getByTestId('review-fold-toggle-gap')).toHaveTextContent('항목 4개 보기');
      expect(screen.getByTestId('review-fold-toggle-process')).toHaveTextContent(
        'AI 공정 연결 제안 1개 보기 · 아연도금',
      );
    });

    it('줄이 없으면 예전 그대로 "검토할 항목이 없습니다"가 보인다', () => {
      renderArea([]);
      expect(screen.getByTestId('review-empty')).toHaveTextContent(reviewArea.empty);
    });
  });

  describe('묶음 규칙', () => {
    it('점수 입력 제안은 "확인 필요", 공정 연결 제안은 접는 묶음이다', () => {
      expect(
        reviewGroupOf(line('II:NEW_MATERIAL', 'ITEM_INPUT_PROPOSAL', 'AI 제안 · 소재 — 일부 가능')),
      ).toBe('ask');
      expect(
        reviewGroupOf(line('PL:ZINC', 'PROCESS_LINK_PROPOSAL', 'AI 공정 연결 제안 · 아연도금')),
      ).toBe('process');
      expect(reviewGroupOf(line('GAP:REQ:r1', 'DATA_INSUFFICIENT', '요구: 이유'))).toBe('ask');
      expect(reviewGroupOf(line('GAP:ITEM:X', 'DATA_INSUFFICIENT', 'X 근거 없음'))).toBe('gap');
    });

    it('공정 이름은 서버 글 두 모양에서 꺼내고, 모르는 모양이면 이름 없이 개수만 보인다', () => {
      expect(
        processNameOf(
          line('PL:A', 'PROCESS_LINK_PROPOSAL', 'AI 공정 연결 제안 · 아연도금 · 근거: 인용 없음'),
        ),
      ).toBe('아연도금');
      expect(
        processNameOf(
          line(
            'PL:B',
            'PROCESS_LINK_PROPOSAL',
            "AI 제안 · 공정 연결 — 아연도금(전기아연도금) · 근거: '사양'",
          ),
        ),
      ).toBe('아연도금(전기아연도금)');
      expect(processNameOf(line('PL:C', 'PROCESS_LINK_PROPOSAL', '다른 모양의 글'))).toBeNull();

      const items = beforeResearchItems().map((item) =>
        item.kind === 'PROCESS_LINK_PROPOSAL' ? { ...item, text: '다른 모양의 글' } : item,
      );
      renderArea(items);
      expect(screen.getByTestId('review-fold-toggle-process').textContent).toBe(
        '▸ AI 공정 연결 제안 7개 보기',
      );
    });
  });
});
