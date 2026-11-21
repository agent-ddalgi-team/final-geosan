"""#802 AI 분석 받기에 싣는 회사별 맥락 글(PM 결정 2026-11-20).

숫자 표만 보내면 AI가 숫자를 문장으로 옮기는 데 그쳐, 사람이 한눈에 보기 어려운 원인과 다음 전략을
뽑으려고 회사별 기록을 함께 보낸다. 싣는 것: 확정 공정·산업, 영업 결과(거절 이유), 세부 단계,
접촉 흐름(날짜·방법·결과), 꼬리 질문 답, 영업 메모·접촉 한 줄 메모, 결과 사유 글.

보내기 전에 회사마다 따로 지운다(scrub_sales_records, 영업 코치와 같은 넉넉한 규칙): 전화·이메일,
직함·호칭과 함께 나온 이름과 그 이름이 다른 글에 나온 것, 이름처럼 보이는 낱말. 회사 이름은
"회사 A1"처럼 바꿔 보내고(대표번호·주소는 싣지 않는다), 답을 받은 뒤 화면에 보일 때 원래 이름으로
되돌린다. 보내는 문(스위치·지우기 재검사·전송 기록·월 한도)은 다른 영업 기록 글과 같다(#681).
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.coach import _memos, _prior_answers
from geosan.api.routes.records import LOST_REASON_LABELS
from geosan.dashboard.queries import METHOD_LABELS, RESULT_LABELS, STAGE_LABELS
from geosan.evidence.sales_record_gate import ScrubbedRecordText, scrub_sales_records
from geosan.records.models import Outcome

# 메모 한 개를 이 글자 수에서 자른다(규칙 숫자가 아니라 보낼 글 크기를 묶는 값).
MEMO_CHARS = 300
CLOSED = ("WON", "LOST", "ON_HOLD")
ALIAS_PREFIX = "회사 A"
_ALIAS = re.compile(r"회사 A(\d+)")


@dataclass(frozen=True)
class CompanyContext:
    """보낼 회사별 글(지운 사본)과 화면에서 되돌릴 이름 대응표. 이름표는 밖으로 보내지 않는다."""

    items: list[ScrubbedRecordText]
    opp_ids: list[str]
    names: dict[str, str]

    def restore(self, text: str) -> str:
        """답 글의 "회사 A3"을 원래 회사 이름으로 바꾼다. 모르는 번호는 그대로 둔다."""
        return _ALIAS.sub(lambda m: self.names.get(m.group(0), m.group(0)), text)


def _order(rows: Sequence) -> list:
    """끝난 회사(성사·거절·보류)를 먼저, 그 안에서는 최근에 끝난 순. 진행 중은 최근 접촉 순."""
    closed = [row for row in rows if row.outcome_status in CLOSED]
    open_ = [row for row in rows if row.outcome_status not in CLOSED]
    closed.sort(key=lambda row: row.outcome_at or row.last_contact_at, reverse=True)
    open_.sort(key=lambda row: row.last_contact_at, reverse=True)
    return [*closed, *open_]


def _flow(session: Session, opp_id: str) -> tuple[list[str], list[str]]:
    """접촉 흐름 줄("11/03 전화 연결됨")과 결과 사유 글. 취소한 행은 뺀다."""
    flow, reasons = [], []
    for row in session.scalars(
        select(Outcome)
        .where(Outcome.opp_id == opp_id, Outcome.cancelled_at.is_(None))
        .order_by(Outcome.version)
    ):
        day = row.attempted_at or row.created_at.date()
        if row.method:
            result = RESULT_LABELS.get(row.result or "", row.result or "")
            flow.append(f"{day:%m/%d} {METHOD_LABELS.get(row.method, row.method)} {result}".strip())
        elif row.status in CLOSED:
            flow.append(f"{day:%m/%d} 결과 {STAGE_LABELS.get(row.status, row.status)}")
        if row.reason and row.reason.strip():
            reasons.append(f"{day:%m/%d}: {row.reason.strip()[:MEMO_CHARS]}")
    return flow, reasons


def _step(row, step_labels: Mapping[str, str]) -> str:
    """세부 단계의 쉬운 말. 끝난 회사(성사·거절·보류)는 세부 단계가 없어 "끝남"이다."""
    if row.sales_step is None:
        return "끝남" if row.outcome_status in CLOSED else "기록 없음"
    code = getattr(row.sales_step, "value", row.sales_step)
    return step_labels.get(code, code)


def build_company_context(
    session: Session,
    rows: Sequence,
    *,
    process_names: Mapping[str, str],
    step_labels: Mapping[str, str],
    keep_words: Sequence[str],
    max_companies: int,
    memo_limit: int,
) -> CompanyContext:
    """분석 기간의 회사들(rows = 영업 분석표 회사 행)을 최대 max_companies곳까지 글로 만든다."""
    items: list[ScrubbedRecordText] = []
    opp_ids: list[str] = []
    names: dict[str, str] = {}
    for index, row in enumerate(_order(rows)[:max_companies], start=1):
        alias = f"{ALIAS_PREFIX}{index}"
        names[alias] = row.name
        status = STAGE_LABELS.get(row.outcome_status, row.outcome_status)
        if row.outcome_status == "LOST" and row.lost_reason_code:
            status += f"({LOST_REASON_LABELS.get(row.lost_reason_code, row.lost_reason_code)})"
        processes = ", ".join(process_names.get(code, code) for code in row.process_codes)
        flow, reasons = _flow(session, row.opp_id)
        _, answers = _prior_answers(session, row.opp_id)
        memos = _memos(session, row.opp_id)[-memo_limit:]
        lines = [
            f"[{alias}] 공정: {processes or '확인 전'}"
            f" · 산업: {', '.join(row.industries) or '확인 전'}"
            f" · 결과: {status} · 세부 단계: {_step(row, step_labels)}"
            f" · 접촉 {row.contact_count.total}번",
            "흐름: " + (" → ".join(flow) or "없음"),
            "답: " + ("; ".join(answers) or "없음"),
            "메모: " + ("; ".join(f"{d:%m/%d} {t[:MEMO_CHARS]}" for d, t in memos) or "없음"),
            "결과 사유: " + ("; ".join(reasons) or "없음"),
        ]
        text = "\n".join(lines).replace(row.name, alias) if row.name else "\n".join(lines)
        # 회사마다 따로 지운다: 그 회사 글에서 알아 둔 이름을 그 회사 글 전체에서 지운다.
        (scrubbed,) = scrub_sales_records([text], [*keep_words, alias])
        items.append(scrubbed)
        opp_ids.append(row.opp_id)
    return CompanyContext(items=items, opp_ids=opp_ids, names=names)
