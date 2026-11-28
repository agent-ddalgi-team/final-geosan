"""#998 공장주소는 같고 회사명이 다른 후보 쌍을 영업 묶음 전달 사항으로 알린다(PM 결정 2026-11-29).

후보 찾기·이름으로 넣기·회사 정보 고치기가 "같은 회사일 수 있음" 쌍(opp_merge_candidate)을 남기지만
합치는 명령은 없어(보류) 아무도 쌍을 보지 못했다. 주소가 같은 쌍만 나중에 들어온 회사에 전달 사항
(rec_note kind HANDOFF) 한 줄을 남겨 영업 묶음이 확인하게 한다. 회사명이 같고 주소가 다른 쌍은
그대로 둔다(PM 결정). 같은 쌍에는 한 번만 만든다: 줄 번호 칸(item_id)에 "MERGE:<쌍 번호>"를 적어
이미 있으면 건너뛴다. 담당자가 확인한 뒤 같은 회사면 한쪽 의견을 '제외'로 고른다(기존 단추).

보낸 쪽은 사람이 아니라 프로그램(PROGRAM_STAFF)이고, 영업 홈·상세에는 "시스템"으로 보인다
(활동 이력과 같은 말).
글에는 두 회사 이름만 넣는다(주소·연락처 없음). 이 부품은 api에 둔다: 기회(opportunity)와
기록(records)을 함께 쓰는 곳은 api뿐이다(부품 의존 허용표).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.opportunity.models import Customer, MergeCandidate, Opportunity
from geosan.records.models import Note
from geosan.records.program_note import HANDOFF_KIND
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

# 이름 비교는 세 곳(후보 찾기·이름으로 넣기·회사 정보)이 같은 글자로 남긴다.
SAME_ADDRESS_BASIS = "공장주소는 같고 회사명이 달라 확인 필요"
# 받는 영업 묶음(설정 handoffTeams의 key). 이 묶음에 받을 사람이 없으면 쌍을 만든 담당자에게 보낸다.
MERGE_NOTICE_TEAM = "SALES"
# 보낸 쪽 표시. 다른 프로그램 저장(created_by "system")과 같은 값이다.
PROGRAM_STAFF = "system"
ITEM_PREFIX = "MERGE:"


def notice_text(other_name: str) -> str:
    return (
        f"같은 회사일 수 있습니다: '{other_name}'과(와) 공장주소가 같고 회사명이 다릅니다. "
        "같은 회사면 한쪽의 의견을 '제외'(이유: 같은 회사)로 골라 주세요. "
        "다른 회사면 [확인]만 누르면 됩니다."
    )


def _opportunity_of(session: Session, customer_id: str) -> Opportunity | None:
    return session.scalar(
        select(Opportunity)
        .where(Opportunity.customer_id == customer_id)
        .order_by(Opportunity.created_at, Opportunity.opp_id)
        .limit(1)
    )


def notify_same_address_pairs(session: Session, now: datetime) -> int:
    """아직 알리지 않은 '주소 같음' 쌍마다 전달 사항 한 줄을 더하고 더한 수를 돌려준다.

    session.add·flush까지만 한다. 확정과 쓰기 잠금은 부르는 쪽이 맡는다.
    """
    settings = runtime_for(session).app_settings
    to_team = MERGE_NOTICE_TEAM if settings.handoff_team_members(MERGE_NOTICE_TEAM) else None
    pairs = session.scalars(
        select(MergeCandidate)
        .where(
            MergeCandidate.match_basis == SAME_ADDRESS_BASIS,
            MergeCandidate.status == "PENDING",
        )
        .order_by(MergeCandidate.created_at, MergeCandidate.merge_candidate_id)
    ).all()
    if not pairs:
        return 0
    item_ids = [ITEM_PREFIX + pair.merge_candidate_id for pair in pairs]
    done = set(
        session.scalars(
            select(Note.item_id).where(Note.kind == HANDOFF_KIND, Note.item_id.in_(item_ids))
        )
    )
    added = 0
    for pair in pairs:
        item_id = ITEM_PREFIX + pair.merge_candidate_id
        if item_id in done:
            continue
        # 받는 쪽: 영업 묶음. 설정에 영업 묶음이 없으면(팀 PC 시험용 DB 등) 그 쌍을 만든 찾기·저장을
        # 한 기록 담당자에게. 둘 다 없으면 받을 사람이 없으므로 남기지 않는다.
        to_staff = None
        if to_team is None:
            if not settings.is_recording_staff(pair.created_by):
                continue
            to_staff = pair.created_by
        first = session.get(Customer, pair.customer_id_a)
        second = session.get(Customer, pair.customer_id_b)
        if first is None or second is None:
            continue
        # 나중에 들어온 회사에 남긴다(같은 시각이면 쌍의 둘째 회사).
        newer, other = (first, second) if first.created_at > second.created_at else (second, first)
        opportunity = _opportunity_of(session, newer.customer_id)
        if opportunity is None:
            newer, other = other, newer
            opportunity = _opportunity_of(session, newer.customer_id)
        if opportunity is None:
            continue
        version = (
            session.scalar(select(func.max(Note.version)).where(Note.opp_id == opportunity.opp_id))
            or 0
        )
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opportunity.opp_id,
                staff_key=PROGRAM_STAFF,
                kind=HANDOFF_KIND,
                text=notice_text(other.name),
                item_id=item_id,
                to_team=to_team,
                to_staff_key=to_staff,
                version=version + 1,
                created_at=now,
                created_by=PROGRAM_STAFF,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
            )
        )
        session.flush()
        added += 1
    return added


def notify_in_new_session() -> int:
    """찾기가 끝난 뒤·서버를 켤 때처럼 요청 밖에서 부른다. 쓰기 잠금을 잡고 확정까지 한다."""
    with session_scope() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        return notify_same_address_pairs(session, utcnow())
