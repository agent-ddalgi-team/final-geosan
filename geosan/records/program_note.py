"""프로그램이 활동 이력에 남기는 메모 한 줄 (#725).

공정·산업 확정, AI 제안 확정·물리침처럼 저장이 무엇을 바꿨는지 프로그램이 문장 한 줄로 남긴다.
메모 표(`rec_note`)에 새 행으로 넣고, 버전은 그 회사 메모의 마지막 번호 다음이다.
작성자는 저장한 담당자다. 쓰기 잠금과 flush는 부르는 창구가 맡는다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.records.models import Note
from geosan.storage.base import new_id


class _Owner(Protocol):
    """메모를 붙일 기회(영업 기회 행). 이 부품은 기회 부품을 가져오지 않으므로 칸만 적는다."""

    opp_id: str
    dataset_kind: str
    is_virtual: bool


def add_program_note(
    session: Session,
    opportunity: _Owner,
    text: str,
    *,
    staff: str,
    now: datetime,
    eval_id: str | None = None,
) -> Note:
    """종류가 메모(MEMO)인 한 줄을 새 행으로 더한다(session.add까지만)."""
    opp_id = opportunity.opp_id
    version = session.scalar(select(func.max(Note.version)).where(Note.opp_id == opp_id)) or 0
    row = Note(
        note_id=new_id("note"),
        opp_id=opp_id,
        staff_key=staff,
        kind="MEMO",
        text=text,
        eval_id=eval_id,
        version=version + 1,
        created_at=now,
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    return row
