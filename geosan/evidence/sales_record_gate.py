"""C4 EXTERNAL_AI의 영업 기록 글(kind SALES_RECORD) 문 (#680, PM 결정 2026-11-13 #681).

영업 기록 글(메모·한 줄 메모·자유 답)은 아래를 모두 지나야 외부 AI로 나갈 수 있다.
  ① 영업 기록 전용 스위치(`llm.salesRecordsEnabled`)가 켜져 있다
  ② 전화·이메일·사람 이름 지우기를 거쳤다(문에서 한 번 더 검사한다)
  ③ 전송 기록 1행과 월 호출·비용 한도(다른 AI 호출과 같은 한도)
하나라도 걸리면 전체 거부이고 거부 기록이 남는다(걸러서 다시 보내지 않는다).

여기에는 문만 있다. 이 문을 실제로 쓰는 기능(질문에 답하기 등)은 아직 없다. 지우기를 거치지
않은 메모(kind NOTE)는 지금처럼 어떤 외부 호출에도 나가지 못한다.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, NotFoundError
from geosan.evidence.contacts import scrub_contacts, scrub_person_names
from geosan.evidence.transfer import SearchTicket, TransferLog, _reserve
from geosan.opportunity.models import Opportunity
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

SALES_RECORD_KIND = "SALES_RECORD"
DISABLED_MESSAGE = "영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다."
NOT_SCRUBBED_MESSAGE = "연락처·사람 이름 지우기를 거치지 않은 영업 기록 글이 있습니다."


@dataclass(frozen=True, slots=True)
class ScrubbedRecordText:
    """지우기를 거친 영업 기록 글 하나. scrub_sales_record로만 만든다."""

    text: str
    removed_contacts: int
    removed_names: int


def scrub_sales_record(text: str) -> ScrubbedRecordText:
    """전화·이메일을 먼저, 사람 이름을 그다음에 지운다. 저장된 글은 바꾸지 않는다(사본만).

    사람 이름은 모양으로만 찾으므로 직함·호칭 없이 적힌 이름은 남는다(scrub_person_names 설명).
    """
    text, contacts = scrub_contacts(text)
    text, names = scrub_person_names(text)
    return ScrubbedRecordText(text, contacts, names)


def _is_clean(item: object) -> bool:
    if not isinstance(item, ScrubbedRecordText) or not isinstance(item.text, str):
        return False
    again = scrub_sales_record(item.text)
    return again.removed_contacts == 0 and again.removed_names == 0


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
    if not texts or not all(_is_clean(item) for item in texts):
        _reject(opp_id, NOT_SCRUBBED_MESSAGE, requested_by, db_path)
        raise AppError(NOT_SCRUBBED_MESSAGE, "전송 기록을 확인해 주세요.", status=422)
    return _reserve(
        opp_id, key_present, db_path, "EXTERNAL_AI", requested_by, record_kind=SALES_RECORD_KIND
    )
