// 검토사항 자료 줄의 [붙여넣고 조사](#260): 자료 줄에만 단추, 인라인 입력, 조사 요청 본문(url + pastedText),
// 성공 안내·새로 불러오기, kind별 실패 모양, 잠금. 서버 호출(postHomepage)은 가짜로 바꾼 확인이며
// 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewArea from '../ReviewArea';
import { ApiError, postHomepage } from '../../../api/client';
import type { ConfigUi, Envelope, HomepageResearchResponse, ReviewItem } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { reviewArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postHomepage: vi.fn(),
}));

const mockedHomepage = vi.mocked(postHomepage);

const items: ReviewItem[] = [
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
  },
  {
    itemId: 'FLAG:OWN_PLATING_LINE_SUSPECTED',
    kind: 'OWN_PLATING_LINE_SUSPECTED',
    source: 'AI',
    text: '표면처리를 직접 하는 회사일 수 있음',
    targetLabel: null,
    checked: false,
  },
];

const config = {
  staff: [{ key: 'park-lee', displayName: '박 이사' }],
} as unknown as ConfigUi;

const researched: Envelope<HomepageResearchResponse> = {
  data: { evidenceCount: 2, requirementCandidateCount: 1, questionCount: 1, evalId: 'eval-2' },
  meta: { updatedAt: '2026-11-10T10:00:00+09:00' },
};

function renderArea(
  overrides: {
    staffKey?: string | null;
    canRecord?: boolean;
    homepageUrl?: string | null;
    onResearched?: () => void;
  } = {},
) {
  const { staffKey = 'park-lee', canRecord = true, homepageUrl = null } = overrides;
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
        evalId="eval-1"
        items={items}
        homepageUrl={homepageUrl}
        onResearched={overrides.onResearched}
      />
    </FrameContext.Provider>,
  );
}

function openFirstGap() {
  fireEvent.click(screen.getAllByTestId('review-paste-button')[0]);
}

function fillAndSubmit(url: string, text: string) {
  fireEvent.change(screen.getByTestId('review-paste-url'), { target: { value: url } });
  fireEvent.change(screen.getByTestId('review-paste-text'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('review-paste-submit'));
}

describe('ReviewArea [붙여넣고 조사]', () => {
  beforeEach(() => {
    mockedHomepage.mockReset();
  });

  it('자료 못 찾음·자료 부족 줄에만 단추가 있고 질문 줄·다른 줄에는 없다', () => {
    renderArea();
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[0]).queryByTestId('review-paste-button')).toBeNull();
    expect(within(rows[1]).getByTestId('review-paste-button')).toHaveTextContent(
      reviewArea.pasteButton,
    );
    expect(within(rows[2]).getByTestId('review-paste-button')).toBeInTheDocument();
    expect(within(rows[3]).queryByTestId('review-paste-button')).toBeNull();
  });

  it('누르면 그 줄 아래에 인라인 입력이 열리고 공개 자료만 된다는 안내가 보인다', () => {
    renderArea();
    openFirstGap();
    const rows = screen.getAllByTestId('review-item');
    const editor = within(rows[1]).getByTestId('review-paste-editor');
    expect(within(editor).getByTestId('review-paste-hint')).toHaveTextContent('공개 자료만 됩니다');
    expect(screen.getAllByTestId('review-paste-editor')).toHaveLength(1);
  });

  it('확정된 홈페이지 주소가 있으면 출처 칸에 미리 채우고 없으면 빈 칸이다', () => {
    renderArea({ homepageUrl: 'https://kofas.com/' });
    openFirstGap();
    expect(screen.getByTestId('review-paste-url')).toHaveValue('https://kofas.com/');
  });

  it('한 번에 한 줄만 열린다', () => {
    renderArea();
    const buttons = screen.getAllByTestId('review-paste-button');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[1]).queryByTestId('review-paste-editor')).toBeNull();
    expect(within(rows[2]).getByTestId('review-paste-editor')).toBeInTheDocument();
  });

  it('[조사]를 누르면 조사 요청에 url과 pastedText를 담아 보내고 성공하면 안내와 함께 새로 불러오게 알린다', async () => {
    mockedHomepage.mockResolvedValueOnce(researched);
    const onResearched = vi.fn();
    renderArea({ onResearched });
    openFirstGap();
    fillAndSubmit('https://kofas.com/about', '2023년 자동차 부품 납품 실적');

    await waitFor(() => expect(onResearched).toHaveBeenCalledTimes(1));
    expect(mockedHomepage).toHaveBeenCalledWith(
      'opp-1',
      { url: 'https://kofas.com/about', pastedText: '2023년 자동차 부품 납품 실적' },
      'park-lee',
    );
    expect(screen.getByTestId('review-paste-notice')).toHaveTextContent(
      '근거 2건(확인 필요 1건 포함)·질문 1건 저장, 재평가 완료',
    );
    expect(screen.queryByTestId('review-paste-editor')).toBeNull();
  });

  it('조사가 끝나도 체크는 자동으로 바뀌지 않는다', async () => {
    mockedHomepage.mockResolvedValueOnce(researched);
    renderArea();
    openFirstGap();
    fillAndSubmit('https://kofas.com/about', '본문');
    await waitFor(() => expect(screen.getByTestId('review-paste-notice')).toBeInTheDocument());
    for (const box of screen.getAllByTestId('review-checkbox')) {
      expect(box).not.toBeChecked();
    }
  });

  it('출처 주소가 http(s)가 아니거나 본문이 비면 요청을 보내지 않고 안내한다', () => {
    renderArea();
    openFirstGap();
    fillAndSubmit('kofas.com', '본문');
    expect(screen.getByTestId('review-paste-input-error')).toHaveTextContent(
      reviewArea.pasteInvalidUrl,
    );
    fillAndSubmit('https://kofas.com/', '   ');
    expect(screen.getByTestId('review-paste-input-error')).toHaveTextContent(reviewArea.pasteEmpty);
    expect(mockedHomepage).not.toHaveBeenCalled();
  });

  it('조사하는 동안 진행 문구가 보이고 다른 줄의 [붙여넣고 조사]도 잠긴다', async () => {
    let finish: (value: Envelope<HomepageResearchResponse>) => void = () => {};
    mockedHomepage.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderArea();
    openFirstGap();
    fillAndSubmit('https://kofas.com/', '본문');

    expect(await screen.findByTestId('review-paste-running')).toBeInTheDocument();
    for (const button of screen.getAllByTestId('review-paste-button')) {
      expect(button).toBeDisabled();
    }
    finish(researched);
    await waitFor(() => expect(screen.queryByTestId('review-paste-running')).toBeNull());
  });

  it('한도 초과(LLM_LIMIT) 실패는 서버 문구를 보이고 [조사] 단추를 잠근다', async () => {
    mockedHomepage.mockRejectedValueOnce(
      new ApiError(503, {
        message: '이번 달 AI 조사 한도를 넘었습니다.',
        nextAction: '다음 달에 다시 시도하세요.',
        ref: 'r-77',
        kind: 'LLM_LIMIT',
      }),
    );
    renderArea();
    openFirstGap();
    fillAndSubmit('https://kofas.com/', '본문');

    expect(await screen.findByTestId('review-paste-error-message')).toHaveTextContent(
      '이번 달 AI 조사 한도를 넘었습니다. 다음 달에 다시 시도하세요.',
    );
    expect(screen.getByTestId('review-paste-locked')).toBeInTheDocument();
    expect(screen.getByTestId('review-paste-error-ref')).toHaveTextContent('r-77');
    expect(screen.getByTestId('review-paste-submit')).toBeDisabled();
  });

  it('붙여넣기 안내 실패(ROBOTS_DISALLOW 등)와 연결 실패는 단추를 잠그지 않아 다시 시도할 수 있다', async () => {
    mockedHomepage.mockRejectedValueOnce(
      new ApiError(504, {
        message: '시간이 초과되었습니다.',
        nextAction: '다시 시도',
        ref: '',
        kind: 'TIMEOUT',
      }),
    );
    renderArea();
    openFirstGap();
    fillAndSubmit('https://kofas.com/', '본문');

    expect(await screen.findByTestId('review-paste-error')).toBeInTheDocument();
    expect(screen.queryByTestId('review-paste-locked')).toBeNull();
    expect(screen.getByTestId('review-paste-submit')).toBeEnabled();
  });

  it('그 사이 정보가 바뀐 실패(STALE_VALUE)는 [새로 불러오기]를 보이고 누르면 새로 불러오게 알린다', async () => {
    mockedHomepage.mockRejectedValueOnce(
      new ApiError(409, {
        message: '그 사이 정보가 바뀌었습니다.',
        nextAction: '새로 불러온 뒤 다시 시도하세요.',
        ref: '',
        kind: 'STALE_VALUE',
      }),
    );
    const onResearched = vi.fn();
    renderArea({ onResearched });
    openFirstGap();
    fillAndSubmit('https://kofas.com/', '본문');

    fireEvent.click(await screen.findByTestId('review-paste-reload'));
    expect(onResearched).toHaveBeenCalledTimes(1);
  });

  it('네트워크 오류는 기본 문구로 보인다', async () => {
    mockedHomepage.mockRejectedValueOnce(new Error('boom'));
    renderArea();
    openFirstGap();
    fillAndSubmit('https://kofas.com/', '본문');
    expect(await screen.findByTestId('review-paste-error')).toBeInTheDocument();
  });

  it('담당자를 고르지 않았거나 보기 전용이면 단추가 잠긴다', () => {
    renderArea({ canRecord: false, staffKey: null });
    for (const button of screen.getAllByTestId('review-paste-button')) {
      expect(button).toBeDisabled();
    }
  });

  it('취소하면 입력이 닫힌다', () => {
    renderArea();
    openFirstGap();
    fireEvent.click(screen.getByTestId('review-paste-cancel'));
    expect(screen.queryByTestId('review-paste-editor')).toBeNull();
    expect(mockedHomepage).not.toHaveBeenCalled();
  });
});
