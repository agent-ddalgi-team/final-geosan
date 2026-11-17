// 거래 관계 줄(#266): 세 상태 표시 / 단추 → 요청 본문 / 성공 뒤 새로 불러오기 / 잠금 / 409·그 밖 오류.
// 서버 호출(postRelation)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RelationControl from '../RelationControl';
import { ApiError, postRelation } from '../../../api/client';
import type { RelationStatus } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { relationControl } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postRelation: vi.fn(),
}));

const mockedPost = vi.mocked(postRelation);
const OPP = 'opp-1';
const EVAL = 'eval-1';

function frameValue(overrides: Partial<FrameValue> = {}): FrameValue {
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

function renderControl(
  props: {
    status?: RelationStatus;
    evalId?: string | null;
    note?: string | null;
    confirmedAt?: string | null;
    confirmedBy?: string | null;
    value?: FrameValue;
    onChanged?: () => void;
  } = {},
) {
  const onChanged = props.onChanged ?? vi.fn();
  render(
    <FrameContext.Provider value={props.value ?? frameValue()}>
      <RelationControl
        oppId={OPP}
        evalId={props.evalId === undefined ? EVAL : props.evalId}
        status={props.status ?? 'UNCONFIRMED'}
        note={props.note}
        confirmedAt={props.confirmedAt}
        confirmedBy={props.confirmedBy}
        onChanged={onChanged}
      />
    </FrameContext.Provider>,
  );
  return onChanged;
}

function apiError(status: number, message: string, kind?: string) {
  return new ApiError(status, { message, nextAction: '다시 시도', ref: 'x', kind });
}

describe('RelationControl', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  it.each([
    ['UNCONFIRMED', '거래 관계: 확인 전', ['NEW_CONFIRMED', 'EXISTING_CONFIRMED']],
    ['EXISTING_CONFIRMED', '거래 관계: 거래 중', ['NEW_CONFIRMED', 'UNCONFIRMED']],
    ['NEW_CONFIRMED', '거래 관계: 거래 없음', ['EXISTING_CONFIRMED', 'UNCONFIRMED']],
  ] as const)('%s 상태: 지금 상태 글자와 나머지 두 단추만 보인다', (status, text, buttons) => {
    renderControl({ status });
    expect(screen.getByTestId('detail-relation-text')).toHaveTextContent(text);
    for (const value of buttons) {
      expect(screen.getByTestId(`relation-button-${value}`)).toHaveTextContent(
        relationControl.action[value],
      );
    }
    expect(screen.queryByTestId(`relation-button-${status}`)).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-relation-hint')).toHaveTextContent(relationControl.hint);
  });

  it('바꾼 사람 이름·날짜와 지난 접촉 요약이 상태 옆에 보인다', () => {
    renderControl({
      status: 'EXISTING_CONFIRMED',
      confirmedAt: '2026-11-20',
      confirmedBy: 'park-lee',
      note: '기존 (2024년 아연도금 견적)',
    });
    const text = screen.getByTestId('detail-relation-text');
    expect(text).toHaveTextContent('거래 관계: 거래 중 · park-lee · 11/20');
    expect(text).toHaveTextContent('기존 (2024년 아연도금 견적)');
  });

  it('[거래 중]을 누르면 선택한 값과 본 평가 ID를 보내고 성공하면 새로 불러오게 한다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce({
      data: {
        relationStatus: 'EXISTING_CONFIRMED',
        relationConfirmedAt: '2026-11-05',
        relationConfirmedBy: 'park-lee',
        evalId: 'eval-2',
      },
      meta: { reevaluated: true },
    });
    const onChanged = renderControl();
    await user.click(screen.getByTestId('relation-button-EXISTING_CONFIRMED'));
    expect(mockedPost).toHaveBeenCalledWith(
      OPP,
      { relationStatus: 'EXISTING_CONFIRMED', evalId: EVAL },
      'park-lee',
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('detail-relation-error')).not.toBeInTheDocument();
  });

  it.each([
    ['담당자를 고르기 전', { canRecord: false, staffKey: null }, EVAL],
    ['보기 전용', { canRecord: false, staffKey: 'viewer' }, EVAL],
    ['평가 전(본 평가 ID 없음)', {}, null],
  ])('%s에는 단추가 잠겨 서버를 부르지 않는다', async (_name, frame, evalId) => {
    const user = userEvent.setup();
    renderControl({ value: frameValue(frame), evalId });
    for (const value of ['NEW_CONFIRMED', 'EXISTING_CONFIRMED']) {
      const button = screen.getByTestId(`relation-button-${value}`);
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('담당자를 고르기 전에는 고르라는 안내가 보인다', () => {
    renderControl({ value: frameValue({ canRecord: false, staffKey: null }) });
    expect(screen.getByTestId('detail-relation-hint')).toHaveTextContent(
      relationControl.pickStaffFirst,
    );
  });

  it('409(그 사이 다시 평가됨)면 새로 불러오라고 안내하고 [새로 불러오기]가 상세를 다시 읽게 한다', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValueOnce(apiError(409, '다시 평가되었습니다.', 'STALE_EVALUATION'));
    const onChanged = renderControl();
    await user.click(screen.getByTestId('relation-button-NEW_CONFIRMED'));
    expect(await screen.findByTestId('detail-relation-error')).toHaveTextContent(
      relationControl.stale,
    );
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('relation-reload-button'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('그 밖의 오류(400·403)는 서버의 쉬운 말과 함께 보이고 새로 불러오지 않는다', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValueOnce(apiError(403, '이 담당자는 기록을 남길 수 없습니다.'));
    const onChanged = renderControl();
    await user.click(screen.getByTestId('relation-button-NEW_CONFIRMED'));
    const error = await screen.findByTestId('detail-relation-error');
    expect(error).toHaveTextContent(relationControl.saveFailed);
    expect(error).toHaveTextContent('이 담당자는 기록을 남길 수 없습니다.');
    expect(screen.queryByTestId('relation-reload-button')).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
