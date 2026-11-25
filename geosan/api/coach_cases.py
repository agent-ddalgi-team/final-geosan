"""#915 영업 코치가 함께 보는 "비슷한 성사 사례"(PM 결정 2026-11-25, RAG 1단계). 계약 C1·C4.

담당자가 메모를 [보내기]하면, 이 회사와 공정·산업이 겹치고 거산과 거래가 성사(WON)된 다른 회사를
설정 `assistant.coachSimilarWonLimit`곳까지 골라 그 회사들의 기록(접촉 흐름·꼬리 질문 답·메모·결과
사유)을 지운 사본으로 함께 보낸다. 코치는 그 사례에서 성사로 이어진 행동을 이 회사에 맞게 제안한다.

- 고르는 순서: 겹치는 공정 수 → 겹치는 산업 수 → 최근에 성사된 순 → 이름순. 점수·가중치는 쓰지
  않는다(규칙 숫자를 지어내지 않음, 규칙 ⑩). 공정·산업이 하나도 겹치지 않으면 고르지 않는다.
- 공정은 대체되지 않은 공정 연결 전부(확정·제안), 산업은 회사의 산업 칸 그대로를 쓴다. 영업 초기의
  회사는 확정 전인 경우가 많아, 확정만 보면 비교할 회사가 거의 없다.
- 회사 이름은 "사례 S1"처럼 바꿔 보내고(대표번호·주소는 싣지 않는다), 회사마다 따로 지운다
  (scrub_sales_records, 영업 분석 #802와 같은 규칙). 답의 "사례 S1"은 화면에 보일 때
  이름으로 되돌린다.
아무것도 저장하지 않는다.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.analysis_context import MEMO_CHARS, _flow
from geosan.api.coach import _day, _memos, _prior_answers
from geosan.evidence.sales_record_gate import ScrubbedRecordText, scrub_sales_records
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Outcome
from geosan.rules.codes import OutcomeStatus

CASE_PREFIX = "사례 S"
_CASE = re.compile(r"사례 S(\d+)")
CASES_HEAD = "[비슷한 성사 사례]"


@dataclass(frozen=True)
class SimilarCase:
    """고른 성사 회사 하나. alias는 보내는 글의 이름("사례 S1"), 나머지는 화면용(보내지 않음)."""

    alias: str
    opp_id: str
    name: str
    shared_processes: tuple[str, ...]
    shared_industries: tuple[str, ...]


@dataclass(frozen=True)
class SimilarCases:
    """보낼 사례 글(회사마다 지운 사본)과 고른 회사들. 사례가 없으면 둘 다 비어 있다."""

    items: list[ScrubbedRecordText]
    cases: list[SimilarCase]

    @property
    def by_alias(self) -> dict[str, SimilarCase]:
        return {case.alias: case for case in self.cases}

    def restore(self, text: str) -> str:
        """답 글의 "사례 S1"을 원래 회사 이름으로 바꾼다. 모르는 번호는 그대로 둔다."""
        names = {case.alias: case.name for case in self.cases}
        return _CASE.sub(lambda m: names.get(m.group(0), m.group(0)), text)


NO_CASES = SimilarCases(items=[], cases=[])


def _live_processes(session: Session, opp_id: str) -> set[str]:
    """대체되지 않은 공정 연결(확정·제안)의 공정 코드."""
    return set(
        session.scalars(
            select(OppProcessLink.process_code).where(
                OppProcessLink.opp_id == opp_id, OppProcessLink.superseded_at.is_(None)
            )
        )
    )


def _latest_status(session: Session, opp_id: str) -> Outcome | None:
    """잘못 입력으로 표시한 행을 뺀 최신 영업 기록(records.latest_outcome과 같은 기준)."""
    return session.scalar(
        select(Outcome)
        .where(Outcome.opp_id == opp_id, Outcome.cancelled_at.is_(None))
        .order_by(Outcome.version.desc())
    )


def _won_day(row: Outcome) -> date:
    return row.attempted_at or _day(row.created_at)


def pick_similar_won(
    session: Session, opp_id: str, limit: int
) -> list[tuple[str, str, tuple[str, ...], tuple[str, ...]]]:
    """(opp_id, 회사 이름, 겹친 공정 코드, 겹친 산업) 목록을 고르는 순서대로 limit개까지."""
    return pick_similar(session, opp_id, limit, OutcomeStatus.WON)


def pick_similar(
    session: Session, opp_id: str, limit: int, status: OutcomeStatus
) -> list[tuple[str, str, tuple[str, ...], tuple[str, ...]]]:
    """지금 결과가 status(성사·거절)인 비슷한 회사를 pick_similar_won과 같은 순서로 고른다.

    #927 MCP 서버의 "비슷한 거절 회사"가 성사와 같은 기준을 쓰려고 나눴다.
    """
    if limit <= 0:
        return []
    opportunity = session.get(Opportunity, opp_id)
    customer = session.get(Customer, opportunity.customer_id)
    processes = _live_processes(session, opp_id)
    industries = set(customer.industries or [])
    if not processes and not industries:
        return []
    # 지금 값이 그 결과(성사·거절)인 회사만 본다(같은 자료 묶음, 이 회사 제외).
    won_ids = set(
        session.scalars(
            select(Outcome.opp_id)
            .join(Opportunity, Opportunity.opp_id == Outcome.opp_id)
            .where(
                Outcome.status == status,
                Outcome.cancelled_at.is_(None),
                Outcome.opp_id != opp_id,
                Opportunity.dataset_kind == opportunity.dataset_kind,
            )
        )
    )
    found = []
    for won_id in won_ids:
        latest = _latest_status(session, won_id)
        if latest is None or latest.status != status:
            continue
        other = session.get(Customer, session.get(Opportunity, won_id).customer_id)
        shared_p = tuple(sorted(processes & _live_processes(session, won_id)))
        shared_i = tuple(sorted(industries & set(other.industries or [])))
        if not shared_p and not shared_i:
            continue
        found.append((won_id, other.name, shared_p, shared_i, _won_day(latest)))
    found.sort(key=lambda row: (-len(row[2]), -len(row[3]), -row[4].toordinal(), row[1]))
    return [(won_id, name, p, i) for won_id, name, p, i, _ in found[:limit]]


def _contacts(session: Session, opp_id: str) -> int:
    """접촉(통화·메일·방문) 행 수. 잘못 입력으로 표시한 행은 뺀다."""
    return len(
        session.scalars(
            select(Outcome.outcome_id).where(
                Outcome.opp_id == opp_id,
                Outcome.cancelled_at.is_(None),
                Outcome.method.is_not(None),
            )
        ).all()
    )


def build_similar_cases(
    session: Session,
    opp_id: str,
    *,
    limit: int,
    memo_limit: int,
    process_names: Mapping[str, str],
    keep_words: Sequence[str],
) -> SimilarCases:
    """고른 성사 회사들의 기록을 "사례 S1" 글로 만든다. 고를 회사가 없으면 NO_CASES."""
    picked = pick_similar_won(session, opp_id, limit)
    if not picked:
        return NO_CASES
    items: list[ScrubbedRecordText] = []
    cases: list[SimilarCase] = []
    for index, (won_id, name, shared_p, shared_i) in enumerate(picked, start=1):
        alias = f"{CASE_PREFIX}{index}"
        other = session.get(Customer, session.get(Opportunity, won_id).customer_id)
        all_processes = sorted(_live_processes(session, won_id))
        flow, reasons = _flow(session, won_id)
        _, answers = _prior_answers(session, won_id)
        memos = _memos(session, won_id)[-memo_limit:]
        shared = [
            *(f"공정 {process_names.get(code, code)}" for code in shared_p),
            *(f"산업 {industry}" for industry in shared_i),
        ]
        lines = [
            f"[{alias}] 공정: "
            + (", ".join(process_names.get(code, code) for code in all_processes) or "확인 전")
            + f" · 산업: {', '.join(other.industries or []) or '확인 전'}"
            + f" · 이 회사와 겹침: {', '.join(shared)}"
            + f" · 결과: 성사 · 접촉 {_contacts(session, won_id)}번",
            "흐름: " + (" → ".join(flow) or "없음"),
            "답: " + ("; ".join(answers) or "없음"),
            "메모: " + ("; ".join(f"{d:%m/%d} {t[:MEMO_CHARS]}" for d, t in memos) or "없음"),
            "결과 사유: " + ("; ".join(reasons) or "없음"),
        ]
        if index == 1:
            lines.insert(0, CASES_HEAD)
        text = "\n".join(lines)
        if name:
            text = text.replace(name, alias)
        # 회사마다 따로 지운다: 그 회사 글에서 알아 둔 이름을 그 회사 글 전체에서 지운다.
        (scrubbed,) = scrub_sales_records([text], [*keep_words, alias])
        items.append(scrubbed)
        cases.append(
            SimilarCase(
                alias=alias,
                opp_id=won_id,
                name=name,
                shared_processes=tuple(process_names.get(code, code) for code in shared_p),
                shared_industries=shared_i,
            )
        )
    return SimilarCases(items=items, cases=cases)
