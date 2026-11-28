// 영업 코치 확인 화면(#985, PM 결정 2026-11-29 시안 "기록 남기기 — 만들 흐름" 다 · 라):
// 방향 · 날짜 · 다음 · 반응 사실 줄과 [바꾸기], 빠진 것의 × 건너뛰기 · 되돌리기, 상대 반응 "기타" 한 줄,
// 끝난 결과 제안 상자(거절 · 성사), 그리고 [이대로 저장]이 보내는 본문.
// 서버 호출(getSalesQuestions·postCoach·postOutcome·postNote)은 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { ApiError, getSalesQuestions, postNote, postOutcome } from '../../../api/client';
import { postCoach } from '../../../api/coach';
import type { CoachResult } from '../../../api/coach';
import { FrameContext } from '../../frame/FrameContext';
import { quickRecordTexts, salesQuestionTexts } from '../../../labels/ko';
import { addDays, pickCalendarDate } from '../../../test/pickCalendarDate';
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
}));
vi.mock('../../../api/coach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/coach')>()),
  postCoach: vi.fn(),
}));

const TODAY = todayKst();
const YESTERDAY = addDays(TODAY, -1);
const LATER = addDays(TODAY, 3);
const MEMO = '구매팀과 통화. 견적 요청 받음. 금요일에 다시 전화하기로';

/** "12/4 (금)" */
function dayLabel(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${formatMonthDay(date)} (${salesQuestionTexts.weekdays[weekday]})`;
}

type User = ReturnType<typeof userEvent.setup>;

/** 메모를 적고 [보내기]를 눌러 확인 화면을 연다. 코치 답은 over로 덮어쓴다. */
async function review(
  user: User,
  over: Partial<CoachResult> = {},
  props: Partial<React.ComponentProps<typeof RecordsArea>> = {},
  memo = MEMO,
) {
  vi.mocked(postCoach).mockResolvedValue({ data: { ...QUICK_RESULT, ...over }, meta: {} });
  render(
    <FrameContext.Provider value={quickFrame()}>
      <RecordsArea oppId="opp-1" salesStep={QUICK_STEP} outcome={QUICK_OUTCOME} {...props} />
    </FrameContext.Provider>,
  );
  const input = await screen.findByTestId('records-contact-memo');
  await waitFor(() => expect(getSalesQuestions).toHaveBeenCalled());
  fireEvent.change(input, { target: { value: memo } });
  await user.click(screen.getByTestId('coach-send'));
  return screen.findByTestId('coach-review');
}

/** [이대로 저장]을 누르고 저장 요청 본문을 돌려준다. */
async function saveBody(user: User, box: HTMLElement) {
  await user.click(within(box).getByTestId('coach-save'));
  await waitFor(() => expect(postOutcome).toHaveBeenCalled());
  return vi.mocked(postOutcome).mock.calls[0][1];
}

function chip(box: HTMLElement, questionId: string, label: string) {
  return within(within(box).getByTestId(`coach-missing-${questionId}`)).getByRole('button', {
    name: label,
  });
}

const OURS = { questionId: 'WHO_FIRST', answerId: 'OURS', filledBy: 'STAFF' };

beforeEach(() => {
  vi.mocked(postOutcome).mockReset();
  vi.mocked(postNote).mockReset();
  vi.mocked(postCoach).mockReset();
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
  vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUICK_QUESTIONS, meta: {} });
});

describe('다. 확인 화면 — 방향 (#985)', () => {
  it('Given 영업 코치가 방향을 채우지 않음 When 확인 화면 Then "발신 (우리가 먼저)"이고 [수신으로 바꾸기]를 누르면 수신으로 저장된다(비용 없음)', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    const line = within(box).getByTestId('coach-fact-direction');
    expect(line).toHaveTextContent('방향');
    expect(line).toHaveTextContent('발신 (우리가 먼저)');
    await user.click(within(box).getByRole('button', { name: '수신으로 바꾸기' }));
    expect(line).toHaveTextContent('수신');
    expect(line).not.toHaveTextContent('우리가 먼저');
    expect(within(box).getByRole('button', { name: '발신으로 바꾸기' })).toBeInTheDocument();
    const body = await saveBody(user, box);
    expect(body.answers).toContainEqual({
      questionId: 'WHO_FIRST',
      answerId: 'THEIRS',
      filledBy: 'STAFF',
    });
    // 바꾸는 데에는 영업 코치를 다시 부르지 않는다.
    expect(postCoach).toHaveBeenCalledTimes(1);
  });

  it('Given 영업 코치가 메모에서 "걸려 온 전화"를 읽음 When 확인 화면 Then "수신 (메모에서 읽음)"이고 그대로 저장하면 AI가 채운 답으로 남는다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {
      answers: [{ questionId: 'WHO_FIRST', answerIds: ['THEIRS'], quote: '전화 옴', fill: 'AI' }],
    });
    expect(within(box).getByTestId('coach-fact-direction')).toHaveTextContent(
      '수신 (메모에서 읽음)',
    );
    const body = await saveBody(user, box);
    expect(body.answers).toContainEqual({
      questionId: 'WHO_FIRST',
      answerId: 'THEIRS',
      filledBy: 'AI_CONFIRMED',
    });
  });

  it('Given 영업 코치가 수신으로 채움 When [발신으로 바꾸기] Then 바꾼 답(AI_CHANGED)으로 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {
      answers: [{ questionId: 'WHO_FIRST', answerIds: ['THEIRS'], quote: '전화 옴', fill: 'AI' }],
    });
    await user.click(within(box).getByRole('button', { name: '발신으로 바꾸기' }));
    expect(within(box).getByTestId('coach-fact-direction')).toHaveTextContent('발신');
    const body = await saveBody(user, box);
    expect(body.answers).toContainEqual({
      questionId: 'WHO_FIRST',
      answerId: 'OURS',
      filledBy: 'AI_CHANGED',
    });
  });
});

describe('다. 확인 화면 — 날짜 (#985)', () => {
  it('Given 확인 화면 When 그대로 저장 Then 날짜는 "오늘"이고 접촉 날짜로 오늘이 간다', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    expect(within(box).getByTestId('coach-fact-date')).toHaveTextContent(
      `${formatMonthDay(TODAY)} (오늘)`,
    );
    expect(within(box).queryByTestId('coach-date-input')).not.toBeInTheDocument();
    const body = await saveBody(user, box);
    expect(body).toMatchObject({ method: 'CALL', result: 'REACHED', attemptedAt: TODAY });
  });

  it('Given 날짜 [바꾸기] When 어제로 고침 Then 날짜 줄이 어제로 바뀌고 그 날짜로 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    await user.click(within(box).getByTestId('coach-date-change'));
    const input = within(box).getByTestId('coach-date-input');
    expect(input).toHaveValue(TODAY);
    // 오늘까지만 고를 수 있다.
    expect(input).toHaveAttribute('max', TODAY);
    fireEvent.change(input, { target: { value: YESTERDAY } });
    const line = within(box).getByTestId('coach-fact-date');
    expect(line).toHaveTextContent(formatMonthDay(YESTERDAY) as string);
    expect(line).not.toHaveTextContent('(오늘)');
    const body = await saveBody(user, box);
    expect(body.attemptedAt).toBe(YESTERDAY);
  });

  it('Given 날짜 [바꾸기] When 내일을 넣으면 Then "오늘까지"라고 알리고 저장이 막힌다', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    await user.click(within(box).getByTestId('coach-date-change'));
    fireEvent.change(within(box).getByTestId('coach-date-input'), {
      target: { value: addDays(TODAY, 1) },
    });
    expect(within(box).getByTestId('coach-date-error')).toHaveTextContent(
      '접촉 날짜는 오늘까지입니다.',
    );
    expect(within(box).getByTestId('coach-save')).toBeDisabled();
    await user.click(within(box).getByTestId('coach-save'));
    expect(postOutcome).not.toHaveBeenCalled();
    fireEvent.change(within(box).getByTestId('coach-date-input'), { target: { value: TODAY } });
    expect(within(box).queryByTestId('coach-date-error')).not.toBeInTheDocument();
    expect(within(box).getByTestId('coach-save')).toBeEnabled();
  });
});

describe('다. 확인 화면 — 다음 일정 (#985)', () => {
  const WITH_NEXT: Partial<CoachResult> = {
    answers: [
      { questionId: 'NEXT_ACTION', answerIds: ['RECONTACT'], quote: '금요일에 다시', fill: 'AI' },
    ],
    nextSchedule: { actionId: 'RECONTACT', date: LATER },
    missingRequired: ['REACTION'],
  };

  it('Given 영업 코치가 메모에서 다음 일정을 읽음 When 확인 화면 Then "날짜 (요일) 다시 연락 (메모에서 읽음)"이고 그대로 일정으로 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user, WITH_NEXT);
    expect(within(box).getByTestId('coach-fact-next')).toHaveTextContent(
      `${dayLabel(LATER)} 다시 연락 (메모에서 읽음)`,
    );
    // 사실 줄에 올린 답은 "AI가 채운 답" 목록에 또 나오지 않는다.
    expect(within(box).queryByTestId('coach-filled-NEXT_ACTION')).not.toBeInTheDocument();
    const body = await saveBody(user, box);
    expect(body).toMatchObject({ nextScheduleAt: LATER, nextScheduleNote: '다시 연락' });
    expect(body.answers).toContainEqual({
      questionId: 'NEXT_ACTION',
      answerId: 'RECONTACT',
      filledBy: 'AI_CONFIRMED',
    });
  });

  it('Given 다음 [바꾸기] When 할 일을 방문으로 바꾸고 날짜를 고름 Then 그 할 일 · 날짜로 저장되고 답은 바꾼 답(AI_CHANGED)이다', async () => {
    const user = userEvent.setup();
    const box = await review(user, WITH_NEXT);
    await user.click(within(box).getByTestId('coach-next-change'));
    const actions = within(box).getByTestId('coach-next-action');
    // "끝"은 여기서 고르지 않는다(끝내는 것은 제안 상자나 [고치기]에서).
    expect(
      within(actions)
        .getAllByRole('radio')
        .map((item) => item.textContent),
    ).toEqual(['자료 보내기', '견적', '다시 연락', '방문']);
    await user.click(within(actions).getByRole('radio', { name: '방문' }));
    // 할 일을 바꾸면 메모에서 읽은 날짜는 그 할 일의 것이 아니므로 비워진다.
    expect(within(box).getByTestId('coach-fact-next')).toHaveTextContent('방문 · 날짜 없음');
    const target = addDays(TODAY, 5);
    await pickCalendarDate(user, 'coach-next-quick', target);
    expect(within(box).getByTestId('coach-fact-next')).toHaveTextContent(
      `${dayLabel(target)} 방문`,
    );
    expect(within(box).getByTestId('coach-fact-next')).not.toHaveTextContent('메모에서 읽음');
    const body = await saveBody(user, box);
    expect(body).toMatchObject({ nextScheduleAt: target, nextScheduleNote: '방문' });
    expect(body.answers).toContainEqual({
      questionId: 'NEXT_ACTION',
      answerId: 'VISIT',
      filledBy: 'AI_CHANGED',
    });
  });

  it('Given 할 일은 읽었지만 날짜가 메모에 없음 When 확인 화면 Then "자료 보내기 · 날짜 없음 [날짜 잡기]"이고 일정 없이 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {
      answers: [
        { questionId: 'NEXT_ACTION', answerIds: ['SEND_MATERIAL'], quote: '소개서', fill: 'AI' },
      ],
      nextSchedule: { actionId: 'SEND_MATERIAL', date: null },
      missingRequired: ['REACTION'],
    });
    expect(within(box).getByTestId('coach-fact-next')).toHaveTextContent('자료 보내기 · 날짜 없음');
    expect(within(box).getByTestId('coach-next-change')).toHaveTextContent('날짜 잡기');
    const body = await saveBody(user, box);
    expect(body).not.toHaveProperty('nextScheduleAt');
    expect(body.answers).toContainEqual({
      questionId: 'NEXT_ACTION',
      answerId: 'SEND_MATERIAL',
      filledBy: 'AI_CONFIRMED',
    });
  });

  it('Given 다음 할 일이 빠짐 When "빠진 것"에서 견적을 고르고 [날짜 잡기] Then 고른 날짜와 할 일로 일정이 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    expect(within(box).queryByTestId('coach-fact-next')).not.toBeInTheDocument();
    await user.click(chip(box, 'NEXT_ACTION', '견적'));
    expect(within(box).getByTestId('coach-fact-next')).toHaveTextContent('견적 · 날짜 없음');
    await user.click(within(box).getByTestId('coach-next-change'));
    // 할 일은 "빠진 것"에서 골랐으므로 여기서는 날짜만 고른다.
    expect(within(box).queryByTestId('coach-next-action')).not.toBeInTheDocument();
    await pickCalendarDate(user, 'coach-next-quick', LATER);
    const body = await saveBody(user, box);
    expect(body).toMatchObject({ nextScheduleAt: LATER, nextScheduleNote: '견적' });
    expect(body.answers).toContainEqual({
      questionId: 'NEXT_ACTION',
      answerId: 'QUOTE',
      filledBy: 'STAFF',
    });
  });
});

describe('다. 확인 화면 — 상대 반응 (#985)', () => {
  const READ: Partial<CoachResult> = {
    answers: [
      { questionId: 'REACTION', answerIds: ['POSITIVE'], quote: '반응 좋음', fill: 'AI' },
      { questionId: 'REACTION_GOOD', answerIds: ['QUALITY_CERT'], quote: '인증서', fill: 'AI' },
    ],
    missingRequired: ['NEXT_ACTION'],
  };

  it('Given 영업 코치가 반응을 메모에서 읽음 When 확인 화면 Then "반응" 줄로 올려 보이고 "빠진 것"에는 없다', async () => {
    const user = userEvent.setup();
    const box = await review(user, READ);
    expect(within(box).getByTestId('coach-fact-reaction')).toHaveTextContent(
      '긍정적 · 품질·인증 (메모에서 읽음)',
    );
    expect(within(box).queryByTestId('coach-missing-REACTION')).not.toBeInTheDocument();
    expect(within(box).queryByTestId('coach-missing-REACTION_GOOD')).not.toBeInTheDocument();
    const body = await saveBody(user, box);
    expect(body.answers).toEqual([
      OURS,
      { questionId: 'REACTION', answerId: 'POSITIVE', filledBy: 'AI_CONFIRMED' },
      { questionId: 'REACTION_GOOD', answerId: 'QUALITY_CERT', filledBy: 'AI_CONFIRMED' },
    ]);
  });

  it('Given 반응 [바꾸기] When 부정적 → 가격으로 고침 Then 좋게 본 부분은 빠지고 걸린 부분이 열리며 바꾼 답으로 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user, READ);
    await user.click(within(box).getByTestId('coach-reaction-change'));
    // 지금 값이 고른 채로 펴진다.
    expect(chip(box, 'REACTION', '긍정적')).toHaveAttribute('aria-pressed', 'true');
    expect(chip(box, 'REACTION_GOOD', '품질·인증')).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip(box, 'REACTION', '부정적'));
    expect(within(box).queryByTestId('coach-missing-REACTION_GOOD')).not.toBeInTheDocument();
    await user.click(chip(box, 'REACTION_BAD', '가격'));
    const line = within(box).getByTestId('coach-fact-reaction');
    expect(line).toHaveTextContent('부정적 · 가격');
    expect(line).not.toHaveTextContent('메모에서 읽음');
    const body = await saveBody(user, box);
    expect(body.answers).toEqual([
      OURS,
      { questionId: 'REACTION', answerId: 'NEGATIVE', filledBy: 'AI_CHANGED' },
      { questionId: 'REACTION_BAD', answerId: 'PRICE', filledBy: 'STAFF' },
    ]);
  });

  it('Given 반응이 메모에 없음 When 확인 화면 Then "빠진 것" 맨 위에 "꼭 확인" 꼬리표와 함께 나오고, 긍정적을 고르면 좋게 본 부분이 바로 아래 열린다', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    expect(within(box).queryByTestId('coach-fact-reaction')).not.toBeInTheDocument();
    const list = within(box).getByTestId('coach-missing');
    expect(list).toHaveTextContent('빠진 것 · 눌러서 채우거나 ×로 건너뛰기');
    const ids = () =>
      within(list)
        .getAllByRole('group')
        .map((item) => item.getAttribute('data-testid'));
    expect(ids()).toEqual(['coach-missing-REACTION', 'coach-missing-NEXT_ACTION']);
    expect(
      within(within(box).getByTestId('coach-missing-REACTION')).getByTestId('coach-must-tag'),
    ).toHaveTextContent('꼭 확인');
    expect(
      within(within(box).getByTestId('coach-missing-NEXT_ACTION')).queryByTestId('coach-must-tag'),
    ).not.toBeInTheDocument();
    await user.click(chip(box, 'REACTION', '긍정적'));
    expect(ids()).toEqual([
      'coach-missing-REACTION',
      'coach-missing-REACTION_GOOD',
      'coach-missing-NEXT_ACTION',
    ]);
    await user.click(chip(box, 'REACTION_GOOD', '납기'));
    const body = await saveBody(user, box);
    expect(body.answers).toEqual([
      OURS,
      { questionId: 'REACTION', answerId: 'POSITIVE', filledBy: 'STAFF' },
      { questionId: 'REACTION_GOOD', answerId: 'LEAD_TIME', filledBy: 'STAFF' },
    ]);
  });
});

describe('다. 확인 화면 — × 건너뛰기 (#985)', () => {
  it('Given 빠진 질문 When ×를 누르면 Then 줄 그은 글 + "건너뜀" + [되돌리기]가 되고, 되돌리면 보기 단추가 돌아온다', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    await user.click(chip(box, 'REACTION', '긍정적'));
    expect(within(box).getByTestId('coach-missing-REACTION_GOOD')).toBeInTheDocument();
    const skip = within(box).getByTestId('coach-skip-REACTION');
    expect(skip).toHaveAccessibleName('이 질문 건너뛰기');
    await user.click(skip);
    const row = within(box).getByTestId('coach-missing-REACTION');
    expect(row).toHaveAttribute('data-skipped', 'true');
    expect(row).toHaveTextContent('건너뜀');
    expect(within(row).getByText('상대 반응은 어땠나요?')).toHaveStyle({
      textDecoration: 'line-through',
    });
    expect(within(row).queryByRole('button', { name: '긍정적' })).not.toBeInTheDocument();
    // 건너뛴 질문의 꼬리는 함께 닫힌다.
    expect(within(box).queryByTestId('coach-missing-REACTION_GOOD')).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: '되돌리기' }));
    expect(chip(box, 'REACTION', '긍정적')).toHaveAttribute('aria-pressed', 'true');
    expect(within(box).getByTestId('coach-missing-REACTION_GOOD')).toBeInTheDocument();
  });

  it('Given 빠진 질문 둘 When 모두 ×로 건너뛰고 [이대로 저장] Then 저장되고 그 질문들의 답은 본문에 없다', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    // 골랐다가 건너뛴 답도 싣지 않는다.
    await user.click(chip(box, 'REACTION', '보통'));
    await user.click(within(box).getByTestId('coach-skip-REACTION'));
    await user.click(within(box).getByTestId('coach-skip-NEXT_ACTION'));
    expect(within(box).getByTestId('coach-save')).toBeEnabled();
    expect(within(box).getByTestId('coach-save-hint')).toHaveTextContent(
      '저장을 눌러야 들어갑니다. 건너뛴 질문은 다음 통화 "확인사항"에 다시 나옵니다.',
    );
    const body = await saveBody(user, box);
    expect(body.answers).toEqual([OURS]);
    expect(body).toMatchObject({ status: 'IN_PROGRESS', result: 'REACHED', memo: MEMO });
    // 건너뛴 질문을 따로 저장하지 않는다.
    expect(postNote).not.toHaveBeenCalled();
    expect(postOutcome).toHaveBeenCalledTimes(1);
  });

  it('Given 빠진 질문을 고르지도 건너뛰지도 않음 When [이대로 저장] Then 그대로 저장된다(답이 없을 뿐)', async () => {
    const user = userEvent.setup();
    const box = await review(user);
    const body = await saveBody(user, box);
    expect(body.answers).toEqual([OURS]);
  });
});

describe('다. 확인 화면 — 상대 반응 "기타" 한 줄 (#985)', () => {
  it('Given 좋게 본 부분에서 기타 When 한 줄을 적고 저장 Then 메모 끝에 " / 좋게 본 부분: …"이 덧붙어 간다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {}, {}, '구매팀과 통화. 견적 요청 받음');
    await user.click(chip(box, 'REACTION', '긍정적'));
    expect(within(box).queryByRole('textbox', { name: '기타: 어떤 부분인가요' })).toBeNull();
    await user.click(chip(box, 'REACTION_GOOD', '기타'));
    const other = within(box).getByRole('textbox', { name: '기타: 어떤 부분인가요' });
    expect(within(box).getByTestId('coach-missing-REACTION_GOOD')).toHaveTextContent(
      '기타를 고르면 한 줄로 적습니다 · 이 접촉의 메모에 함께 저장',
    );
    await user.type(other, '시험 성적서를 바로 보내 준 점');
    const body = await saveBody(user, box);
    expect(body.memo).toBe(
      '구매팀과 통화. 견적 요청 받음 / 좋게 본 부분: 시험 성적서를 바로 보내 준 점',
    );
    expect(body.answers).toContainEqual({
      questionId: 'REACTION_GOOD',
      answerId: 'OTHER',
      filledBy: 'STAFF',
    });
  });

  it('Given 걸린 부분에서 기타 When 한 줄을 적고 저장 Then " / 걸린 부분: …"으로 덧붙는다. 비워 두면 덧붙이지 않는다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {}, {}, '구매팀과 통화');
    await user.click(chip(box, 'REACTION', '부정적'));
    await user.click(chip(box, 'REACTION_BAD', '기타'));
    const other = within(box).getByTestId('coach-other-REACTION_BAD');
    await user.type(other, '   ');
    expect(within(box).queryByTestId('coach-memo-over')).not.toBeInTheDocument();
    await user.clear(other);
    await user.type(other, '최소 주문 수량이 크다고 함');
    const body = await saveBody(user, box);
    expect(body.memo).toBe('구매팀과 통화 / 걸린 부분: 최소 주문 수량이 크다고 함');
  });

  it('Given 기타를 고르고 글은 비워 둠 When 저장 Then 메모는 적은 그대로다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {}, {}, '구매팀과 통화');
    await user.click(chip(box, 'REACTION', '긍정적'));
    await user.click(chip(box, 'REACTION_GOOD', '기타'));
    const body = await saveBody(user, box);
    expect(body.memo).toBe('구매팀과 통화');
  });

  it('Given 덧붙이면 메모 상한(100자)을 넘음 When 기타 글을 적으면 Then 남은 글자 수와 함께 알리고 저장하지 않는다. 줄이면 저장된다', async () => {
    const user = userEvent.setup();
    const long = '가'.repeat(80);
    const box = await review(user, {}, {}, long);
    await user.click(chip(box, 'REACTION', '긍정적'));
    await user.click(chip(box, 'REACTION_GOOD', '기타'));
    const other = within(box).getByTestId('coach-other-REACTION_GOOD');
    // 덧붙는 글 = " / 좋게 본 부분: "(12자) + 적은 글. 80 + 12 + 10 = 102자 → 2자 초과, 기타 글은 8자까지.
    fireEvent.change(other, { target: { value: '나'.repeat(10) } });
    const alert = within(box).getByTestId('coach-memo-over');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(quickRecordTexts.memoOver(100, 8, 2));
    expect(alert).toHaveTextContent('기타 글은 8자까지 쓸 수 있습니다(지금 2자 초과)');
    expect(within(box).getByTestId('coach-save')).toBeDisabled();
    await user.click(within(box).getByTestId('coach-save'));
    expect(postOutcome).not.toHaveBeenCalled();
    fireEvent.change(other, { target: { value: '나'.repeat(8) } });
    expect(within(box).queryByTestId('coach-memo-over')).not.toBeInTheDocument();
    const body = await saveBody(user, box);
    expect(body.memo).toBe(`${long} / 좋게 본 부분: ${'나'.repeat(8)}`);
    expect(body.memo).toHaveLength(100);
  });

  it('Given 기타 한 줄에 전화번호 When 적으면 Then 먼저 알리고 저장이 막힌다. 지우면 풀린다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {}, {}, '구매팀과 통화');
    await user.click(chip(box, 'REACTION', '긍정적'));
    await user.click(chip(box, 'REACTION_GOOD', '기타'));
    const other = within(box).getByTestId('coach-other-REACTION_GOOD');
    await user.type(other, '010-0000-0000으로 달라고 함');
    expect(within(box).getByTestId('coach-other-contact')).toHaveTextContent(
      '전화번호 · 이메일은 빼고 적어 주세요.',
    );
    expect(within(box).getByTestId('coach-save')).toBeDisabled();
    await user.click(within(box).getByTestId('coach-save'));
    expect(postOutcome).not.toHaveBeenCalled();
    await user.clear(other);
    await user.type(other, '빠른 대응');
    expect(within(box).queryByTestId('coach-other-contact')).not.toBeInTheDocument();
    expect(within(box).getByTestId('coach-save')).toBeEnabled();
  });
});

describe('라. 메모에 거절이 있으면 제안으로 묻는다 (#985)', () => {
  const REJECT: Partial<CoachResult> = {
    answers: [
      { questionId: 'REACTION', answerIds: ['NEGATIVE'], quote: '그대로 쓰겠다', fill: 'AI' },
      {
        questionId: 'REACTION_BAD',
        answerIds: ['INCUMBENT_SUPPLIER'],
        quote: '지금 거래처',
        fill: 'AI',
      },
      { questionId: 'NEXT_ACTION', answerIds: ['END'], quote: '그대로 쓰겠다', fill: 'AI' },
      { questionId: 'CLOSE_RESULT', answerIds: ['LOST'], quote: '그대로 쓰겠다', fill: 'SUGGEST' },
      {
        questionId: 'LOST_REASON',
        answerIds: ['INCUMBENT_SUPPLIER'],
        quote: '지금 거래처',
        fill: 'SUGGEST',
      },
    ],
    nextSchedule: null,
    missingRequired: [],
    summary: '지금 거래처를 그대로 쓰겠다고 함',
  };
  const BASE = [
    OURS,
    { questionId: 'REACTION', answerId: 'NEGATIVE', filledBy: 'AI_CONFIRMED' },
    { questionId: 'REACTION_BAD', answerId: 'INCUMBENT_SUPPLIER', filledBy: 'AI_CONFIRMED' },
  ];

  it('Given 영업 코치가 거절을 제안 When 확인 화면 Then 제안 상자로 묻고, 고르기 전에는 거절 이유를 묻지 않으며 AI가 혼자 거절로 넘기지 않는다', async () => {
    const user = userEvent.setup();
    const box = await review(user, REJECT);
    const suggest = within(box).getByTestId('coach-suggest-CLOSE_RESULT');
    expect(suggest).toHaveTextContent('제안: 이 회사를 거절로 끝낼까요?');
    expect(within(suggest).getByRole('button', { name: '이대로 고르기' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(suggest).getByRole('button', { name: '아니요, 계속 진행' })).toBeInTheDocument();
    expect(within(box).queryByTestId('coach-missing-LOST_REASON')).not.toBeInTheDocument();
    expect(within(box).getByTestId('coach-fact-reaction')).toHaveTextContent(
      '부정적 · 기존 거래처 (메모에서 읽음)',
    );
    // 제안을 고르지 않고 저장하면 영업 단계는 그대로다.
    const body = await saveBody(user, box);
    expect(body.status).toBe('IN_PROGRESS');
    expect(body).not.toHaveProperty('lostReasonCode');
    expect(body.answers).toEqual([
      ...BASE,
      { questionId: 'NEXT_ACTION', answerId: 'END', filledBy: 'AI_CONFIRMED' },
    ]);
  });

  it('Given [이대로 고르기] When 거절 이유를 고르고 저장 Then 큰 단계 거절 + 이유 코드로 마무리 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user, REJECT, {
      outcome: { ...QUICK_OUTCOME, nextScheduleAt: LATER, nextScheduleNote: '다시 연락' },
    });
    await user.click(within(box).getByTestId('coach-suggest-pick-CLOSE_RESULT'));
    // 거절 이유가 "빠진 것"으로 열린다. AI 제안은 알려 주되 미리 고르지 않는다.
    const reason = within(box).getByTestId('coach-missing-LOST_REASON');
    expect(reason).toHaveTextContent('거절 이유는?');
    expect(within(box).getByTestId('coach-suggest-hint-LOST_REASON')).toHaveTextContent(
      'AI 제안: 기존 거래처 유지',
    );
    expect(chip(box, 'LOST_REASON', '기존 거래처 유지')).toHaveAttribute('aria-pressed', 'false');
    expect(within(box).getByTestId('coach-save')).toBeDisabled();
    expect(within(box).getByTestId('coach-close-blocked')).toHaveTextContent(
      '거절 이유를 골라야 저장할 수 있습니다.',
    );
    expect(within(box).getByTestId('coach-close-skip-notice')).toHaveTextContent(
      '이유를 ×로 건너뛰면 거절로 넘기지 않고 통화 기록만 저장합니다.',
    );
    await user.click(chip(box, 'LOST_REASON', '기존 거래처 유지'));
    const body = await saveBody(user, box);
    expect(body).toMatchObject({
      status: 'LOST',
      lostReasonCode: 'INCUMBENT_SUPPLIER',
      method: 'CALL',
      result: 'REACHED',
    });
    expect(body.answers).toEqual([
      ...BASE,
      { questionId: 'NEXT_ACTION', answerId: 'END', filledBy: 'AI_CONFIRMED' },
      { questionId: 'CLOSE_RESULT', answerId: 'LOST', filledBy: 'STAFF' },
      { questionId: 'LOST_REASON', answerId: 'INCUMBENT_SUPPLIER', filledBy: 'STAFF' },
    ]);
    // 거절로 끝나는 저장은 있던 일정을 다시 싣지 않는다(#719).
    expect(body).not.toHaveProperty('nextScheduleAt');
  });

  it('Given [이대로 고르기] 뒤 When 거절 이유를 ×로 건너뛰고 저장 Then 거절로 넘기지 않고 마무리 답이 빠진 접촉만 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user, REJECT);
    await user.click(within(box).getByTestId('coach-suggest-pick-CLOSE_RESULT'));
    await user.click(within(box).getByTestId('coach-skip-LOST_REASON'));
    expect(within(box).getByTestId('coach-close-skip-notice')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(within(box).queryByTestId('coach-close-blocked')).not.toBeInTheDocument();
    expect(within(box).getByTestId('coach-save')).toBeEnabled();
    const body = await saveBody(user, box);
    expect(body.status).toBe('IN_PROGRESS');
    expect(body).not.toHaveProperty('lostReasonCode');
    expect(body).toMatchObject({ method: 'CALL', result: 'REACHED' });
    // 끝난 결과 · "끝" · 거절 이유는 싣지 않는다.
    expect(body.answers).toEqual(BASE);
  });

  it('Given [아니요, 계속 진행] When 고르면 Then "끝"은 빠지고 다음 할 일을 다시 묻는다', async () => {
    const user = userEvent.setup();
    const box = await review(user, REJECT);
    expect(within(box).queryByTestId('coach-missing-NEXT_ACTION')).not.toBeInTheDocument();
    await user.click(within(box).getByTestId('coach-suggest-decline-CLOSE_RESULT'));
    expect(within(box).getByTestId('coach-suggest-decline-CLOSE_RESULT')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(box).getByTestId('coach-missing-NEXT_ACTION')).toBeInTheDocument();
    expect(within(box).queryByTestId('coach-missing-LOST_REASON')).not.toBeInTheDocument();
    await user.click(chip(box, 'NEXT_ACTION', '다시 연락'));
    const body = await saveBody(user, box);
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.answers).toEqual([
      ...BASE,
      { questionId: 'NEXT_ACTION', answerId: 'RECONTACT', filledBy: 'AI_CHANGED' },
    ]);
  });

  it('Given 영업 코치가 성사를 제안 When [이대로 고르기] 뒤 저장 Then 같은 상자 방식으로 큰 단계 성사가 저장된다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {
      answers: [
        { questionId: 'NEXT_ACTION', answerIds: ['END'], quote: '발주하기로', fill: 'AI' },
        { questionId: 'CLOSE_RESULT', answerIds: ['WON'], quote: '발주하기로', fill: 'SUGGEST' },
      ],
      missingRequired: ['REACTION'],
    });
    expect(within(box).getByTestId('coach-suggest-CLOSE_RESULT')).toHaveTextContent(
      '제안: 이 회사를 성사로 끝낼까요?',
    );
    await user.click(within(box).getByTestId('coach-suggest-pick-CLOSE_RESULT'));
    expect(within(box).getByTestId('coach-suggest-pick-CLOSE_RESULT')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const body = await saveBody(user, box);
    expect(body.status).toBe('WON');
    expect(body.answers).toContainEqual({
      questionId: 'CLOSE_RESULT',
      answerId: 'WON',
      filledBy: 'STAFF',
    });
  });
});

describe('확인 화면 — 지금 동작 그대로인 것 (#985)', () => {
  it('Given 제외한 회사 When [이대로 저장] Then 먼저 한 번 묻고, 제외인 채로 저장하면 되돌리기 값 없이 저장된다 (#697)', async () => {
    const user = userEvent.setup();
    const box = await review(user, {}, { excluded: true });
    await user.click(within(box).getByTestId('coach-save'));
    expect(await screen.findByTestId('records-excluded-ask')).toBeInTheDocument();
    expect(postOutcome).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('records-excluded-keep-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).not.toHaveProperty('restoreExcluded');
  });

  it('Given 그 사이 다른 기록이 저장됨(409) When [이대로 저장] Then 이유를 알리고 확인 화면과 메모가 그대로 남는다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockRejectedValueOnce(
      new ApiError(409, {
        message: '그 사이 다른 기록이 저장됐습니다.',
        nextAction: '화면을 새로 고친 뒤 다시 저장해 주세요.',
        ref: 'ref-3',
      }),
    );
    const box = await review(user);
    await user.click(within(box).getByTestId('coach-save'));
    expect(await screen.findByTestId('records-contact-error')).toHaveTextContent(
      '그 사이 다른 기록이 저장됐습니다.',
    );
    expect(screen.getByTestId('coach-review')).toBeInTheDocument();
    expect(screen.getByTestId('records-contact-memo')).toHaveValue(MEMO);
    // 저장은 한 번만 보낸다(다시 시도하지 않는다).
    expect(postOutcome).toHaveBeenCalledTimes(1);
  });

  it('Given 영업 코치가 피드백과 다음 통화에 물어볼 것을 줌 When 건너뛰고 저장해도 Then 피드백(ADVICE)과 통화 준비(CALL_PREP)는 전처럼 남는다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {
      feedback: ['납기 답을 아직 못 줬어요.'],
      nextCall: ['외주처는 어디인가요?'],
    });
    await user.click(within(box).getByTestId('coach-skip-REACTION'));
    await user.click(within(box).getByTestId('coach-save'));
    await waitFor(() => expect(postNote).toHaveBeenCalledTimes(2));
    expect(vi.mocked(postNote).mock.calls.map((call) => call[1])).toEqual([
      { text: '납기 답을 아직 못 줬어요.', kind: 'ADVICE' },
      { text: '외주처는 어디인가요?', kind: 'CALL_PREP' },
    ]);
  });

  it('Given 확인 화면 When [고치기] Then 고른 날짜 · 방향 · 답이 든 직접 고르는 양식이 열린다', async () => {
    const user = userEvent.setup();
    const box = await review(user, {
      answers: [{ questionId: 'REACTION', answerIds: ['NEUTRAL'], quote: '그냥', fill: 'AI' }],
      missingRequired: ['NEXT_ACTION'],
    });
    await user.click(within(box).getByRole('button', { name: '수신으로 바꾸기' }));
    await user.click(within(box).getByTestId('coach-date-change'));
    fireEvent.change(within(box).getByTestId('coach-date-input'), {
      target: { value: YESTERDAY },
    });
    await user.click(within(box).getByTestId('coach-edit'));
    expect(screen.queryByTestId('coach-review')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-contact-date')).toHaveValue(YESTERDAY);
    expect(
      within(screen.getByTestId('records-direction')).getByRole('radio', { name: '수신' }),
    ).toBeChecked();
    expect(
      within(await screen.findByTestId('sales-question-REACTION')).getByRole('radio', {
        name: '보통',
      }),
    ).toBeChecked();
    expect(screen.getByTestId('records-contact-memo')).toHaveValue(MEMO);
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalled());
    const body = vi.mocked(postOutcome).mock.calls[0][1];
    expect(body).toMatchObject({ result: 'REACHED', attemptedAt: YESTERDAY, memo: MEMO });
    expect(body.answers).toEqual([
      { questionId: 'WHO_FIRST', answerId: 'THEIRS', filledBy: 'STAFF' },
      { questionId: 'REACTION', answerId: 'NEUTRAL', filledBy: 'AI_CONFIRMED' },
    ]);
  });
});
