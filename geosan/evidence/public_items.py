"""조사 한 번 동안만 유지하는 공개 본문 보관함. 어댑터는 승인 ID로만 조회한다."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock

from geosan.config.errors import AppError
from geosan.evidence.contacts import scrub_contacts
from geosan.evidence.reader import Page
from geosan.evidence.transfer import record_search_rejection
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import new_id
from geosan.storage.session import session_scope


@dataclass(frozen=True)
class PublicItem:
    opp_id: str
    page_url: str
    text: str


_items: dict[str, PublicItem] = {}
_lock = Lock()


def check_opportunity(opp_id: str) -> None:
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id) if opportunity else None
        allowed = (
            customer is not None
            and customer.security_grade == "PUBLIC"
            and opportunity.purpose == "NEW_PROPOSAL"
        )
    if not allowed:
        record_search_rejection(
            opp_id, "공개 신규 기회만 조사할 수 있습니다.", None, purpose="EXTERNAL_AI"
        )
        raise AppError(
            "공개 신규 기회만 조사할 수 있습니다.",
            "공개 자료와 기회 용도를 확인해 주세요.",
            status=422,
        )


@contextmanager
def approve_page(opp_id: str, page: Page):
    """외부 읽기에서 얻은 공개 본문만 보관하고, 성공·실패 모두 끝나면 즉시 비운다."""
    with approve_pages(opp_id, [page]) as item_ids:
        yield item_ids


@contextmanager
def approve_pages(opp_id: str, pages: list[Page]):
    """같은 조사에서 읽은 여러 페이지를 페이지마다 항목 하나로 보관한다(#557)."""
    check_opportunity(opp_id)
    item_ids = []
    try:
        for page in pages:
            text, _ = scrub_contacts(page.text)
            item_id = new_id("public")
            with _lock:
                _items[item_id] = PublicItem(opp_id, page.url, text)
            item_ids.append(item_id)
        yield item_ids
    finally:
        with _lock:
            for item_id in item_ids:
                _items.pop(item_id, None)


def approved_items(approved_item_ids: list[str], opp_id: str) -> list[PublicItem]:
    check_opportunity(opp_id)
    with _lock:
        items = [_items.get(key) for key in approved_item_ids]
    if not items or any(item is None or item.opp_id != opp_id for item in items):
        record_search_rejection(
            opp_id, "승인되지 않은 본문 항목입니다.", None, purpose="EXTERNAL_AI"
        )
        raise AppError(
            "승인되지 않은 본문 항목입니다.", "홈페이지를 다시 조사해 주세요.", status=422
        )
    return items
