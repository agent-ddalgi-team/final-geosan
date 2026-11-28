"""달력 날짜 메모 창구(#984, 계약 C1 `/day-memos`, PM 결정 2026-11-28 "팀이 함께 보도록").

어느 날짜든 짧은 메모를 남기고 팀이 함께 본다. 읽기는 누구나(보기 전용 포함), 남기기는 기록
담당자만, 지우기는 쓴 사람만 한다. 지우면 행을 지우지 않고 지운 시각·지운 사람을 채워 숨긴다.

저장만 한다: AI·외부 호출 없음, 다시 평가하지 않음, 회사 활동 이력에 남기지 않음.
내부 메모라 외부 AI 조회 글·엑셀·질문 목록·사례 파일 어디에도 싣지 않는다. `/dashboard`와
`/menu-badges` 숫자에도 넣지 않는다(영업 홈의 [메모] 줄은 화면이 이 경로로 읽는다).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Path, Query
from sqlalchemy import select

from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import FieldError, ForbiddenError, InputError, NotFoundError
from geosan.records.models import DAY_MEMO_TEXT_MAX_LENGTH, DayMemo
from geosan.storage.base import new_id, utcnow

router = APIRouter()

# 한 번에 읽을 수 있는 기간(from·to 포함한 날 수). 계약 C1 "기간이 93일을 넘으면 400".
DAY_MEMO_MAX_RANGE_DAYS = 93
_VIRTUAL_DATASET_KIND = "VIRTUAL_REVIEWED"


class DayMemoView(_ApiModel):
    """날짜 메모 한 줄. staffName은 지금 담당자 표의 표시 이름이고 표에 없으면 null이다."""

    memo_id: str
    day: date
    text: str
    staff_key: str
    staff_name: str | None
    created_at: datetime


class DayMemoRequest(_RequestModel):
    day: date
    text: str


class DayMemoDeleted(_ApiModel):
    memo_id: str
    deleted: bool = True


def _dataset_kind(session) -> str:
    return runtime_for(session).app_settings.active_dataset_kind.value


def _meta(session, now: datetime) -> Meta:
    kind = runtime_for(session).app_settings.active_dataset_kind
    return Meta(
        updated_at=now, dataset_kind=kind, has_virtual_data=kind.value == _VIRTUAL_DATASET_KIND
    )


def _staff_names(session) -> dict[str, str]:
    return {entry.key: entry.display_name for entry in runtime_for(session).app_settings.staff}


def _view(row: DayMemo, names: dict[str, str]) -> DayMemoView:
    return DayMemoView(
        memo_id=row.memo_id,
        day=row.day,
        text=row.text,
        staff_key=row.staff_key,
        staff_name=names.get(row.staff_key),
        created_at=row.created_at,
    )


def _begin_write(session) -> None:
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")


def _check_range(day_from: date, day_to: date) -> None:
    if day_to < day_from:
        raise InputError(
            "기간의 시작일이 끝일보다 뒤입니다.",
            fields=[
                FieldError(path="from", message="끝일보다 앞이어야 합니다."),
                FieldError(path="to", message="시작일보다 뒤여야 합니다."),
            ],
        )
    if (day_to - day_from).days + 1 > DAY_MEMO_MAX_RANGE_DAYS:
        raise InputError(
            f"날짜 메모는 한 번에 {DAY_MEMO_MAX_RANGE_DAYS}일까지 볼 수 있습니다.",
            "기간을 줄여 다시 봐 주세요.",
            fields=[
                FieldError(
                    path="to", message=f"시작일부터 {DAY_MEMO_MAX_RANGE_DAYS}일 안이어야 합니다."
                )
            ],
        )


@router.get("/day-memos", response_model=Envelope[list[DayMemoView]])
def list_day_memos(
    session: SessionDep,
    day_from: Annotated[date, Query(alias="from")],
    day_to: Annotated[date, Query(alias="to")],
):
    """그 기간(둘 다 포함)의 메모. 지운 메모는 빼고, 지금 활성 묶음에서 적은 것만 준다."""
    _check_range(day_from, day_to)
    rows = session.scalars(
        select(DayMemo)
        .where(
            DayMemo.dataset_kind == _dataset_kind(session),
            DayMemo.deleted_at.is_(None),
            DayMemo.day >= day_from,
            DayMemo.day <= day_to,
        )
        # 같은 날은 쓴 순서. 시각이 같으면 번호(시간순 ULID)로 가린다.
        .order_by(DayMemo.day, DayMemo.created_at, DayMemo.memo_id)
    ).all()
    names = _staff_names(session)
    return Envelope[list[DayMemoView]](
        data=[_view(row, names) for row in rows], meta=_meta(session, utcnow())
    )


@router.post("/day-memos", response_model=Envelope[DayMemoView])
def add_day_memo(body: DayMemoRequest, session: SessionDep, staff: StaffDep):
    """그 날짜에 메모 한 건을 남긴다. 지난 날짜도 된다. 글은 앞뒤 빈칸을 지우고 저장한다."""
    text = body.text.strip()
    if not text:
        raise InputError(
            "메모를 적어 주세요.",
            fields=[FieldError(path="text", message="빈 글은 남길 수 없습니다.")],
        )
    if len(text) > DAY_MEMO_TEXT_MAX_LENGTH:
        raise InputError(
            "날짜 메모의 글자 수를 확인해 주세요.",
            fields=[
                FieldError(path="text", message=f"{DAY_MEMO_TEXT_MAX_LENGTH}자 이내로 적어 주세요.")
            ],
        )
    now = utcnow()
    dataset_kind = _dataset_kind(session)
    row = DayMemo(
        memo_id=new_id("daymemo"),
        day=body.day,
        text=text,
        staff_key=staff,
        created_at=now,
        created_by=staff,
        dataset_kind=dataset_kind,
        is_virtual=dataset_kind == _VIRTUAL_DATASET_KIND,
    )
    session.add(row)
    session.flush()
    return Envelope[DayMemoView](data=_view(row, _staff_names(session)), meta=_meta(session, now))


@router.delete("/day-memos/{memoId}", response_model=Envelope[DayMemoDeleted])
def delete_day_memo(
    memo_id: Annotated[str, Path(alias="memoId")],
    session: SessionDep,
    staff: StaffDep,
):
    """쓴 사람만 지운다. 행은 남기고 지운 시각·지운 사람을 채워 읽기에서 숨긴다."""
    # 읽고 고치는 사이에 다른 요청이 끼어들지 않게 쓰기 잠금을 먼저 잡는다.
    _begin_write(session)
    row = session.get(DayMemo, memo_id)
    if row is None or row.deleted_at is not None or row.dataset_kind != _dataset_kind(session):
        raise NotFoundError("지울 메모가 없습니다.", "화면을 새로 고쳐 다시 봐 주세요.")
    if row.staff_key != staff:
        raise ForbiddenError(
            "다른 담당자의 메모는 지울 수 없습니다.", "메모를 쓴 담당자에게 알려 주세요."
        )
    now = utcnow()
    row.deleted_at = now
    row.deleted_by = staff
    session.flush()
    return Envelope[DayMemoDeleted](
        data=DayMemoDeleted(memo_id=row.memo_id), meta=_meta(session, now)
    )
