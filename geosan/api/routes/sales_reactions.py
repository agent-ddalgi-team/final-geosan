"""영업 분석 "상대 반응 — 거산의 강점·약점" 경로 (U7, #985).

계약 C1 `GET /sales-analysis/reactions`.

읽기 전용이다: 저장·AI·외부 호출이 없고 보기 전용 계정도 본다. 영업 기록에서 나온 내부 전용
화면이라 엑셀·질문 목록·외부 AI로 내보내지 않는다(계약 C4, `/sales-analysis`와 같음). 응답에는
회사 이름·코드값·건수·날짜만 있고 메모 글·답 글·사람 이름·연락처는 없다.

기간(`from`·`to`)과 세는 대상 회사는 영업 분석표와 같은 입력 함수(`_analysis_inputs`)로 정한다.
"""

from dataclasses import asdict
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep
from geosan.api.routes.records import sales_questions
from geosan.api.routes.sales_analysis import _analysis_inputs
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.sales_questions import KST
from geosan.dashboard.sales_reactions import (
    REACTION_QUESTION_IDS,
    ReactionCompany,
    ReactionLine,
    build_sales_reactions,
)
from geosan.records.live import live_outcomes_with_answers
from geosan.rules.codes import ContactMethod, DatasetKind

router = APIRouter()


class ReactionAnswerCount(_ApiModel):
    answer_id: str
    count: int


class ReactionGroup(_ApiModel):
    """반응 묶음 하나(전체 · 산업 한 줄 · 공정 한 줄이 같은 모양). 세는 단위는 접촉 건이다."""

    answered_count: int
    positive: int
    neutral: int
    negative: int
    # 긍정적인 접촉에서 좋게 본 부분 · 부정적인 접촉에서 걸린 부분.
    # 많은 순, 같으면 질문 파일 보기 순서다.
    good: list[ReactionAnswerCount]
    bad: list[ReactionAnswerCount]


class ReactionIndustryRow(ReactionGroup):
    industry: str


class ReactionProcessRow(ReactionGroup):
    process_code: str | None
    process_name: str


class ReactionContact(_ApiModel):
    """반응을 남긴 접촉 한 건. 회사 이름·코드값·날짜만 싣는다(메모 글·답 글 없음)."""

    opp_id: str
    name: str
    day: date
    method: ContactMethod
    reaction: str
    good: str | None
    bad: str | None
    industries: list[str]
    process_codes: list[str]


class ReactionBasis(_ApiModel):
    min_sample_for_ratio: int
    contact_count: int
    answered_count: int


class SalesReactions(_ApiModel):
    as_of: datetime
    basis: ReactionBasis
    total: ReactionGroup
    by_industry: list[ReactionIndustryRow]
    by_process: list[ReactionProcessRow]
    contacts: list[ReactionContact]


SalesReactionsEnvelope = Envelope[SalesReactions]


def _reaction_company(session: Session, row) -> ReactionCompany:
    """분석표 회사 한 줄에 그 회사의 살아 있는 기록 행과 답(코드)을 붙인다.

    취소한 기록과 거기 달린 답은 세부 단계·패턴과 같은 한 곳(`live_outcomes_with_answers`)에서 뺀다.
    """
    outcomes, answers = live_outcomes_with_answers(session, row.opp_id)
    by_outcome: dict[str, list[tuple[str, str]]] = {}
    for answer in answers:
        by_outcome.setdefault(answer.outcome_id, []).append((answer.question_id, answer.answer_id))
    return ReactionCompany(
        opp_id=row.opp_id,
        name=row.name,
        process_codes=tuple(row.process_codes),
        industries=tuple(row.industries),
        lines=tuple(
            ReactionLine(
                day=outcome.attempted_at or outcome.created_at.astimezone(KST).date(),
                method=outcome.method,
                answers=tuple(by_outcome.get(outcome.outcome_id, [])),
            )
            for outcome in outcomes
        ),
    )


@router.get("/sales-analysis/reactions", response_model=SalesReactionsEnvelope)
def sales_reactions(
    session: SessionDep,
    period_from: Annotated[str | None, Query(alias="from")] = None,
    period_to: Annotated[str | None, Query(alias="to")] = None,
):
    """상대 반응 답을 접촉 건수로 센다(전체·산업별·공정별 묶음과 접촉 줄). 저장하지 않는다.

    영업 분석표와 같은 대상·기간 규칙. 질문 파일에 상대 반응 질문이 없으면 반응 건수는 모두 0이다.
    """
    period, runtime, settings, dataset_kind, now, _companies, result = _analysis_inputs(
        session, period_from, period_to
    )
    questions = sales_questions(session)
    reactions = build_sales_reactions(
        [_reaction_company(session, row) for row in result.companies],
        # 분석표의 공정 줄은 표에 든 회사의 공정을 역량 파일 순서로 모두 담고 있다(이름도 같은 값).
        processes=[
            (row.process_code, row.process_name)
            for row in result.by_process
            if row.process_code is not None
        ],
        industries=runtime.app_settings.industries,
        answer_order={
            question.id: [answer.id for answer in question.answers]
            for question in questions.questions
            if question.id in REACTION_QUESTION_IDS
        },
        min_sample_for_ratio=settings.min_sample_for_ratio,
        period=(result.basis.period_from, result.basis.period_to) if period is not None else None,
    )
    data = SalesReactions.model_validate(
        {"as_of": result.as_of, **asdict(reactions)}, from_attributes=False
    )
    return SalesReactionsEnvelope(
        data=data,
        meta=Meta(
            updated_at=now,
            dataset_kind=dataset_kind,
            has_virtual_data=bool(result.companies)
            and dataset_kind == DatasetKind.VIRTUAL_REVIEWED,
        ),
    )
