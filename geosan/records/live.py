"""살아 있는 영업 기록과 그 꼬리 질문 답을 읽는 한 곳 (#725).

세부 단계(상세·카드·영업 분석표)와 통화 신호(#685)가 같은 규칙으로 읽는다:
잘못 입력으로 표시한(취소한) 기록은 빼고(#253), 그 기록에 달린 답도 뺀다(#607).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.records.models import Outcome, OutcomeAnswer


def live_outcomes_with_answers(
    session: Session, opp_id: str
) -> tuple[list[Outcome], list[OutcomeAnswer]]:
    """취소 안 된 영업 기록 행(버전 순)과 거기 달린 꼬리 질문 답(저장 순).

    답은 저장 시각, 같으면 답 행 번호 순이다. 기록이 하나도 없으면 답은 읽지 않고 빈 목록이다.
    """
    outcomes = list(
        session.scalars(
            select(Outcome)
            .where(Outcome.opp_id == opp_id, Outcome.cancelled_at.is_(None))
            .order_by(Outcome.version)
        )
    )
    if not outcomes:
        return [], []
    live_ids = {row.outcome_id for row in outcomes}
    answers = [
        row
        for row in session.scalars(
            select(OutcomeAnswer)
            .where(OutcomeAnswer.opp_id == opp_id)
            .order_by(OutcomeAnswer.created_at, OutcomeAnswer.answer_row_id)
        )
        if row.outcome_id in live_ids
    ]
    return outcomes, answers
