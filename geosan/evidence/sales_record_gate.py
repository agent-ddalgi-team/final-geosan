"""C4 EXTERNAL_AI의 영업 기록 글(kind SALES_RECORD) 문 (#680, PM 결정 2026-11-13 #681).

영업 기록 글(메모·한 줄 메모·자유 답)은 아래를 모두 지나야 외부 AI로 나갈 수 있다.
  ① 영업 기록 전용 스위치(`llm.salesRecordsEnabled`)가 켜져 있다
  ② 전화·이메일·사람 이름 지우기를 거쳤다(문에서 한 번 더 검사한다). 회사 단위로 지운 글
     (scrub_sales_records, #720)은 넉넉한 규칙과 알아 둔 이름으로 다시 검사한다
  ③ 전송 기록 1행과 월 호출·비용 한도(다른 AI 호출과 같은 한도)
하나라도 걸리면 전체 거부이고 거부 기록이 남는다(걸러서 다시 보내지 않는다).

이 문을 쓰는 기능은 영업 비서(질문에 답하기·통화 준비, `evidence/assistant_llm.py`)다. 그 기능은
자유 글을 싣지 않고 고른 값만 싣는다(계약 C4). 지우기를 거치지 않은 메모(kind NOTE)는 지금처럼
어떤 외부 호출에도 나가지 못한다.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC
from pathlib import Path

from sqlalchemy import func, select

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, NotFoundError
from geosan.evidence.contacts import (
    collect_person_names,
    has_known_person_name,
    scrub_contacts,
    scrub_person_names,
    scrub_person_names_wide,
)
from geosan.evidence.transfer import KST, SearchTicket, TransferLog, _reserve
from geosan.opportunity.models import Opportunity
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

SALES_RECORD_KIND = "SALES_RECORD"
DISABLED_MESSAGE = "영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다."
NOT_SCRUBBED_MESSAGE = "연락처·사람 이름 지우기를 거치지 않은 영업 기록 글이 있습니다."


@dataclass(frozen=True, slots=True)
class ScrubbedRecordText:
    """지우기를 거친 영업 기록 글 하나. scrub_sales_record·scrub_sales_records로만 만든다.

    known_names(같은 회사 글에서 알아 둔 이름)는 문이 다시 검사할 때만 쓴다. 저장하지 않고 밖으로
    보내지 않으며, 기록·오류 글에 찍히지 않게 repr에서 뺀다.
    """

    text: str
    removed_contacts: int
    removed_names: int
    wide: bool = False
    known_names: frozenset[str] = field(default=frozenset(), repr=False)
    keep_words: frozenset[str] = field(default=frozenset(), repr=False)


def scrub_sales_record(text: str) -> ScrubbedRecordText:
    """전화·이메일을 먼저, 사람 이름을 그다음에 지운다. 저장된 글은 바꾸지 않는다(사본만).

    사람 이름은 모양으로만 찾으므로 직함·호칭 없이 적힌 이름은 남는다(scrub_person_names 설명).
    """
    text, contacts = scrub_contacts(text)
    text, names = scrub_person_names(text)
    return ScrubbedRecordText(text, contacts, names)


def scrub_sales_records(
    texts: Sequence[str], keep_words: Iterable[str] = ()
) -> list[ScrubbedRecordText]:
    """한 회사의 글 묶음(메모 여러 개)을 한꺼번에 지운다(#720). 저장된 글은 바꾸지 않는다(사본만).

    전화·이메일을 먼저 지우고, 묶음에서 직함·호칭과 함께 나온 이름을 모아 그 이름과 성을 뗀 이름을
    직함 없이 나와도 지운다. 이름처럼 보이는 낱말도 넉넉하게 지운다(scrub_person_names_wide 설명).
    keep_words에는 공정·산업·지역·회사 이름처럼 프로그램이 아는 이름을 넘긴다(지우지 않는다).
    """
    keep = frozenset(keep_words)
    cleaned = [scrub_contacts(text) for text in texts]
    known = collect_person_names([text for text, _ in cleaned], keep)
    items = []
    for text, contacts in cleaned:
        text, names = scrub_person_names_wide(text, known, keep)
        items.append(ScrubbedRecordText(text, contacts, names, True, known, keep))
    return items


def _is_clean(item: object, known: frozenset[str]) -> bool:
    """지우기를 거친 글인지 다시 검사한다. known은 같은 묶음의 글들이 알아 둔 이름 전부."""
    if not isinstance(item, ScrubbedRecordText) or not isinstance(item.text, str):
        return False
    if scrub_contacts(item.text)[1] or has_known_person_name(item.text, known, item.keep_words):
        return False
    if item.wide:
        # 넉넉한 규칙은 keep_words로 지킨 낱말만 빼고 scrub_person_names가 지우는 것을 모두 지운다.
        return scrub_person_names_wide(item.text, known, item.keep_words)[1] == 0
    return scrub_person_names(item.text)[1] == 0


def _reject(opp_id: str, reason: str, requested_by: str, db_path: Path | str | None) -> None:
    with session_scope(db_path) as session:
        session.add(
            TransferLog(
                transfer_log_id=new_id("transfer"),
                occurred_at=utcnow(),
                opp_id=opp_id,
                purpose="EXTERNAL_AI",
                kind=SALES_RECORD_KIND,
                mode="NONE",
                security_grade="UNKNOWN",
                decision="REJECTED",
                reject_reason=reason,
                requested_by=requested_by,
                call_count=0,
            )
        )


def reserve_sales_records(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    key_present: bool,
    db_path: Path | str | None,
    requested_by: str,
) -> SearchTicket:
    """영업 기록 글 묶음을 외부 AI로 보내도 되는지 검사하고, 되면 호출 1회를 예약한다.

    통과하면 기존 AI 호출과 같은 전송 기록(SearchTicket)을 돌려주고, 사용량은 finish_search로
    확정한다. 걸리면 거부 기록을 남기고 오류를 낸다 — 호출자는 아무것도 보내지 않는다.
    """
    with session_scope(db_path) as session:
        if session.get(Opportunity, opp_id) is None:
            raise NotFoundError("영업 기회를 찾을 수 없습니다.")
        settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        enabled = settings.llm.sales_records_enabled
    if not enabled:
        _reject(opp_id, DISABLED_MESSAGE, requested_by, db_path)
        raise AppError(
            DISABLED_MESSAGE,
            "운영자에게 설정을 확인해 달라고 알려 주세요.",
            status=422,
            kind="SALES_RECORDS_DISABLED",
        )
    known = frozenset().union(
        *(item.known_names for item in texts if isinstance(item, ScrubbedRecordText))
    )
    if not texts or not all(_is_clean(item, known) for item in texts):
        _reject(opp_id, NOT_SCRUBBED_MESSAGE, requested_by, db_path)
        raise AppError(NOT_SCRUBBED_MESSAGE, "전송 기록을 확인해 주세요.", status=422)
    return _reserve(
        opp_id, key_present, db_path, "EXTERNAL_AI", requested_by, record_kind=SALES_RECORD_KIND
    )


def mark_sales_record_companies(
    opp_ids: Sequence[str],
    ticket: SearchTicket,
    requested_by: str,
    db_path: Path | str | None,
) -> None:
    """여러 회사에 걸친 전송에서, 값이 함께 실린 나머지 회사마다 표시 1행을 남긴다(#680).

    전송 기록 표는 회사 하나(또는 찾기 회차)에만 줄을 달 수 있다. 호출 1행(reserve_sales_records,
    호출 수 1·사용량·비용)은 첫 회사에 달리고, 여기서는 나머지 회사에 호출 수 0인 표시 행만 단다.
    호출 수가 0이라 월 호출·비용 한도와 정산에는 세지 않는다. 본문은 저장하지 않는다.
    """
    if not opp_ids:
        return
    now = utcnow()
    with session_scope(db_path) as session:
        for opp_id in opp_ids:
            opportunity = session.get(Opportunity, opp_id)
            if opportunity is None:
                raise NotFoundError("영업 기회를 찾을 수 없습니다.")
            session.add(
                TransferLog(
                    transfer_log_id=new_id("transfer"),
                    occurred_at=now,
                    opp_id=opp_id,
                    purpose="EXTERNAL_AI",
                    kind=SALES_RECORD_KIND,
                    mode=ticket.llm.mode,
                    model=ticket.llm.model,
                    security_grade="EXTERNAL_AI_OK",
                    decision="ALLOWED",
                    requested_by=requested_by,
                    call_count=0,
                    dataset_kind=opportunity.dataset_kind,
                    is_virtual=opportunity.is_virtual,
                )
            )


def sales_record_calls_today(db_path: Path | str | None = None) -> int:
    """오늘(한국 날짜) 영업 기록 글로 외부 AI를 부른 횟수. 하루 질문 한도 검사에 쓴다(#680)."""
    local = utcnow().astimezone(KST)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    with session_scope(db_path) as session:
        return int(
            session.scalar(
                select(func.coalesce(func.sum(TransferLog.call_count), 0)).where(
                    TransferLog.kind == SALES_RECORD_KIND,
                    TransferLog.occurred_at >= day_start,
                )
            )
        )
