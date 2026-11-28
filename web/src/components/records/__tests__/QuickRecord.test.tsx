// 기록 남기기 단순화(#985, PM 결정 2026-11-29 시안 "기록 남기기 — 만들 흐름"): 가 처음 모습 · 나 "부재"는 AI 없이 ·
// 마 연락처 먼저 알림 · 바 영업 코치를 못 쓸 때 · 사 종류 [메모] · 보기 전용.
// [보내기] 뒤 확인 화면(다 · 라)은 CoachReview.test.tsx에 있다.
// 서버 호출(getSalesQuestions·postCoach·postOutcome·postNote·getOpportunityDetail·postMemoRead)은 가짜로 바꾼 확인이며
// 실제 서버·실제 AI 연결 확인이 아니다. 회사 · 글 · 번호는 모두 가상이다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { postMemoRead } from '../../../api/assistant';
import {
  ApiError,
  getOpportunityDetail,
  getSalesQuestions,
  postNote,
  postOutcome,
} from '../../../api/client';
import { postCoach } from '../../../api/coach';
import type { OpportunityDetail } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { coachTexts, quickRecordTexts } from '../../../labels/ko';
import { chipOf, chipValueOf } from '../../../test/chipOf';
import { addDays } from '../../../test/pickCalendarDate';
import {
  QUICK_OUTCOME,
  QUICK_QUESTIONS,
  QUICK_RESULT,
  QUICK_STEP,
  quickFrame,
} from '../../../test/quickRecordSample';
import { formatMonthDay, todayKst } from '../../../utils/time';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postOutcome: vi.fn(),
  postNote: vi.fn(),
  getSalesQuestions: vi.fn(),
  getOpportunityDetail: vi.fn(),
}));
vi.mock('../../../api/coach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/coach')>()),
  postCoach: vi.fn(),
}));
vi.mock('../../../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/assistant')>()),
  postMemoRead: vi.fn(),
}));

const TODAY = todayKst();
const LATER = addDays(TODAY, 3);

function renderArea(
  frame: FrameValue = quickFrame(),
  props: Partial<React.ComponentProps<typeof RecordsArea>> = {},
) {
  return render(
    <FrameContext.Provider value={frame}>
      <RecordsArea oppId="opp-1" salesStep={QUICK_STEP} outcome={QUICK_OUTCOME} {...props} />
    </FrameContext.Provider>,
  );
}

/** 질문 파일을 다 읽을 때까지 기다린 뒤의 메모 칸. */
async function memoBox() {
  const memo = await screen.findByTestId('records-contact-memo');
  await waitFor(() => expect(getSalesQuestions).toHaveBeenCalled());
  return memo;
}

function limitError(status: number, kind: string, message: string) {
  return new ApiError(status, {
    message,
    nextAction: '운영자에게 알려 주세요.',
    ref: 'ref-1',
    kind,
  });
}

beforeEach(() => {
  vi.mocked(postOutcome).mockReset();
  vi.mocked(postNote).mockReset();
  vi.mocked(postCoach).mockReset();
  vi.mocked(postMemoRead).mockReset();
  vi.mocked(getOpportunityDetail).mockReset();
  vi.mocked(postOutcome).mockResolvedValue({
    data: {
      version: 2,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-29T12:15:00+09:00',
      status: 'IN_PROGRESS',
    },
    meta: {},
  });
  vi.mocked(postNote).mockResolvedValue({
    data: {
      noteId: 'note-9',
      version: 3,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-29T12:16:00+09:00',
    },
    meta: {},
  });
  vi.mocked(postCoach).mockResolvedValue({ data: QUICK_RESULT, meta: {} });
  vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUICK_QUESTIONS, meta: {} });
  vi.mocked(getOpportunityDetail).mockResolvedValue({
    data: {
      evalId: 'eval-1',
      records: { outcome: { ...QUICK_OUTCOME, version: 2 } },
    } as unknown as OpportunityDetail,
    meta: {},
  });
});

describe('가. 처음 모습 — 고르는 것은 종류 하나 (#985)', () => {
  it('Given 영업 코치 스위치 켜짐 When 기록 칸을 열면 Then 발신/수신 · 결과 · 접촉 날짜 칸 없이 종류 4개 · 메모 칸 · [보내기 유료]만 보인다', async () => {
    renderArea();
    const memo = await memoBox();
    expect(
      within(screen.getByTestId('records-kind'))
        .getAllByRole('radio')
        .map((chip) => chip.textContent),
    ).toEqual(['통화', '메일', '대면', '메모']);
    expect(chipValueOf('records-kind')).toBe('CALL');
    expect(screen.queryByTestId('records-direction')).not.toBeInTheDocument();
    expect(screen.queryByTestId('records-contact-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('records-contact-date')).not.toBeInTheDocument();
    expect(screen.queryByTestId('records-contact-save-button')).not.toBeInTheDocument();
    expect(memo).toHaveAttribute('placeholder', '통화 내용을 적어 주세요');
    expect(memo).toHaveAccessibleName('메모');
    // 메모가 비어 있으면 [보내기]는 눌리지 않는다. 비용이 드는 단추라 "유료" 꼬리표가 붙는다.
    const send = screen.getByTestId('coach-send');
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleName('보내기 유료');
    expect(screen.getByTestId('records-contact-memo-hint')).toHaveTextContent('0 / 100자');
  });

  it('Given 메모를 적음 When 글자가 생기면 Then [보내기]가 켜지고 남은 글자 수가 따라 바뀐다', async () => {
    const user = userEvent.setup();
    renderArea();
    await user.type(await memoBox(), '구매팀과 통화');
    expect(screen.getByTestId('coach-send')).toBeEnabled();
    expect(screen.getByTestId('records-contact-memo-hint')).toHaveTextContent('7 / 100자');
    expect(screen.getByTestId('records-contact-memo')).toHaveAttribute('maxlength', '100');
  });

  it('Given 종류를 바꿈 When 통화 → 메일 → 대면 → 메모 Then 예시 글이 종류마다 바뀌고, 예시는 누르는 단추가 아니다', async () => {
    const user = userEvent.setup();
    renderArea();
    await memoBox();
    const examples = () =>
      within(screen.getByTestId('quick-examples'))
        .getAllByTestId('quick-example')
        .map((item) => item.textContent);
    expect(screen.getByTestId('quick-examples')).toHaveTextContent('이렇게 적어 보세요');
    expect(examples()).toEqual([
      '발신 · 구매팀과 통화, 견적 요청 받음',
      '수신 · 샘플 문의 전화 옴',
      '부재',
      '금요일 오전에 다시 전화하기로',
      '반응 좋음 · 인증서에 관심',
      '납기가 길다고 걱정함',
    ]);
    expect(within(screen.getByTestId('quick-examples')).queryAllByRole('button')).toHaveLength(0);
    await user.click(chipOf('records-kind', '메일'));
    expect(examples()).toEqual([
      '보냄 · 회사 소개서 첨부',
      '받음 · 견적 조건 회신',
      '답 없음',
      '반응 좋음 · 샘플을 보내 달라고 함',
    ]);
    expect(screen.getByTestId('records-contact-memo')).toHaveAttribute(
      'placeholder',
      '메일 내용을 적어 주세요',
    );
    await user.click(chipOf('records-kind', '대면'));
    expect(examples()).toEqual([
      '방문 · 샘플 전달, 두께 요구 확인',
      '내방 · 공장 견학 옴',
      '못 만남',
      '다음 주 수요일 다시 방문',
    ]);
    await user.click(chipOf('records-kind', '메모'));
    expect(examples()).toEqual(['연말까지 발주 계획 없음', '담당 부서가 바뀜']);
  });
});

describe('나. "부재" 낱말뿐이면 AI 없이 저장 (#985)', () => {
  it.each([
    ['통화', '부재'],
    ['통화', '연락 안 됨'],
    ['통화', '안 받음'],
    ['통화', '통화 안 됨'],
    ['통화', '전화 안 받음.'],
    ['메일', '답 없음'],
    ['메일', '회신 없음'],
    ['대면', '못 만남'],
    ['대면', ' 부재 '],
  ])(
    'Given 종류 %s When 메모가 "%s"뿐 Then [보내기 유료] 대신 유료 표시 없는 [저장]이 보인다',
    async (kind, word) => {
      const user = userEvent.setup();
      renderArea();
      await memoBox();
      await user.click(chipOf('records-kind', kind));
      await user.type(screen.getByTestId('records-contact-memo'), word);
      const save = screen.getByTestId('quick-absent-save');
      expect(save).toHaveAccessibleName('저장');
      expect(within(save).queryByTestId('paid-tag')).not.toBeInTheDocument();
      expect(screen.queryByTestId('coach-send')).not.toBeInTheDocument();
      expect(screen.getByTestId('quick-absent-hint')).toHaveTextContent(
        quickRecordTexts.absentHint,
      );
    },
  );

  it('Given 다른 말이 섞인 "부재. 내일 다시 전화" When 적으면 Then [보내기 유료]로 남는다', async () => {
    const user = userEvent.setup();
    renderArea();
    await user.type(await memoBox(), '부재. 내일 다시 전화');
    expect(screen.getByTestId('coach-send')).toBeEnabled();
    expect(screen.queryByTestId('quick-absent-save')).not.toBeInTheDocument();
  });

  it('Given 통화 메모 "부재" When [저장] Then 영업 코치 요청 0건으로 부재 접촉이 저장되고, 그 자리에 초록 상자와 일정 칸이 보인다', async () => {
    const user = userEvent.setup();
    const onContactRecorded = vi.fn();
    renderArea(quickFrame(), { onContactRecorded });
    await user.type(await memoBox(), '부재');
    await user.click(screen.getByTestId('quick-absent-save'));
    const box = await screen.findByTestId('quick-absent-saved');
    expect(postCoach).not.toHaveBeenCalled();
    expect(postOutcome).toHaveBeenCalledTimes(1);
    // 직접 고르는 양식에서 결과 "부재"를 저장할 때와 같은 본문: 오늘, "누가 먼저 연락했나"는 기본 보기.
    expect(vi.mocked(postOutcome).mock.calls[0]).toEqual([
      'opp-1',
      {
        status: 'IN_PROGRESS',
        method: 'CALL',
        result: 'ABSENT',
        attemptedAt: TODAY,
        answers: [{ questionId: 'WHO_FIRST', answerId: 'OURS' }],
        memo: '부재',
      },
      'park-lee',
    ]);
    expect(box).toHaveTextContent('부재로 저장했습니다 · AI 비용 없음');
    expect(within(box).getByTestId('quick-absent-line')).toHaveTextContent(
      `통화 · 발신 · 연결 안 됨 · ${formatMonthDay(TODAY)}`,
    );
    expect(box).toHaveTextContent('다시 전화할 날을 잡을까요?');
    expect(within(box).getByTestId('schedule-quick-edit')).toBeInTheDocument();
    expect(within(box).getByTestId('quick-absent-close')).toHaveTextContent('안 잡고 닫기');
    expect(onContactRecorded).toHaveBeenCalledWith('CALL');
    // 적던 메모는 비워져 다음 기록을 바로 적을 수 있다.
    expect(screen.getByTestId('records-contact-memo')).toHaveValue('');
  });

  it('Given 앞으로의 일정이 있는 회사 When 부재를 저장 Then 그 일정을 그대로 실어 지워지지 않는다', async () => {
    const user = userEvent.setup();
    renderArea(quickFrame(), {
      outcome: { ...QUICK_OUTCOME, nextScheduleAt: LATER, nextScheduleNote: '다시 연락' },
    });
    await user.type(await memoBox(), '부재');
    await user.click(screen.getByTestId('quick-absent-save'));
    await screen.findByTestId('quick-absent-saved');
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      result: 'ABSENT',
      nextScheduleAt: LATER,
      nextScheduleNote: '다시 연락',
    });
  });

  it.each([
    ['메일', 'EMAIL', '답 없음', '메일 · 발신 · 답 없음', '다시 메일 보낼 날을 잡을까요?'],
    ['대면', 'VISIT', '못 만남', '대면 · 외근 · 못 만남', '다시 방문할 날을 잡을까요?'],
  ])(
    'Given 종류 %s When "%3$s"을 저장 Then 방법 %2$s의 부재로 저장되고 한 줄이 그 종류 말로 보인다',
    async (kind, method, word, line, ask) => {
      const user = userEvent.setup();
      renderArea();
      await memoBox();
      await user.click(chipOf('records-kind', kind));
      await user.type(screen.getByTestId('records-contact-memo'), word);
      await user.click(screen.getByTestId('quick-absent-save'));
      const box = await screen.findByTestId('quick-absent-saved');
      expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
        method,
        result: 'ABSENT',
        memo: word,
      });
      expect(within(box).getByTestId('quick-absent-line')).toHaveTextContent(
        `${line} · ${formatMonthDay(TODAY)}`,
      );
      expect(box).toHaveTextContent(ask);
      expect(postCoach).not.toHaveBeenCalled();
    },
  );

  it('Given 부재 저장 뒤 상자 When 일정 칸에서 날짜를 넣고 저장 Then 일정이 저장되고 상자가 닫히며 새 기록을 알린다', async () => {
    const user = userEvent.setup();
    const onOutcomeSaved = vi.fn();
    renderArea(quickFrame(), { onOutcomeSaved });
    await user.type(await memoBox(), '부재');
    await user.click(screen.getByTestId('quick-absent-save'));
    const box = await screen.findByTestId('quick-absent-saved');
    vi.mocked(postOutcome).mockResolvedValueOnce({
      data: {
        version: 3,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-29T12:20:00+09:00',
        status: 'IN_PROGRESS',
        nextScheduleAt: LATER,
        nextScheduleNote: '전화',
      },
      meta: {},
    });
    fireEvent.change(within(box).getByTestId('schedule-quick-date'), { target: { value: LATER } });
    await user.type(within(box).getByTestId('schedule-quick-note'), '전화');
    await user.click(within(box).getByTestId('schedule-quick-save'));
    await waitFor(() => expect(screen.queryByTestId('quick-absent-saved')).not.toBeInTheDocument());
    expect(postOutcome).toHaveBeenCalledTimes(2);
    expect(vi.mocked(postOutcome).mock.calls[1][1]).toEqual({
      evalId: 'eval-1',
      status: 'IN_PROGRESS',
      nextScheduleAt: LATER,
      nextScheduleNote: '전화',
    });
    expect(onOutcomeSaved).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 3, nextScheduleAt: LATER, nextScheduleNote: '전화' }),
    );
    // 왼쪽 "다음 일정" 줄(이 칸 안에 그릴 때)도 새 일정으로 맞춰진다.
    expect(screen.getByTestId('records-schedule-current')).toHaveTextContent(
      `${formatMonthDay(LATER)} 전화`,
    );
    expect(postCoach).not.toHaveBeenCalled();
  });

  it('Given 부재 저장 뒤 상자 When [안 잡고 닫기] Then 상자만 닫히고 더 저장하지 않는다', async () => {
    const user = userEvent.setup();
    renderArea();
    await user.type(await memoBox(), '부재');
    await user.click(screen.getByTestId('quick-absent-save'));
    await user.click(await screen.findByTestId('quick-absent-close'));
    expect(screen.queryByTestId('quick-absent-saved')).not.toBeInTheDocument();
    expect(postOutcome).toHaveBeenCalledTimes(1);
  });

  it('Given 부재 저장이 실패 When 서버가 거부 Then 이유를 알리고 메모는 그대로이며 초록 상자는 뜨지 않는다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockRejectedValueOnce(
      new ApiError(409, {
        message: '그 사이 다른 기록이 저장됐습니다.',
        nextAction: '화면을 새로 고친 뒤 다시 저장해 주세요.',
        ref: 'ref-2',
      }),
    );
    renderArea();
    await user.type(await memoBox(), '부재');
    await user.click(screen.getByTestId('quick-absent-save'));
    expect(await screen.findByTestId('records-contact-error')).toHaveTextContent(
      '그 사이 다른 기록이 저장됐습니다.',
    );
    expect(screen.queryByTestId('quick-absent-saved')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-contact-memo')).toHaveValue('부재');
  });

  it('Given 제외한 회사 When 부재 [저장] Then 먼저 한 번 묻고, [영업 대상으로 되돌리고 저장]이면 되돌리기 값을 실어 저장한다 (#697)', async () => {
    const user = userEvent.setup();
    renderArea(quickFrame(), { excluded: true });
    await user.type(await memoBox(), '부재');
    await user.click(screen.getByTestId('quick-absent-save'));
    expect(await screen.findByTestId('records-excluded-ask')).toBeInTheDocument();
    expect(postOutcome).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('records-excluded-restore-button'));
    await screen.findByTestId('quick-absent-saved');
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      result: 'ABSENT',
      restoreExcluded: true,
    });
    expect(screen.queryByTestId('records-excluded-ask')).not.toBeInTheDocument();
  });
});

describe('마. 메모에 전화번호 · 이메일이 있으면 먼저 알린다 (#985)', () => {
  it('Given 전화번호가 든 메모 When 적으면 Then 알림 상자가 뜨고 [보내기]가 막혀 영업 코치 요청이 0건이다. 지우면 풀린다', async () => {
    const user = userEvent.setup();
    renderArea();
    const memo = await memoBox();
    await user.type(memo, '구매팀과 통화. 010-0000-0000으로 다시 전화 달라고 함');
    const alert = screen.getByTestId('quick-contact-alert');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('전화번호 · 이메일은 빼고 적어 주세요.');
    expect(alert).toHaveTextContent(
      '기록 메모에는 연락처를 저장하지 않습니다. 연락처는 영업 단계 카드의 "상대 담당자 연락처"에 적어 주세요.',
    );
    expect(memo).toHaveAttribute('aria-invalid', 'true');
    const send = screen.getByTestId('coach-send');
    expect(send).toBeDisabled();
    await user.click(send);
    expect(postCoach).not.toHaveBeenCalled();
    expect(postOutcome).not.toHaveBeenCalled();
    await user.clear(memo);
    await user.type(memo, '구매팀과 통화. 다시 전화 달라고 함');
    expect(screen.queryByTestId('quick-contact-alert')).not.toBeInTheDocument();
    expect(memo).not.toHaveAttribute('aria-invalid');
    expect(screen.getByTestId('coach-send')).toBeEnabled();
  });

  it('Given 이메일 주소가 든 메모 When 적으면 Then 같은 알림이 뜨고 [보내기]가 막힌다', async () => {
    const user = userEvent.setup();
    renderArea();
    await user.type(await memoBox(), '견적은 buyer@example.com 으로 보내 달라고 함');
    expect(screen.getByTestId('quick-contact-alert')).toBeInTheDocument();
    expect(screen.getByTestId('coach-send')).toBeDisabled();
    expect(postCoach).not.toHaveBeenCalled();
  });
});

describe('바. 영업 코치를 못 쓸 때는 지금의 직접 고르는 양식 (#985)', () => {
  it('Given 스위치 꺼짐 When 기록 칸을 열면 Then 발신/수신 · 결과 · 날짜 · [접촉 기록 저장] 양식 그대로이고, 상대 반응 질문이 꼬리 질문 맨 앞에 나온다', async () => {
    const user = userEvent.setup();
    renderArea(quickFrame(false));
    expect(await screen.findByTestId('records-direction')).toBeInTheDocument();
    expect(screen.getByTestId('records-contact-result')).toBeInTheDocument();
    expect(screen.getByTestId('records-contact-date')).toHaveValue(TODAY);
    expect(screen.queryByTestId('coach-send')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-examples')).not.toBeInTheDocument();
    await user.click(chipOf('records-contact-result', '연결됨'));
    const asked = (await screen.findAllByTestId(/^sales-question-[A-Z_]+$/)).map((item) =>
      item.getAttribute('data-testid'),
    );
    expect(asked[0]).toBe('sales-question-REACTION');
    // 긍정적을 고르면 "어느 부분을 좋게 봤나요?"가 바로 이어진다.
    await user.click(
      within(screen.getByTestId('sales-question-REACTION')).getByRole('radio', { name: '긍정적' }),
    );
    expect(screen.getByTestId('sales-question-REACTION_GOOD')).toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalled());
    expect(vi.mocked(postOutcome).mock.calls[0][1].answers).toEqual([
      { questionId: 'WHO_FIRST', answerId: 'OURS' },
      { questionId: 'REACTION', answerId: 'POSITIVE' },
    ]);
    expect(postCoach).not.toHaveBeenCalled();
  });

  it('Given 하루 한도를 다 씀(503) When [보내기] Then 안내 한 줄과 직접 고르는 양식이 열리고 적던 메모가 그대로다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCoach).mockRejectedValueOnce(
      limitError(503, 'COACH_LIMIT', '오늘 영업 코치 한도를 넘었습니다.'),
    );
    renderArea();
    await user.type(await memoBox(), '구매팀과 통화. 견적 요청 받음');
    await user.click(screen.getByTestId('coach-send'));
    const notice = await screen.findByTestId('coach-blocked');
    expect(notice).toHaveTextContent(
      '오늘 영업 코치 한도를 넘었습니다. 직접 골라 저장할 수 있습니다.',
    );
    // 지금 양식: 발신/수신 · 결과 · 날짜. 처음 모습의 [보내기]는 더 보이지 않는다(다시 눌러도 같으므로).
    expect(screen.getByTestId('records-direction')).toBeInTheDocument();
    expect(screen.getByTestId('records-contact-date')).toBeInTheDocument();
    expect(screen.queryByTestId('coach-send')).not.toBeInTheDocument();
    expect(screen.queryByTestId('coach-error')).not.toBeInTheDocument();
    await user.click(chipOf('records-contact-result', '연결됨'));
    expect(screen.getByTestId('records-contact-memo')).toHaveValue('구매팀과 통화. 견적 요청 받음');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalled());
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      method: 'CALL',
      result: 'REACHED',
      memo: '구매팀과 통화. 견적 요청 받음',
    });
    expect(postCoach).toHaveBeenCalledTimes(1);
    // 한도는 그대로이므로 저장한 뒤에도 직접 고르는 양식이 남는다.
    await waitFor(() => expect(screen.getByTestId('records-contact-result')).toBeInTheDocument());
    expect(screen.queryByTestId('coach-send')).not.toBeInTheDocument();
  });

  it('Given 영업 기록 스위치가 서버에서 꺼짐(422) When [보내기] Then 같은 방식으로 직접 고르는 양식이 열린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCoach).mockRejectedValueOnce(
      limitError(422, 'SALES_RECORDS_DISABLED', '영업 기록을 AI로 보내는 설정이 꺼져 있습니다.'),
    );
    renderArea();
    await user.type(await memoBox(), '구매팀과 통화');
    await user.click(screen.getByTestId('coach-send'));
    expect(await screen.findByTestId('coach-blocked')).toHaveTextContent(
      '영업 기록을 AI로 보내는 설정이 꺼져 있습니다. 직접 골라 저장할 수 있습니다.',
    );
    expect(screen.getByTestId('records-contact-result')).toBeInTheDocument();
    expect(postOutcome).not.toHaveBeenCalled();
  });

  it('Given 그 밖의 실패(네트워크) When [보내기] Then 그 자리에 이유가 보이고 다시 보내면 확인 화면이 열린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCoach).mockRejectedValueOnce(new Error('network'));
    renderArea();
    await user.type(await memoBox(), '구매팀과 통화');
    await user.click(screen.getByTestId('coach-send'));
    expect(await screen.findByTestId('coach-error')).toHaveTextContent(coachTexts.failed);
    expect(screen.queryByTestId('coach-blocked')).not.toBeInTheDocument();
    expect(screen.queryByTestId('coach-review')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('coach-send'));
    expect(await screen.findByTestId('coach-review')).toBeInTheDocument();
    expect(postCoach).toHaveBeenCalledTimes(2);
    expect(postOutcome).not.toHaveBeenCalled();
  });
});

describe('사. 종류 [메모] — 메모로만 저장 / 영업 코치에게 보내기 (#985)', () => {
  const MEMO = '지난주 방문 때 샘플 두께 불량 클레임 받음. 재작업해서 다시 가져가기로';

  async function toMemo(user: ReturnType<typeof userEvent.setup>) {
    await memoBox();
    await user.click(chipOf('records-kind', '메모'));
    return screen.getByTestId('records-note-input');
  }

  it('Given 종류 메모 When 열면 Then 단추가 둘이고 안내 한 줄이 보인다', async () => {
    const user = userEvent.setup();
    renderArea();
    await toMemo(user);
    expect(screen.getByTestId('records-note-save-button')).toHaveAccessibleName('메모로만 저장');
    expect(screen.getByTestId('quick-note-coach')).toHaveAccessibleName(
      '영업 코치에게 보내기 유료',
    );
    expect(screen.getByTestId('quick-note-guide')).toHaveTextContent(
      '상대와 나눈 이야기(대면 · 통화 · 클레임 등)는 [영업 코치에게 보내기]로 남기면 상대 반응과 일정이 함께 정리됩니다.',
    );
    // 글이 없으면 둘 다 눌리지 않는다.
    expect(screen.getByTestId('records-note-save-button')).toBeDisabled();
    expect(screen.getByTestId('quick-note-coach')).toBeDisabled();
  });

  it('Given 메모 When [메모로만 저장] Then AI 없이 메모로 저장되고 그 아래 [일정 잡기]와 [AI가 메모 읽기 유료]가 이어진다', async () => {
    const user = userEvent.setup();
    vi.mocked(postMemoRead).mockResolvedValue({
      data: {
        summary: '클레임 재작업',
        proposals: [],
        aiGenerated: true,
        removedNames: 0,
        removedContacts: 0,
      },
      meta: {},
    } as unknown as Awaited<ReturnType<typeof postMemoRead>>);
    renderArea();
    await user.type(await toMemo(user), MEMO);
    await user.click(screen.getByTestId('records-note-save-button'));
    const box = await screen.findByTestId('quick-note-saved');
    expect(postNote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postNote).mock.calls[0]).toEqual([
      'opp-1',
      { text: MEMO, kind: 'MEMO' },
      'park-lee',
    ]);
    expect(postCoach).not.toHaveBeenCalled();
    expect(postOutcome).not.toHaveBeenCalled();
    expect(postMemoRead).not.toHaveBeenCalled();
    expect(box).toHaveTextContent('메모를 저장했습니다');
    // [일정 잡기]: 영업 홈 표 · 상세 "다음 일정"과 같은 일정 칸이 그 자리에 펴진다.
    await user.click(within(box).getByTestId('quick-note-schedule'));
    expect(within(box).getByTestId('schedule-quick-edit')).toBeInTheDocument();
    // [AI가 메모 읽기 유료]: 방금 저장한 메모가 대상이다. 눌러야 AI를 부른다.
    const read = within(box).getByTestId('memo-read-button');
    expect(read).toHaveAccessibleName('AI가 메모 읽기 유료');
    await user.click(read);
    await waitFor(() =>
      expect(postMemoRead).toHaveBeenCalledWith('opp-1', 'NOTE', 'note-9', 'park-lee'),
    );
  });

  it('Given 메모 When [영업 코치에게 보내기] → 대면 Then 그 종류로 영업 코치에 보내고, 저장은 접촉 기록 하나뿐이다(/notes 저장 없음)', async () => {
    const user = userEvent.setup();
    renderArea();
    const input = await toMemo(user);
    await user.type(input, MEMO);
    await user.click(screen.getByTestId('quick-note-coach'));
    const ask = screen.getByTestId('quick-memo-kind-ask');
    expect(ask).toHaveTextContent('어떻게 있었던 일인가요?');
    expect(ask).toHaveTextContent('한 번만 고르면 됩니다');
    expect(
      within(screen.getByTestId('quick-memo-kind'))
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['통화', '메일', '대면']);
    // 고르기 전에는 아무것도 보내지 않는다.
    expect(postCoach).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByTestId('quick-memo-kind')).getByRole('button', { name: '대면' }),
    );
    const review = await screen.findByTestId('coach-review');
    expect(postCoach).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postCoach).mock.calls[0]).toEqual([
      'opp-1',
      { memo: MEMO, method: 'VISIT', attemptedAt: TODAY },
      'park-lee',
    ]);
    expect(within(review).getByTestId('coach-review-title')).toHaveTextContent(
      'AI가 정리한 것 · 확인 전 · 대면 기록으로 저장',
    );
    // 대면의 방향은 지금 화면이 쓰는 말(외근 · 내방)이다.
    expect(within(review).getByTestId('coach-fact-direction')).toHaveTextContent('외근');
    expect(within(review).getByTestId('coach-direction-switch')).toHaveTextContent(
      '내방으로 바꾸기',
    );
    // 종류 단추는 [메모] 그대로다.
    expect(chipValueOf('records-kind')).toBe('MEMO');
    await user.click(within(review).getByTestId('coach-save'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      method: 'VISIT',
      result: 'REACHED',
      attemptedAt: TODAY,
      memo: MEMO,
    });
    expect(postNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('coach-review')).not.toBeInTheDocument());
    expect(screen.getByTestId('records-note-input')).toHaveValue('');
  });

  it('Given 받는 사람을 고른 메모 When 보면 Then [영업 코치에게 보내기]는 눌리지 않고 전달 사항으로 저장된다는 안내가 보인다', async () => {
    const user = userEvent.setup();
    renderArea(quickFrame(true, {}, [{ key: 'kim-inspect', displayName: '검수 담당(가상)' }]));
    await user.type(await toMemo(user), MEMO);
    expect(screen.getByTestId('quick-note-coach')).toBeEnabled();
    await user.selectOptions(screen.getByTestId('records-note-to'), 'kim-inspect');
    expect(screen.getByTestId('quick-note-coach')).toBeDisabled();
    expect(screen.getByTestId('quick-note-to-blocked')).toHaveTextContent(
      '받는 사람이 있는 메모는 전달 사항으로 저장됩니다',
    );
    await user.click(screen.getByTestId('records-note-save-button'));
    await waitFor(() => expect(postNote).toHaveBeenCalled());
    expect(vi.mocked(postNote).mock.calls[0][1]).toEqual({
      text: MEMO,
      kind: 'HANDOFF',
      toStaffKey: 'kim-inspect',
    });
    expect(postCoach).not.toHaveBeenCalled();
    // 전달 사항에는 [일정 잡기] · [AI가 메모 읽기] 상자를 잇지 않는다(전과 같이 "저장됨"만).
    expect(await screen.findByTestId('records-note-saved')).toBeInTheDocument();
    expect(screen.queryByTestId('quick-note-saved')).not.toBeInTheDocument();
  });

  it('Given 접촉 메모 상한(100자)보다 긴 메모 When 보면 Then 메모로만 저장은 되고 영업 코치에게는 보낼 수 없다고 알린다', async () => {
    const user = userEvent.setup();
    renderArea();
    const input = await toMemo(user);
    fireEvent.change(input, { target: { value: '가'.repeat(101) } });
    expect(screen.getByTestId('records-note-save-button')).toBeEnabled();
    expect(screen.getByTestId('quick-note-coach')).toBeDisabled();
    expect(screen.getByTestId('quick-note-too-long')).toHaveTextContent(
      '영업 코치에게 보내는 메모는 100자까지입니다(지금 101자).',
    );
    await user.click(screen.getByTestId('quick-note-coach'));
    expect(postCoach).not.toHaveBeenCalled();
  });

  it('Given 전화번호가 든 메모 When 보면 Then 메모로만 저장은 되고(내부 메모) 영업 코치에게는 보낼 수 없다', async () => {
    const user = userEvent.setup();
    renderArea();
    await user.type(await toMemo(user), '담당자 010-0000-0000 로 연락 달라고 함');
    expect(screen.getByTestId('records-note-save-button')).toBeEnabled();
    expect(screen.getByTestId('quick-note-coach')).toBeDisabled();
    expect(screen.getByTestId('quick-note-contact-blocked')).toHaveTextContent(
      quickRecordTexts.memoContactBlocked,
    );
    expect(postCoach).not.toHaveBeenCalled();
  });

  it('Given 영업 코치 한도를 다 씀 When 메모를 대면으로 보냄 Then 대면의 직접 고르는 양식이 열리고 적던 글이 메모 칸에 그대로다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCoach).mockRejectedValueOnce(
      limitError(503, 'COACH_LIMIT', '오늘 영업 코치 한도를 넘었습니다.'),
    );
    renderArea();
    await user.type(await toMemo(user), MEMO);
    await user.click(screen.getByTestId('quick-note-coach'));
    await user.click(
      within(screen.getByTestId('quick-memo-kind')).getByRole('button', { name: '대면' }),
    );
    expect(await screen.findByTestId('coach-blocked')).toBeInTheDocument();
    expect(chipValueOf('records-kind')).toBe('VISIT');
    await user.click(chipOf('records-contact-result', '연결됨'));
    expect(screen.getByTestId('records-contact-memo')).toHaveValue(MEMO);
    expect(postNote).not.toHaveBeenCalled();
    expect(postOutcome).not.toHaveBeenCalled();
  });
});

describe('보기 전용 · 담당자 미선택 (#985에서도 그대로)', () => {
  it('Given 기록할 수 없는 사람 When 기록 칸을 열면 Then 안내가 보이고 종류 · 메모 · [보내기]가 모두 막혀 있다', async () => {
    const user = userEvent.setup();
    renderArea(quickFrame(true, { staffKey: null, canRecord: false }));
    const memo = await memoBox();
    expect(screen.getByTestId('records-pick-staff-text')).toHaveTextContent(
      '먼저 담당자를 고르세요',
    );
    expect(memo).toBeDisabled();
    expect(screen.getByTestId('coach-send')).toBeDisabled();
    expect(screen.getByTestId('records-kind')).toBeDisabled();
    await user.click(screen.getByTestId('coach-send'));
    expect(postCoach).not.toHaveBeenCalled();
    expect(postOutcome).not.toHaveBeenCalled();
  });
});
