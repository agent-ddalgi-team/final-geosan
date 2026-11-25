"""영업 코치 창구(#742, PM 결정 2026-11-14). 계약 C1 `/opportunities/{oppId}/assistant/coach`.

영업 비서 창구(`routes/assistant.py`)와 따로 둔다. 보낼 글 만들기·받은 답 검증·빠진 필수 질문
규칙은 `api/coach.py` 한 곳에 있다. 읽기 전용이다: 아무 값도 저장하지 않고 전송 기록만 남긴다.
저장은 담당자가 확인 화면에서 [이대로 저장]을 누를 때 화면이 기존 `/outcomes`·`/notes`를 부른다.
#750: 같은 호출이 다음 통화에 물어볼 것도 주어, 상세의 [통화 준비 💰]를 따로 부르지 않는다.
"""

import datetime
from contextlib import contextmanager
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Path, Request
from pydantic import Field

from geosan.api.coach import build_coach, check_coaching
from geosan.api.deps import get_session, require_staff, runtime_for
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import AppError, FieldError, InputError, RunFailedError
from geosan.config.sales_questions import KST
from geosan.evidence.assistant_llm import coach_sales_memo
from geosan.evidence.sales_record_gate import SALES_COACH_KIND, sales_record_calls_today
from geosan.opportunity.models import Opportunity
from geosan.rules.codes import SalesStep
from geosan.storage.base import utcnow

router = APIRouter()


class CoachRequest(_RequestModel):
    memo: str = Field(strict=True)
    method: Literal["CALL", "EMAIL", "VISIT"]
    # 접촉 날짜(오늘 이하). 없으면 오늘. 일정 날짜를 풀 때 "오늘"로 쓴다.
    attempted_at: datetime.date | None = None


class CoachAnswerView(_ApiModel):
    question_id: str
    # 고정 보기 질문은 보기 id 하나, choices 질문은 공정 코드·산업군 이름 여러 개.
    answer_ids: list[str]
    # 근거가 된 메모 구절(지운 사본에서 딴 것). 일정에서 채운 "다음 할 일"은 빈 글.
    quote: str
    # AI = 화면이 미리 채우고 "AI가 채움" 표시, SUGGEST = 제안으로만 보이고 미리 고르지 않음.
    fill: Literal["AI", "SUGGEST"]


class CoachScheduleView(_ApiModel):
    action_id: str
    date: datetime.date | None = None


class CoachSimilarCaseView(_ApiModel):
    """#915 함께 본 비슷한 성사 회사 하나(화면에서 그 회사 상세로 가는 링크)."""

    opp_id: str
    name: str
    # 이 회사와 겹친 공정(이름)·산업.
    shared_processes: list[str]
    shared_industries: list[str]


class CoachSimilarAdviceView(_ApiModel):
    """#915 비슷한 성사 사례를 근거로 한 제안 한 줄. text의 사례 번호는 회사 이름으로 되돌렸다."""

    opp_id: str
    name: str
    text: str


class CoachResult(_ApiModel):
    answers: list[CoachAnswerView]
    next_schedule: CoachScheduleView | None = None
    feedback: list[str]
    # #750: 같은 호출에서 받은 다음 통화에 물어볼 것(0~3줄).
    # [이대로 저장] 때 화면이 CALL_PREP로 남긴다.
    next_call: list[str]
    summary: str
    # 규칙으로 계산한 빠진 필수 질문(AI 아님). 질문 파일 순서, 설정 상한까지.
    missing_required: list[str]
    step_before: SalesStep
    step_after: SalesStep
    ai_generated: Literal[True] = True
    removed_names: int
    removed_contacts: int
    # #915 함께 본 비슷한 성사 회사(고른 순서)와 그 사례에서 온 제안 0~2줄. 사례가 없으면 빈 목록.
    similar_cases: list[CoachSimilarCaseView]
    similar_advice: list[CoachSimilarAdviceView]


def _contact_day(body: CoachRequest) -> datetime.date:
    today = utcnow().astimezone(KST).date()
    day = body.attempted_at or today
    if day > today:
        raise InputError(
            "접촉 날짜를 확인해 주세요.",
            fields=[FieldError(path="attemptedAt", message="접촉 날짜는 오늘까지입니다.")],
        )
    return day


@router.post("/opportunities/{oppId}/assistant/coach", response_model=Envelope[CoachResult])
def coach(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: CoachRequest,
    request: Request,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    """저장 전 접촉 메모 하나와 그 회사의 이전 기록을 지운 사본으로 보내 코칭을 받는다(#742).

    읽기 전용이다. 답은 저장하지 않고, 담당자가 [이대로 저장]을 누르면 기존 저장 창구가 반영한다.
    """
    # 영업 비서와 같은 방식: 접속·담당자 검사는 재사용하되 세션을 AI 호출 동안 붙들지 않는다.
    with contextmanager(get_session)(request) as session:
        staff = require_staff(session, staff_key)
        app_settings = runtime_for(session).app_settings
        settings = app_settings.assistant
        if settings is None:
            # 한도 숫자를 코드에서 지어내지 않는다(규칙 ⑩).
            raise RunFailedError(
                "영업 코치 기준(assistant)이 설정에 없습니다. 앱 설정 파일을 확인해 주세요."
            )
        memo = body.memo.strip()
        limit = app_settings.records.memo_line_max_length
        if not memo or len(memo) > limit:
            raise InputError(
                "메모를 확인해 주세요.",
                fields=[FieldError(path="memo", message=f"메모는 1자 이상 {limit}자 이하입니다.")],
            )
        plan = build_coach(
            session,
            opp_id,
            memo,
            _contact_day(body),
            settings.coach_prior_memo_limit,
            settings.coach_similar_won_limit,
        )
        opportunity = session.get(Opportunity, opp_id)
        meta = Meta(
            updated_at=utcnow(),
            dataset_kind=opportunity.dataset_kind,
            has_virtual_data=opportunity.is_virtual,
        )
    # 코치 한도는 전체 회사 합계이고 영업 비서 한도와 따로 센다(전송 기록 kind SALES_COACH).
    if sales_record_calls_today(record_kind=SALES_COACH_KIND) >= settings.coach_daily_limit:
        raise AppError(
            "오늘 영업 코치 한도를 넘었습니다.",
            "오늘은 [고치기]로 직접 골라 저장해 주세요.",
            status=503,
            kind="COACH_LIMIT",
        )
    # 문이 스위치·지우기 재검사·월 한도로 거부하면 여기서 오류가 난다(아무것도 보내지 않는다).
    reading = coach_sales_memo(
        opp_id,
        plan.texts,
        instructions=plan.instructions,
        max_output_tokens=settings.max_output_tokens,
        requested_by=staff,
        also_opp_ids=[case.opp_id for case in plan.cases.cases],
    )
    checked = check_coaching(plan, reading, settings.coach_max_required_questions)
    schedule = checked.next_schedule
    return Envelope[CoachResult](
        data=CoachResult(
            answers=[
                CoachAnswerView(
                    question_id=item.question_id,
                    answer_ids=item.answer_ids,
                    quote=item.quote,
                    fill=item.fill,
                )
                for item in checked.answers
            ],
            next_schedule=CoachScheduleView(action_id=schedule[0], date=schedule[1])
            if schedule
            else None,
            feedback=checked.feedback,
            next_call=checked.next_call,
            summary=checked.summary,
            missing_required=checked.missing_required,
            step_before=plan.step_before,
            step_after=checked.step_after,
            removed_names=plan.memo.removed_names,
            removed_contacts=plan.memo.removed_contacts,
            similar_cases=[
                CoachSimilarCaseView(
                    opp_id=case.opp_id,
                    name=case.name,
                    shared_processes=list(case.shared_processes),
                    shared_industries=list(case.shared_industries),
                )
                for case in plan.cases.cases
            ],
            similar_advice=[
                CoachSimilarAdviceView(opp_id=item.opp_id, name=item.name, text=item.text)
                for item in checked.similar_advice
            ],
        ),
        meta=meta,
    )
