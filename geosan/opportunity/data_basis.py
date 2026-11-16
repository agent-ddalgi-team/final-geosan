"""#798 새 후보 찾기 "자료 기준" 줄: 어떤 공공자료·판단을 기준으로 찾는지 날짜만 모은다.

저장된 행의 날짜만 읽는다(파일·외부 호출 없음). 자료가 없는 종류는 빼고, 날짜를 지어내지 않는다.
활성 묶음이 가상이면 가상 행만, 아니면 실제 행만 본다(가상 자료와 실제 자료를 섞지 않는다).
"""

from datetime import date
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.opportunity.source_models import (
    CandidateJudgment,
    FactoryProfile,
    SourceFactoryRow,
    WaterSite,
)
from geosan.rules.codes import DatasetKind

_KST = ZoneInfo("Asia/Seoul")


def data_basis(session: Session, active_dataset_kind: DatasetKind) -> list[dict]:
    """[{kind, as_of}] — 공장현황 파일 · 공장조회 · 수질 명단 기준일과 마지막 AI 판단 날짜."""
    virtual = active_dataset_kind == DatasetKind.VIRTUAL_REVIEWED
    items: list[dict] = []

    def latest(column, is_virtual_column) -> date | None:
        return session.scalar(
            select(func.max(column)).where(column.is_not(None), is_virtual_column.is_(virtual))
        )

    for kind, column, flag in (
        ("FACTORY_FILE", SourceFactoryRow.file_date, SourceFactoryRow.is_virtual),
        ("FACTORY_LOOKUP", FactoryProfile.file_date, FactoryProfile.is_virtual),
        ("WATER_LIST", WaterSite.file_date, WaterSite.is_virtual),
    ):
        value = latest(column, flag)
        if value is not None:
            items.append({"kind": kind, "as_of": value})
    judged = latest(CandidateJudgment.judged_at, CandidateJudgment.is_virtual)
    if judged is not None:
        items.append({"kind": "AI_JUDGMENT", "as_of": judged.astimezone(_KST).date()})
    return items
