"""#927 MCP 서버의 읽기 전용 도구 5개와 그 문(PM 결정 2026-11-25). 계약 C4·C7·C8.

PC의 AI 앱(Claude 앱 등)이 `geosan mcp`로 이 도구를 불러 우리 DB의 영업 기록을 읽는다. 다음 단계
(#916)에서는 영업 코치도 같은 도구를 쓴다. 도구는 DB를 바꾸지 않고, 부를 때마다 전송 기록만 남긴다.

문(#681 네 조건을 이 창구에 맞춘 것, PM 결정 2026-11-25):
  ① 영업 기록 스위치(`llm.salesRecordsEnabled`)가 꺼져 있으면 아무것도 돌려주지 않는다
  ② 회사마다 따로 전화·이메일·사람 이름을 지우고(scrub_sales_records, 코치·영업 분석과 같은 넉넉한
     규칙) 문에서 한 번 더 검사한다. 하나라도 남으면 그 호출 전체를 거부한다. 대표번호·주소·담당자
     키는 처음부터 싣지 않는다. 회사 이름은 그대로 보인다(앱에서 회사를 골라 묻기 위해)
  ③ 값이 실린 회사마다 전송 기록 1행(purpose·kind MCP_TOOL, 첫 회사만 호출 수 1, 나머지 0)
  ④ 바깥 앱의 비용은 우리 월 한도에 걸 수 없어서, 하루(한국 날짜) 도구 호출 수를
     `assistant.mcpDailyLimit`으로 묶는다. 월 AI 비용·호출 한도와 `geosan cost`에는 세지 않는다
가상 회사 줄에는 "가상·거산 실제 사양 아님"을 붙인다(CON-10).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.api.analysis_context import MEMO_CHARS, _flow
from geosan.api.coach import _day, _md, _memos, _prior_answers
from geosan.api.coach_cases import _contacts, _live_processes, pick_similar
from geosan.api.deps import runtime_for
from geosan.api.routes.records import (
    LOST_REASON_LABELS,
    choice_catalog,
    latest_outcome,
    sales_questions,
    sales_step_state,
)
from geosan.config.app_settings import AppSettings, read_app_settings
from geosan.dashboard.queries import METHOD_LABELS, RESULT_LABELS, STAGE_LABELS
from geosan.evidence.sales_record_gate import (
    DISABLED_MESSAGE,
    NOT_SCRUBBED_MESSAGE,
    ScrubbedRecordText,
    _is_clean,
    scrub_sales_records,
)
from geosan.evidence.transfer import KST, TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import AnalysisFeedback, Outcome
from geosan.rules.codes import OutcomeStatus, TransferKind, TransferPurpose
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

VIRTUAL_TAG = "[가상·거산 실제 사양 아님]"
NO_RECORDS = "기록 없음"
LIMIT_MESSAGE = "오늘 MCP 조회 한도를 다 썼습니다."
NO_SETTINGS_MESSAGE = "앱 설정이 등록되지 않았습니다."
# 회사 찾기 limit 기본값(보낼 글 크기를 묶는 값, 상한은 assistant.maxCompanies).
DEFAULT_FIND_LIMIT = 20
# 지난 분석 목록에서 보이는 수(최근 것부터).
PAST_LIST_LIMIT = 20
# 회사 찾기의 지금 상태(쉬운 말). 성사·거절·보류는 영업 결과 그대로, 나머지는 접촉이 있으면 진행 중.
STATUS_LABELS = {
    "NOT_CONTACTED": "접촉 전",
    "IN_PROGRESS": "진행 중",
    "ON_HOLD": STAGE_LABELS["ON_HOLD"],
    "WON": STAGE_LABELS["WON"],
    "LOST": STAGE_LABELS["LOST"],
}
STATUS_VALUES = tuple(STATUS_LABELS)
_CLOSED = ("WON", "LOST", "ON_HOLD")


class ToolInputError(ValueError):
    """도구 인자가 틀렸다. 글은 그대로 AI 앱에 보인다."""


@dataclass(frozen=True)
class ToolResult:
    """도구 한 번의 결과 글. is_error면 AI 앱에 오류로 보인다(값은 싣지 않는다)."""

    text: str
    is_error: bool = False


@dataclass
class _Piece:
    """회사 하나의 글(지우기 전). 문이 회사마다 따로 지운다."""

    opp_id: str
    text: str
    keep: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    input_schema: dict[str, Any]
    # (회사별 글, 머리 줄, 머리 줄을 지울 때 지킬 낱말). 머리 줄도 지우기·재검사를 거친다.
    run: Callable[[Session, AppSettings, dict[str, Any]], tuple[list[_Piece], str, tuple[str, ...]]]

    def listing(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": {
                "title": self.title,
                "readOnlyHint": True,
                "destructiveHint": False,
                "openWorldHint": False,
            },
        }


# ---------- 공통: 글 만들기 ----------


@dataclass(frozen=True)
class _Words:
    """회사 글에 쓰는 이름표와, 지울 때 사람 이름으로 보지 않을 낱말."""

    processes: Mapping[str, str]
    steps: Mapping[Any, str]
    keep: tuple[str, ...]


def _words(session: Session, settings: AppSettings) -> _Words:
    questions = sales_questions(session)
    catalog = choice_catalog(session)
    processes = dict(catalog.get("PROCESS", {}))
    steps = {entry.code: entry.label for entry in questions.steps}
    keep = (
        *processes.values(),
        *settings.industries,
        *(question.text for question in questions.questions),
        *(option.label for question in questions.questions for option in question.answers),
        *(label for values in catalog.values() for label in values.values()),
        *steps.values(),
        *STAGE_LABELS.values(),
        *METHOD_LABELS.values(),
        *RESULT_LABELS.values(),
        *LOST_REASON_LABELS.values(),
        "가상",
        "거산",
    )
    return _Words(processes=processes, steps=steps, keep=keep)


def _status_code(row: Outcome | None, contacts: int) -> str:
    """STATUS_LABELS의 키: 끝난 결과면 그대로, 아니면 접촉이 있으면 진행 중."""
    if row is not None and row.status in _CLOSED:
        return row.status
    return "IN_PROGRESS" if contacts else "NOT_CONTACTED"


def _status(row: Outcome | None, contacts: int) -> str:
    """지금 상태의 쉬운 말. 거절이면 이유를 괄호로 붙인다."""
    text = STATUS_LABELS[_status_code(row, contacts)]
    if row is not None and row.status == OutcomeStatus.LOST and row.lost_reason_code:
        text += f"({LOST_REASON_LABELS.get(row.lost_reason_code, row.lost_reason_code)})"
    return text


def _step(session: Session, opp_id: str, words: _Words) -> str:
    code = sales_step_state(session, opp_id, status=None).code
    return words.steps.get(code, str(code)) if code is not None else NO_RECORDS


def _head(
    session: Session, opportunity: Opportunity, customer: Customer, words: _Words, extra: str = ""
) -> str:
    """회사 한 줄: 이름 · 공정 · 산업 · 결과 · 세부 단계 · 접촉 수 (+ 가상 표시)."""
    processes = sorted(_live_processes(session, opportunity.opp_id))
    names = ", ".join(words.processes.get(code, code) for code in processes) or "확인 전"
    contacts = _contacts(session, opportunity.opp_id)
    line = (
        f"{customer.name} (oppId {opportunity.opp_id}) · 공정: {names}"
        f" · 산업: {', '.join(customer.industries or []) or '확인 전'}"
        f" · 상태: {_status(latest_outcome(session, opportunity.opp_id), contacts)}"
        f" · 세부 단계: {_step(session, opportunity.opp_id, words)}"
        f" · 접촉 {contacts}번{extra}"
    )
    return f"{line} {VIRTUAL_TAG}" if opportunity.is_virtual else line


def _record_lines(session: Session, opp_id: str, memo_limit: int) -> list[str]:
    """영업 분석 회사별 기록(#802)과 같은 항목: 흐름·꼬리 질문 답·메모·결과 사유."""
    flow, reasons = _flow(session, opp_id)
    _, answers = _prior_answers(session, opp_id)
    memos = _memos(session, opp_id)[-memo_limit:]
    return [
        "흐름: " + (" → ".join(flow) or "없음"),
        "답: " + ("; ".join(answers) or "없음"),
        "메모: " + ("; ".join(f"{d:%m/%d} {t[:MEMO_CHARS]}" for d, t in memos) or "없음"),
        "결과 사유: " + ("; ".join(reasons) or "없음"),
    ]


def _active(session: Session) -> str:
    return runtime_for(session).app_settings.active_dataset_kind.value


def _opportunity(session: Session, args: dict[str, Any]) -> tuple[Opportunity, Customer]:
    """oppId 인자를 지금 자료 묶음의 회사로 바꾼다. 없거나 다른 묶음이면 인자 오류."""
    opp_id = _text_arg(args, "oppId", required=True)
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None or opportunity.dataset_kind != _active(session):
        raise ToolInputError("그 oppId의 회사가 없습니다. 회사 찾기로 oppId를 확인해 주세요.")
    return opportunity, session.get(Customer, opportunity.customer_id)


def _text_arg(args: dict[str, Any], key: str, *, required: bool = False) -> str | None:
    value = args.get(key)
    if value is None:
        if required:
            raise ToolInputError(f"{key}를 넣어 주세요.")
        return None
    if not isinstance(value, str) or not value.strip():
        raise ToolInputError(f"{key}는 빈 글이 아닌 글자여야 합니다.")
    return value.strip()


# ---------- 도구 5개 ----------


def _find_companies(session: Session, settings: AppSettings, args: dict[str, Any]):
    name = _text_arg(args, "name")
    process = _text_arg(args, "process")
    status = _text_arg(args, "status")
    if status is not None and status not in STATUS_VALUES:
        raise ToolInputError("status는 " + ", ".join(STATUS_VALUES) + " 가운데 하나여야 합니다.")
    limit = args.get("limit", DEFAULT_FIND_LIMIT)
    top = settings.assistant.max_companies
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= top:
        raise ToolInputError(f"limit은 1~{top} 사이 정수여야 합니다.")
    words = _words(session, settings)
    rows = session.execute(
        select(Opportunity, Customer)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .where(Opportunity.dataset_kind == _active(session))
    ).all()
    found: list[tuple[date | None, str, Opportunity, Customer]] = []
    for opportunity, customer in rows:
        if name and name.casefold() not in customer.name.casefold():
            continue
        if status:
            code = _status_code(
                latest_outcome(session, opportunity.opp_id),
                _contacts(session, opportunity.opp_id),
            )
            if code != status:
                continue
        if process:
            names = (
                words.processes.get(c, c) for c in _live_processes(session, opportunity.opp_id)
            )
            if not any(process.casefold() in label.casefold() for label in names):
                continue
        last = _last_contact(session, opportunity.opp_id)
        found.append((last, customer.name, opportunity, customer))
    # 최근에 접촉한 회사 먼저, 같으면 이름순. 접촉이 없는 회사는 뒤로.
    found.sort(key=lambda row: (row[0] is None, -(row[0] or date.min).toordinal(), row[1]))
    pieces = []
    for last, _, opportunity, customer in found[:limit]:
        extra = f" · 마지막 접촉 {_md(last)}" if last else ""
        pieces.append(
            _Piece(
                opportunity.opp_id,
                "- " + _head(session, opportunity, customer, words, extra),
                (*words.keep, customer.name),
            )
        )
    more = len(found) - len(pieces)
    head = f"찾은 회사 {len(found)}곳" + (f"(앞 {len(pieces)}곳만 보임)" if more > 0 else "")
    return pieces, head, words.keep


def _last_contact(session: Session, opp_id: str) -> date | None:
    row = session.scalar(
        select(Outcome)
        .where(
            Outcome.opp_id == opp_id,
            Outcome.cancelled_at.is_(None),
            Outcome.method.is_not(None),
        )
        .order_by(Outcome.version.desc())
    )
    if row is None:
        return None
    return row.attempted_at or _day(row.created_at)


def _company_records(session: Session, settings: AppSettings, args: dict[str, Any]):
    opportunity, customer = _opportunity(session, args)
    words = _words(session, settings)
    memo_limit = settings.assistant.coach_prior_memo_limit
    text = "\n".join(
        [
            _head(session, opportunity, customer, words),
            *_record_lines(session, opportunity.opp_id, memo_limit),
        ]
    )
    piece = _Piece(opportunity.opp_id, text, (*words.keep, customer.name))
    return [piece], f"{customer.name}의 영업 기록", (*words.keep, customer.name)


def _similar(status: OutcomeStatus, label: str):
    def run(session: Session, settings: AppSettings, args: dict[str, Any]):
        opportunity, customer = _opportunity(session, args)
        limit = settings.assistant.coach_similar_won_limit
        if limit <= 0:
            raise ToolInputError("비슷한 회사 찾기가 꺼져 있습니다(coachSimilarWonLimit 0).")
        words = _words(session, settings)
        memo_limit = settings.assistant.coach_prior_memo_limit
        pieces = []
        for other_id, _name, shared_p, shared_i in pick_similar(
            session, opportunity.opp_id, limit, status
        ):
            other = session.get(Opportunity, other_id)
            other_customer = session.get(Customer, other.customer_id)
            shared = [
                *(f"공정 {words.processes.get(code, code)}" for code in shared_p),
                *(f"산업 {industry}" for industry in shared_i),
            ]
            text = "\n".join(
                [
                    "- " + _head(session, other, other_customer, words),
                    f"  겹치는 것({customer.name} 기준): {', '.join(shared)}",
                    *(f"  {line}" for line in _record_lines(session, other_id, memo_limit)),
                ]
            )
            pieces.append(_Piece(other_id, text, (*words.keep, other_customer.name, customer.name)))
        head = f"{customer.name} 기준, 공정·산업이 겹치는 {label} 회사 {len(pieces)}곳"
        return pieces, head, (*words.keep, customer.name)

    return run


_SECTIONS = (
    ("실패 · 어디서", ("failure", "where")),
    ("실패 · 왜", ("failure", "why")),
    ("실패 · 신호", ("failure", "signals")),
    ("실패 · 성사와 차이", ("failure", "vsSuccess")),
    ("실패 · 다음엔", ("failure", "next")),
    ("성사 · 어디서", ("success", "where")),
    ("성사 · 왜", ("success", "why")),
    ("성사 · 신호", ("success", "signals")),
    ("다음 할 일", ("next",)),
    ("지난 제안 돌아보기", ("lookBack",)),
)


def _claims(response: dict, path: tuple[str, ...]) -> list[str]:
    value: Any = response
    for key in path:
        value = value.get(key) if isinstance(value, dict) else None
    lines = []
    for claim in value or []:
        text = str(claim.get("text", "")).strip() if isinstance(claim, dict) else ""
        if text:
            evidence = [str(item) for item in claim.get("evidence") or [] if str(item).strip()]
            lines.append(text + (f" (근거: {'; '.join(evidence)})" if evidence else ""))
    return lines


def _period(row: AnalysisFeedback) -> str:
    if row.period_from is None and row.period_to is None:
        return "전체 기간"
    start = row.period_from.isoformat() if row.period_from else "처음"
    end = row.period_to.isoformat() if row.period_to else "오늘"
    return f"{start} ~ {end}"


def _analysis_anchor(session: Session, row: AnalysisFeedback) -> str | None:
    """그 분석을 처음 받을 때 전송 기록이 달린 회사. 이 도구의 전송 기록도 거기에 단다."""
    if row.transfer_log_id is None:
        return None
    log = session.get(TransferLog, row.transfer_log_id)
    return log.opp_id if log is not None else None


def _past_analyses(session: Session, settings: AppSettings, args: dict[str, Any]):
    feedback_id = _text_arg(args, "feedbackId")
    # 분석 글에는 회사 이름이 섞여 있어, 지울 때 지금 묶음의 회사 이름을 모두 지킨다.
    names = tuple(
        session.scalars(
            select(Customer.name)
            .join(Opportunity, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.dataset_kind == _active(session))
        )
    )
    keep = (*_words(session, settings).keep, *names)
    if feedback_id is not None:
        row = session.get(AnalysisFeedback, feedback_id)
        if row is None or row.dataset_kind != _active(session):
            raise ToolInputError("그 feedbackId의 지난 분석을 찾을 수 없습니다.")
        anchor = _analysis_anchor(session, row)
        if anchor is None:
            raise ToolInputError("이 분석은 전송 기록이 없어 MCP로 내보낼 수 없습니다.")
        lines = [f"받은 날 {_day(row.created_at).isoformat()} · 기간 {_period(row)}"]
        for title, path in _SECTIONS:
            claims = _claims(row.response, path)
            if claims:
                lines.append(f"[{title}]")
                lines.extend(f"- {claim}" for claim in claims)
        held = [str(item).strip() for item in row.response.get("heldBack") or [] if str(item)]
        if held:
            lines.append("[근거가 모자라 말하지 않은 것]")
            lines.extend(f"- {item}" for item in held)
        return [_Piece(anchor, "\n".join(lines), keep)], "지난 영업 분석", keep
    rows = session.scalars(
        select(AnalysisFeedback)
        .where(AnalysisFeedback.dataset_kind == _active(session))
        .order_by(AnalysisFeedback.created_at.desc(), AnalysisFeedback.feedback_id.desc())
        .limit(PAST_LIST_LIMIT)
    ).all()
    pieces = []
    for row in rows:
        anchor = _analysis_anchor(session, row)
        if anchor is None:
            continue
        first = next(iter(_claims(row.response, ("next",))), "") or next(
            iter(_claims(row.response, ("failure", "why"))), ""
        )
        text = (
            f"- feedbackId {row.feedback_id} · 받은 날 {_day(row.created_at).isoformat()}"
            f" · 기간 {_period(row)}" + (f" · 첫 줄: {first}" if first else "")
        )
        pieces.append(_Piece(anchor, text, keep))
    return pieces, f"지난 영업 분석 {len(pieces)}건(최근 것부터)", keep


_OPP_ID = {"type": "string", "description": "회사의 oppId(회사 찾기 결과에 있음)"}

TOOLS: tuple[Tool, ...] = (
    Tool(
        name="find_companies",
        title="회사 찾기",
        description=(
            "거산 영업 목록에서 회사를 찾습니다. 이름 일부·공정 이름 일부·지금 결과로 "
            "거를 수 있고, "
            "회사마다 oppId·공정·산업·결과·세부 단계·접촉 수·마지막 접촉일을 돌려줍니다. "
            "최근에 접촉한 회사가 먼저 나옵니다. 다른 도구에 넘길 oppId를 여기서 찾습니다."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "회사 이름 일부"},
                "process": {"type": "string", "description": "공정 이름 일부(예: 아연도금)"},
                "status": {
                    "type": "string",
                    "enum": list(STATUS_VALUES),
                    "description": "지금 상태: "
                    + ", ".join(f"{code}={label}" for code, label in STATUS_LABELS.items()),
                },
                "limit": {"type": "integer", "minimum": 1, "description": "보일 회사 수(기본 20)"},
            },
            "additionalProperties": False,
        },
        run=_find_companies,
    ),
    Tool(
        name="company_records",
        title="회사 기록 보기",
        description=(
            "한 회사의 영업 기록을 돌려줍니다: 접촉 흐름(날짜·방법·결과), 꼬리 질문 답, 영업 메모"
            "(최근 것), 결과 사유. 전화·이메일·사람 이름은 지운 사본입니다."
        ),
        input_schema={
            "type": "object",
            "properties": {"oppId": _OPP_ID},
            "required": ["oppId"],
            "additionalProperties": False,
        },
        run=_company_records,
    ),
    Tool(
        name="similar_won",
        title="비슷한 성사 회사",
        description=(
            "이 회사와 공정·산업이 겹치고 거래가 성사된 회사를 몇 곳 골라 그 회사들의 영업 기록을 "
            "돌려줍니다. 겹치는 공정이 많은 순 → 산업 → 최근 성사 순입니다."
        ),
        input_schema={
            "type": "object",
            "properties": {"oppId": _OPP_ID},
            "required": ["oppId"],
            "additionalProperties": False,
        },
        run=_similar(OutcomeStatus.WON, "성사"),
    ),
    Tool(
        name="similar_lost",
        title="비슷한 거절 회사",
        description=(
            "비슷한 성사 회사와 같은 기준으로, 지금 결과가 거절인 회사를 골라 거절 이유와 영업 "
            "기록을 돌려줍니다."
        ),
        input_schema={
            "type": "object",
            "properties": {"oppId": _OPP_ID},
            "required": ["oppId"],
            "additionalProperties": False,
        },
        run=_similar(OutcomeStatus.LOST, "거절"),
    ),
    Tool(
        name="past_analyses",
        title="지난 영업 분석",
        description=(
            "영업 분석 화면에서 받아 둔 AI 분석을 돌려줍니다. feedbackId가 없으면 최근 목록"
            "(받은 날·기간·첫 줄), 있으면 그 분석의 내용 전체입니다."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "feedbackId": {"type": "string", "description": "목록에 있는 feedbackId"}
            },
            "additionalProperties": False,
        },
        run=_past_analyses,
    ),
)
TOOLS_BY_NAME = {tool.name: tool for tool in TOOLS}


# ---------- 문 ----------


def mcp_calls_today(session: Session) -> int:
    """오늘(한국 날짜) MCP 도구로 값을 돌려준 횟수(허용 행의 호출 수 합)."""
    local = utcnow().astimezone(KST)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    return int(
        session.scalar(
            select(func.coalesce(func.sum(TransferLog.call_count), 0)).where(
                TransferLog.purpose == TransferPurpose.MCP_TOOL,
                TransferLog.decision == "ALLOWED",
                TransferLog.occurred_at >= day_start,
            )
        )
    )


def _log(
    session: Session,
    opp_ids: Sequence[str],
    staff_key: str,
    *,
    reject: str | None = None,
) -> None:
    """값이 실린 회사마다 1행(첫 회사만 호출 수 1). 거부면 가리킨 회사에 거부 1행."""
    now = utcnow()
    for index, opp_id in enumerate(opp_ids):
        session.add(
            TransferLog(
                transfer_log_id=new_id("transfer"),
                occurred_at=now,
                opp_id=opp_id,
                purpose=TransferPurpose.MCP_TOOL,
                kind=TransferKind.MCP_TOOL,
                mode="NONE",
                security_grade="EXTERNAL_AI_OK",
                decision="REJECTED" if reject else "ALLOWED",
                reject_reason=reject,
                requested_by=staff_key,
                call_count=1 if index == 0 and not reject else 0,
                cost_usd=0,
            )
        )


def _anchor_of(session: Session, args: dict[str, Any]) -> list[str]:
    """거부 행을 달 회사: 인자의 oppId가 실제 회사면 그 회사, 아니면 없음."""
    opp_id = args.get("oppId")
    if isinstance(opp_id, str) and session.get(Opportunity, opp_id) is not None:
        return [opp_id]
    return []


@dataclass(frozen=True)
class ToolOutput:
    """도구 한 번의 결과(지운 사본). 문·전송 기록은 부르는 쪽(MCP 창구·영업 코치 #916)이 맡는다.

    items의 첫 글은 머리 줄("찾은 회사 3곳" 등), 나머지는 회사마다 따로 지운 글이다.
    """

    items: list[ScrubbedRecordText]
    # 값이 실린 회사(중복 없음, 나온 순서).
    opp_ids: list[str]

    @property
    def head(self) -> str:
        return self.items[0].text

    @property
    def text(self) -> str:
        return "\n".join(item.text for item in self.items)

    @property
    def clean(self) -> bool:
        """문의 다시 검사(sales_record_gate._is_clean)를 모두 통과하나."""
        return all(_is_clean(item, item.known_names) for item in self.items)


def run_tool(
    session: Session, settings: AppSettings, name: str, args: dict[str, Any]
) -> ToolOutput:
    """도구를 실행해 지운 사본을 만든다(전송 기록·한도 없음). 모르는 도구는 KeyError,
    틀린 인자는 ToolInputError. 회사마다 따로 지운다(scrub_sales_records, 넉넉한 규칙)."""
    if not isinstance(args, dict):
        raise ToolInputError("도구 인자는 객체여야 합니다.")
    pieces, head, keep = TOOLS_BY_NAME[name].run(session, settings, args)
    if not pieces:
        head = f"{head}: 돌려줄 기록이 없습니다."
    items = [scrub_sales_records([head], keep)[0]]
    items += [scrub_sales_records([piece.text], piece.keep)[0] for piece in pieces]
    return ToolOutput(items=items, opp_ids=list(dict.fromkeys(piece.opp_id for piece in pieces)))


def call_tool(
    name: str,
    args: dict[str, Any] | None,
    staff_key: str,
    db_path: Path | str | None = None,
) -> ToolResult:
    """MCP 창구: 도구 하나를 문을 거쳐 부른다. 모르는 도구는 KeyError(프로토콜 오류로 알린다)."""
    TOOLS_BY_NAME[name]  # 모르는 도구는 문을 보기 전에 KeyError
    args = {} if args is None else args
    if not isinstance(args, dict):
        return ToolResult("도구 인자는 객체여야 합니다.", is_error=True)
    with session_scope(db_path) as session:
        settings = read_app_settings(session)
        if settings is None or settings.assistant is None:
            return ToolResult(NO_SETTINGS_MESSAGE, is_error=True)
        if not settings.llm.sales_records_enabled:
            _log(session, _anchor_of(session, args), staff_key, reject=DISABLED_MESSAGE)
            return ToolResult(DISABLED_MESSAGE, is_error=True)
        if mcp_calls_today(session) >= settings.assistant.mcp_daily_limit:
            _log(session, _anchor_of(session, args), staff_key, reject=LIMIT_MESSAGE)
            return ToolResult(f"{LIMIT_MESSAGE} 내일 다시 써 주세요.", is_error=True)
        try:
            output = run_tool(session, settings, name, args)
        except ToolInputError as error:
            return ToolResult(str(error), is_error=True)
        # 문에서 다시 검사한다. 하나라도 남으면 전체 거부(걸러 보내지 않음).
        if not output.clean:
            anchor = output.opp_ids[:1] or _anchor_of(session, args)
            _log(session, anchor, staff_key, reject=NOT_SCRUBBED_MESSAGE)
            return ToolResult(NOT_SCRUBBED_MESSAGE, is_error=True)
        _log(session, output.opp_ids, staff_key)
        return ToolResult(output.text)
