"""상세의 "지난 평가와 달라진 것" (#942, 되먹임 ① 같은 회사 반영, PM 결정 2026-11-26).

기록을 남겨 그 회사가 다시 평가되면 지금 평가와 바로 앞의 "다른" 평가를 견줘
평가점수·분류·항목 점수가 어떻게 바뀌었는지와 그 사이 남긴 기록을 돌려준다.
저장하지 않고 상세를 읽을 때마다 계산한다. 평가 행은 바뀔 때마다 새 행이고 앞 평가 번호를
들고 있어서(FR4.12) 따로 표를 두지 않는다.

- 점수가 그대로인 재평가(예: 공정을 같은 값으로 다시 확정)는 건너뛰고 더 앞 평가와 견준다.
  그래서 "마지막으로 바뀐 때"가 보인다. 너무 오래 거슬러 가지 않게 `MAX_WALK`번까지만 본다.
- 순위 번호는 넣지 않는다(PM 결정 2026-11-26): 부분 재평가 때는 순위의 기준 묶음이 달라서다.
- 그 사이 기록에는 영업 메모 원문을 넣지 않는다. 프로그램이 남긴 변경 기록(공정·산업 확정 등),
  거래 관계 변경, 접촉 기록(방법·날짜·꼬리 질문 보기 이름)만 넣는다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.routes.records import sales_questions
from geosan.api.schemas import ScoreChange, ScoreChangeItem, ScoreChangeRecord
from geosan.evaluation.models import EvaluationBatch, EvaluationRun, ItemJudgment
from geosan.opportunity.models import RelationHistory
from geosan.records.models import Note, Outcome, OutcomeAnswer
from geosan.records.program_note import CHANGE_KIND

# 점수가 같은 재평가를 건너뛰며 거슬러 보는 최대 횟수.
MAX_WALK = 20
# 그 사이 기록은 최근 것부터 이만큼만.
MAX_RECORDS = 3

_RELATION_LABELS = {
    "UNCONFIRMED": "확인 전",
    "NEW_CONFIRMED": "거래 없음",
    "EXISTING_CONFIRMED": "거래 중",
}


def _items(session: Session, eval_id: str) -> dict[str, ItemJudgment]:
    return {
        row.item_code: row
        for row in session.scalars(select(ItemJudgment).where(ItemJudgment.eval_id == eval_id))
    }


def _item_key(row: ItemJudgment | None) -> tuple[int | None, str | None]:
    return (row.score, row.state) if row is not None else (None, None)


def _same(
    left: EvaluationRun,
    left_items: dict[str, ItemJudgment],
    right: EvaluationRun,
    right_items: dict[str, ItemJudgment],
) -> bool:
    if (left.score_e, left.classification_code) != (right.score_e, right.classification_code):
        return False
    codes = left_items.keys() | right_items.keys()
    return all(
        _item_key(left_items.get(code)) == _item_key(right_items.get(code)) for code in codes
    )


def _labels(run: EvaluationRun) -> dict[str, str]:
    config = (run.input_snapshot or {}).get("ruleConfig") or {}
    return {
        row["itemCode"]: row.get("label") or row["itemCode"]
        for row in config.get("newProfileItems", [])
    }


def _contact_summaries(session: Session, outcome_ids: list[str]) -> dict[str, str]:
    """접촉 기록마다 꼬리 질문 보기 이름(질문 파일의 고정 보기만). 공정·산업 고르기와
    "누가 먼저 연락했나요?"처럼 기본 보기가 있는 질문은 뺀다(앞은 변경 기록 줄이 따로 있다)."""
    if not outcome_ids:
        return {}
    labels: dict[tuple[str, str], str] = {}
    for question in sales_questions(session).questions:
        if question.choices or any(option.default for option in question.answers):
            continue
        for option in question.answers:
            labels[(question.id, option.id)] = option.label
    found: dict[str, list[str]] = {}
    for outcome_id, question_id, answer_id in session.execute(
        select(OutcomeAnswer.outcome_id, OutcomeAnswer.question_id, OutcomeAnswer.answer_id)
        .where(OutcomeAnswer.outcome_id.in_(outcome_ids))
        .order_by(OutcomeAnswer.answer_row_id)
    ):
        label = labels.get((question_id, answer_id))
        if label:
            found.setdefault(outcome_id, []).append(label)
    return {key: " · ".join(values) for key, values in found.items()}


def _records_between(
    session: Session, opp_id: str, after: datetime, until: datetime
) -> list[ScoreChangeRecord]:
    records: list[ScoreChangeRecord] = []
    for row in session.scalars(
        select(Note).where(
            Note.opp_id == opp_id,
            Note.kind == CHANGE_KIND,
            Note.cancelled_at.is_(None),
            Note.created_at > after,
            Note.created_at <= until,
        )
    ):
        records.append(ScoreChangeRecord(at=row.created_at, kind="CHANGE", summary=row.text))
    for row in session.scalars(
        select(RelationHistory).where(
            RelationHistory.opp_id == opp_id,
            RelationHistory.changed_at > after,
            RelationHistory.changed_at <= until,
        )
    ):
        records.append(
            ScoreChangeRecord(
                at=row.changed_at,
                kind="RELATION_CONFIRMED",
                summary=(
                    f"거래 관계: {_RELATION_LABELS.get(row.from_status, row.from_status)} → "
                    f"{_RELATION_LABELS.get(row.to_status, row.to_status)}"
                ),
            )
        )
    contacts = list(
        session.scalars(
            select(Outcome).where(
                Outcome.opp_id == opp_id,
                Outcome.method.is_not(None),
                Outcome.cancelled_at.is_(None),
                Outcome.created_at > after,
                Outcome.created_at <= until,
            )
        )
    )
    answers = _contact_summaries(session, [row.outcome_id for row in contacts])
    for row in contacts:
        records.append(
            ScoreChangeRecord(
                at=row.created_at,
                kind="CONTACT_ATTEMPT",
                method=row.method,
                attempted_at=row.attempted_at,
                summary=answers.get(row.outcome_id, ""),
            )
        )
    records.sort(key=lambda record: record.at)
    return records[-MAX_RECORDS:]


def score_change(session: Session, run: EvaluationRun | None) -> ScoreChange | None:
    """지금 평가가 바로 앞의 다른 평가와 무엇이 다른지. 앞 평가가 없거나 모두 같으면 None."""
    if run is None or run.previous_eval_id is None:
        return None
    current_items = _items(session, run.eval_id)
    changed = run  # 점수가 처음 지금 값이 된 평가
    previous = session.get(EvaluationRun, run.previous_eval_id)
    previous_items = _items(session, previous.eval_id) if previous else {}
    walked = 0
    while previous is not None and _same(previous, previous_items, run, current_items):
        walked += 1
        if walked >= MAX_WALK or previous.previous_eval_id is None:
            return None
        changed = previous
        previous = session.get(EvaluationRun, previous.previous_eval_id)
        previous_items = _items(session, previous.eval_id) if previous else {}
    if previous is None:
        return None
    labels = _labels(run)
    items = [
        ScoreChangeItem(
            item_code=code,
            label=labels.get(code, code),
            before=previous_items[code].score if code in previous_items else None,
            after=current_items[code].score if code in current_items else None,
            fact_judged=current_items[code].fact_judged if code in current_items else None,
        )
        for code in [*labels, *sorted(current_items.keys() - labels.keys())]
        if _item_key(previous_items.get(code)) != _item_key(current_items.get(code))
    ]
    batches = {
        row.batch_id: row.rule_version
        for row in session.scalars(
            select(EvaluationBatch).where(
                EvaluationBatch.batch_id.in_({previous.batch_id, changed.batch_id})
            )
        )
    }
    return ScoreChange(
        changed_at=changed.created_at,
        since_eval_id=previous.eval_id,
        score_before=previous.score_e,
        score_after=run.score_e,
        classification_before=previous.classification_code,
        classification_after=run.classification_code,
        rule_version_changed=batches.get(previous.batch_id) != batches.get(changed.batch_id),
        items=items,
        records=_records_between(session, run.opp_id, previous.created_at, changed.created_at),
    )
