"""왼쪽 메뉴 "새로 생긴 것" 숫자(#770, 계약 C1 `GET /menu-badges`).

곳 수만 돌려준다(회사 이름·글·기록 내용 없음). 읽기 전용이고 AI를 부르지 않는다. "마지막으로 연
시각"은 서버에 저장하지 않고 화면이 브라우저에 담당자별로 기억해 보낸다(새 표·열 없음).
"""

from typing import Annotated

from fastapi import APIRouter, Header, Query
from pydantic import AwareDatetime
from sqlalchemy import func, select

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.routes.dashboard import _my_staff_key
from geosan.api.routes.opportunities import list_evaluations
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.sales_questions import KST
from geosan.dashboard.queries import bookmark_news_count, today_badge_count
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import utcnow

router = APIRouter()


class MenuBadges(_ApiModel):
    """📊 대시보드 · 🔍 신규 거래처 찾기 · ⭐ 관심 기업 숫자(곳 수)."""

    dashboard: int
    list: int
    bookmarks: int


@router.get("/menu-badges", response_model=Envelope[MenuBadges])
def menu_badges(
    session: SessionDep,
    list_since: Annotated[AwareDatetime | None, Query(alias="listSince")] = None,
    bookmarks_since: Annotated[AwareDatetime | None, Query(alias="bookmarksSince")] = None,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    runtime = runtime_for(session)
    dataset_kind = runtime.app_settings.active_dataset_kind
    me = _my_staff_key(session, runtime, staff_key)
    now = utcnow()
    dashboard = today_badge_count(
        session,
        dataset_kind=dataset_kind.value,
        staff_key=me,
        today=now.astimezone(KST).date(),
        staff_teams=runtime.app_settings.handoff_teams_of(me),
    )
    new_candidates = 0
    if list_since is not None:
        # 신규 거래처 찾기 목록과 같은 대상 가운데 그 시각 뒤에 후보로 들어온 곳.
        _batch, evaluations = list_evaluations(session, dataset_kind.value)
        new_candidates = session.scalar(
            select(func.count(func.distinct(Opportunity.opp_id)))
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(
                Opportunity.opp_id.in_(select(evaluations.subquery().c.opp_id)),
                Customer.ingested_at > list_since,
            )
        )
    bookmarks = 0
    if bookmarks_since is not None:
        bookmarks = bookmark_news_count(
            session, dataset_kind=dataset_kind.value, staff_key=me, since=bookmarks_since
        )
    return Envelope[MenuBadges](
        data=MenuBadges(dashboard=dashboard, list=new_candidates or 0, bookmarks=bookmarks),
        meta=Meta(
            updated_at=now,
            dataset_kind=dataset_kind,
            has_virtual_data=dataset_kind.value == "VIRTUAL_REVIEWED",
        ),
    )
