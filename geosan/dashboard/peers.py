"""비슷한 회사 참고 계산 (U5, 계약 C1 `GET /opportunities/{oppId}/peers`, #268).

같은 공정 또는 같은 산업군의 다른 회사를 고르고 건수 요약을 만든다. 저장·AI·외부 호출 없이
읽을 때 계산한다. 메모 글이 들어가므로 영업 메모와 같은 내부 전용 취급이다(계약 C4).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Note, Outcome
from geosan.records.program_note import CHANGE_KIND

# 계약 C1의 값: 보여 주는 회사 수 상한, 거절 이유 상위 개수, 메모 한 줄 길이.
MAX_COMPANIES = 5
TOP_LOST_REASONS = 3
NOTE_PREVIEW_LENGTH = 120
CONTACT_METHODS = ("CALL", "EMAIL", "VISIT")
# "영업 단계가 앞선 순"의 순서. 뒤에 있을수록 더 나아간 단계다. 기록이 없으면 미접촉으로 본다.
STAGE_PROGRESS = (
    "NOT_EXECUTED",
    "ON_HOLD",
    "IN_PROGRESS",
    "SAMPLE_OR_REGISTRATION_APPROVED",
    "LOST",
    "WON",
)
NO_RECORD_STAGE = "NOT_EXECUTED"


@dataclass(frozen=True)
class ContactLine:
    """취소되지 않은 접촉 시도 한 행."""

    method: str
    reached: bool
    attempted_at: date | None
    created_at: datetime


@dataclass(frozen=True)
class NoteLine:
    text: str
    by: str
    at: datetime


@dataclass(frozen=True)
class PeerRecords:
    """비슷한 회사 후보 한 곳의 현재 값(취소된 기록은 이미 빠져 있다)."""

    opp_id: str
    name: str
    process_codes: tuple[str, ...]
    industries: tuple[str, ...]
    outcome_status: str | None
    lost_reason_code: str | None
    last_record_at: datetime | None
    contacts: tuple[ContactLine, ...]
    last_note: NoteLine | None


@dataclass(frozen=True)
class PeerCompany:
    opp_id: str
    name: str
    process_codes: tuple[str, ...]
    industries: tuple[str, ...]
    outcome_status: str | None
    lost_reason_code: str | None
    last_contact: ContactLine | None
    last_note: NoteLine | None
    same_process: bool
    same_industry: bool


@dataclass(frozen=True)
class PeersSummary:
    process_count: int
    industry_count: int
    stage_counts: dict[str, int]
    top_lost_reasons: tuple[tuple[str, int], ...]
    contact_reach: dict[str, tuple[int, int]]  # 방법 → (연결됨, 시도)


@dataclass(frozen=True)
class Peers:
    summary: PeersSummary
    companies: tuple[PeerCompany, ...]


def _progress(status: str | None) -> int:
    return STAGE_PROGRESS.index(status or NO_RECORD_STAGE)


def build_peers(
    process_codes: Sequence[str],
    industries: Sequence[str],
    candidates: Sequence[PeerRecords],
    *,
    lost_reason_order: Sequence[str],
) -> Peers:
    """같은 공정 → 같은 산업군 → 단계가 앞선 순 → 최근 기록 순으로 고르고 건수를 센다."""
    own_processes, own_industries = set(process_codes), set(industries)
    matched: list[tuple[PeerRecords, bool, bool]] = []
    for row in candidates:
        same_process = bool(own_processes & set(row.process_codes))
        same_industry = bool(own_industries & set(row.industries))
        if same_process or same_industry:
            matched.append((row, same_process, same_industry))
    matched.sort(
        key=lambda item: (
            not item[1],
            not item[2],
            -_progress(item[0].outcome_status),
            # 최근 기록이 앞에 오게 하고, 기록이 없는 회사는 뒤로 보낸다. 끝은 이름으로 고정한다.
            -(item[0].last_record_at.timestamp() if item[0].last_record_at else 0.0),
            item[0].name,
            item[0].opp_id,
        )
    )
    stage_counts = Counter(row.outcome_status or NO_RECORD_STAGE for row, _, _ in matched)
    lost = Counter(
        row.lost_reason_code
        for row, _, _ in matched
        if row.outcome_status == "LOST" and row.lost_reason_code
    )
    order = {code: index for index, code in enumerate(lost_reason_order)}
    top_lost = sorted(lost.items(), key=lambda item: (-item[1], order.get(item[0], len(order))))
    reach = {method: [0, 0] for method in CONTACT_METHODS}
    for row, _, _ in matched:
        for contact in row.contacts:
            reach[contact.method][1] += 1
            reach[contact.method][0] += int(contact.reached)
    companies = tuple(
        PeerCompany(
            opp_id=row.opp_id,
            name=row.name,
            process_codes=row.process_codes,
            industries=row.industries,
            outcome_status=row.outcome_status,
            lost_reason_code=row.lost_reason_code if row.outcome_status == "LOST" else None,
            last_contact=max(
                row.contacts,
                key=lambda line: (line.attempted_at or line.created_at.date(), line.created_at),
                default=None,
            ),
            last_note=row.last_note,
            same_process=same_process,
            same_industry=same_industry,
        )
        for row, same_process, same_industry in matched[:MAX_COMPANIES]
    )
    return Peers(
        summary=PeersSummary(
            process_count=sum(1 for _, same_process, _ in matched if same_process),
            industry_count=sum(1 for _, _, same_industry in matched if same_industry),
            stage_counts={
                stage: stage_counts[stage] for stage in STAGE_PROGRESS if stage_counts[stage]
            },
            top_lost_reasons=tuple(top_lost[:TOP_LOST_REASONS]),
            contact_reach={method: (counts[0], counts[1]) for method, counts in reach.items()},
        ),
        companies=companies,
    )


def _preview(note: Note) -> str:
    """메모 한 줄. 질문 답 이력은 앞의 줄 번호 표시를 떼고 답 글만 보인다."""
    text = note.text.split(" 답: ", 1)[-1] if note.kind == "REPLY" else note.text
    return text[:NOTE_PREVIEW_LENGTH]


def process_codes_of(session: Session, opp_ids: Sequence[str]) -> dict[str, set[str]]:
    """기회별 공정 코드. 목록과 같은 방식으로 재투입으로 교체된 연결은 뺀다."""
    codes: dict[str, set[str]] = {}
    if opp_ids:
        for opp_id, code in session.execute(
            select(OppProcessLink.opp_id, OppProcessLink.process_code)
            .where(OppProcessLink.opp_id.in_(opp_ids), OppProcessLink.superseded_at.is_(None))
            .distinct()
        ):
            codes.setdefault(opp_id, set()).add(code)
    return codes


def load_peer_candidates(
    session: Session, opportunity: Opportunity, *, dataset_kind: str
) -> list[PeerRecords]:
    """이 회사를 뺀 후보를 현재 값으로 읽는다.

    대상은 추천 목록과 같다: 최신 확정 평가가 활성 묶음에 속하는 기회. 가상 회사와 실제 회사는
    섞지 않는다(이 회사와 같은 쪽만). 취소된 기록은 단계·접촉·메모 어디에도 넣지 않는다.
    """
    rows = session.execute(
        select(Opportunity.opp_id, Customer.name, Customer.industries)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(
            Opportunity.opp_id != opportunity.opp_id,
            Opportunity.is_virtual.is_(opportunity.is_virtual),
            Customer.is_virtual.is_(opportunity.is_virtual),
        )
    ).all()
    listed = []
    for opp_id, name, industries in rows:
        evaluation = latest_confirmed_evaluation(session, opp_id)
        if evaluation is not None and evaluation.dataset_kind == dataset_kind:
            listed.append((opp_id, name, tuple(industries or [])))
    opp_ids = [opp_id for opp_id, _, _ in listed]
    codes = process_codes_of(session, opp_ids)
    outcomes: dict[str, list[Outcome]] = {}
    notes: dict[str, Note] = {}
    changed_at: dict[str, datetime] = {}
    if opp_ids:
        for row in session.scalars(
            select(Outcome)
            .where(Outcome.opp_id.in_(opp_ids), Outcome.cancelled_at.is_(None))
            .order_by(Outcome.opp_id, Outcome.version)
        ):
            outcomes.setdefault(row.opp_id, []).append(row)
        for row in session.scalars(
            select(Note)
            .where(Note.opp_id.in_(opp_ids), Note.cancelled_at.is_(None))
            .order_by(Note.opp_id, Note.version)
        ):
            if row.kind == CHANGE_KIND:
                # #731: 변경 기록은 마지막 메모가 아니다. 최근 기록 시각에만 지금처럼 센다.
                changed_at[row.opp_id] = row.created_at
            else:
                notes[row.opp_id] = row
    candidates = []
    for opp_id, name, industries in listed:
        lines = outcomes.get(opp_id, [])
        latest = lines[-1] if lines else None
        note = notes.get(opp_id)
        stamps = [row.created_at for row in lines] + ([note.created_at] if note else [])
        stamps += [changed_at[opp_id]] if opp_id in changed_at else []
        candidates.append(
            PeerRecords(
                opp_id=opp_id,
                name=name,
                process_codes=tuple(sorted(codes.get(opp_id, set()))),
                industries=industries,
                outcome_status=latest.status if latest else None,
                lost_reason_code=latest.lost_reason_code if latest else None,
                last_record_at=max(stamps) if stamps else None,
                contacts=tuple(
                    ContactLine(
                        method=row.method,
                        reached=row.result == "REACHED",
                        attempted_at=row.attempted_at,
                        created_at=row.created_at,
                    )
                    for row in lines
                    if row.method in CONTACT_METHODS
                ),
                last_note=NoteLine(text=_preview(note), by=note.staff_key, at=note.created_at)
                if note
                else None,
            )
        )
    return candidates
