// "일정만 잡을 때 고르는 종류"(#691 규칙, #983에서 영업 홈·기업 상세가 같이 쓰게 따로 둠).
// 기업 상세 [일정 잡기](RecordsArea)와 같은 규칙이다: 대면·전화·메일 + 질문 파일 "다음 할 일은?"의 보기 가운데
// "끝"이 아닌 것(자료 보내기·견적…). 질문 id를 화면에 고정하지 않고 질문 파일에서 길을 찾는다(closingRouteOf).
// 질문 파일을 못 읽으면 앞의 세 가지만 보인다(기업 상세와 같다).
import { getSalesQuestions } from '../../api/client';
import type { SalesQuestions } from '../../api/types';
import { contactMethodLabels } from '../../labels/ko';
import { closingRouteOf } from '../records/SalesQuestions';

// 질문 파일은 한 번만 받는다(문구가 바뀌면 새로 고침으로 다시 받는다). 실패하면 다음에 다시 읽는다.
let cache: Promise<SalesQuestions> | null = null;

export function loadScheduleQuestions(): Promise<SalesQuestions> {
  cache ??= getSalesQuestions()
    .then((envelope) => envelope.data)
    .catch((caught: unknown) => {
      cache = null;
      throw caught;
    });
  return cache;
}

/** 시험에서 질문 파일 기억을 비운다. */
export function resetScheduleQuestions(): void {
  cache = null;
}

/** 일정 종류 이름 목록(겹치는 이름은 한 번만). */
export function scheduleKindsOf(questions: SalesQuestions | null): string[] {
  const route = closingRouteOf(questions);
  const nextAction = questions?.questions.find(
    (question) => question.questionId === route?.openerId,
  );
  return [
    ...new Set([
      contactMethodLabels.VISIT,
      contactMethodLabels.CALL,
      contactMethodLabels.EMAIL,
      ...(nextAction?.answers ?? [])
        .filter((option) => !route?.endAnswerIds.includes(option.answerId))
        .map((option) => option.label),
    ]),
  ];
}
