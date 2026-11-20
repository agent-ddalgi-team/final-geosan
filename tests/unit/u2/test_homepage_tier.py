"""#860: 조사가 홈페이지 문장으로 공급망 위치(2·3차 가공 / 1차 완성품·조립)를 고친다.

실제 SQLite와 가짜 홈페이지·가짜 OpenAI 응답만 쓴다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import pytest

from geosan.evidence.extraction import Extraction, _checked_fit
from geosan.opportunity.models import Customer
from geosan.opportunity.queries import apply_homepage_tier
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u2 import test_extraction as support
from tests.unit.u2.test_homepage_fit import company, found_company, sent_instructions

search_env = support.search_env
extract_env = support.extract_env
URL = support.URL
BODY = support.BODY
QUOTE = "정밀 볼트를 생산합니다."


def review(*, tier="TIER2_3", reason="볼트를 직접 가공", quote=QUOTE, fit_level=None):
    return {
        "fitLevel": fit_level,
        "reason": "볼트를 직접 생산" if fit_level else "",
        "quote": QUOTE if fit_level else None,
        "downgradeBasis": None,
        "supplyTier": tier,
        "supplyTierReason": reason,
        "supplyTierQuote": quote,
    }


def ai_says(transport, **changes):
    data = support.answer()
    data["fitReview"] = review(**changes)
    transport.side_effect = lambda *_: support.reply(data)


def test_homepage_sentence_sets_tier_and_source(extract_env):
    """Given 생산품으로 1차라고 본 회사 / When 조사가 "볼트를 생산" 문장으로 2·3차라고 봄
    / Then 위치·근거가 홈페이지 기준으로 바뀐다."""
    case, transport = extract_env
    found_company(case)
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.supply_tier, customer.supply_tier_source = "TIER1", "PRODUCT"
        customer.supply_tier_basis = "완성품 조립"
    ai_says(transport)
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert (customer.supply_tier, customer.supply_tier_basis, customer.supply_tier_source) == (
        "TIER2_3",
        "볼트를 직접 가공",
        "HOMEPAGE",
    )
    assert "공급망 위치(supplyTier)" in sent_instructions(transport)


def test_no_sentence_keeps_product_tier(extract_env):
    case, transport = extract_env
    found_company(case)
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.supply_tier, customer.supply_tier_source = "TIER1", "PRODUCT"
        customer.supply_tier_basis = "완성품 조립"
    ai_says(transport, tier=None, reason="", quote=None)
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert (customer.supply_tier, customer.supply_tier_source) == ("TIER1", "PRODUCT")


def test_case_file_company_is_not_asked(extract_env):
    """사례 파일 회사(회차 번호 없음)는 적합도처럼 위치도 묻지 않고 바꾸지 않는다."""
    case, transport = extract_env
    ai_says(transport)
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert customer.supply_tier is None
    assert "supplyTier null" in sent_instructions(transport)


@pytest.mark.parametrize(
    ("reason", "quote"),
    [("볼트 가공", "본문에 없는 문장"), ("  ", QUOTE), ("볼트 가공", None)],
    ids=["인용이 본문에 없음", "이유가 빔", "인용 없음"],
)
def test_unbacked_tier_is_dropped_but_fit_is_kept(reason, quote):
    """위치와 적합도는 따로 검사한다. 위치만 근거가 없으면 위치만 버린다."""
    data = support.answer()
    data["fitReview"] = review(reason=reason, quote=quote, fit_level="HIGH")
    checked = _checked_fit(Extraction.model_validate(data), BODY)
    assert checked.fit_review.fit_level == "HIGH"
    assert (
        checked.fit_review.supply_tier,
        checked.fit_review.supply_tier_reason,
        checked.fit_review.supply_tier_quote,
    ) == (None, "", None)


def test_apply_homepage_tier_only_for_found_companies():
    found = Customer(customer_id="a", ingest_batch_id="batch")
    case_file = Customer(customer_id="b", ingest_batch_id=None)
    assert apply_homepage_tier(found, "TIER1", " 차량 조립 납품 ") is True
    assert (found.supply_tier, found.supply_tier_basis, found.supply_tier_source) == (
        "TIER1",
        "차량 조립 납품",
        "HOMEPAGE",
    )
    assert apply_homepage_tier(case_file, "TIER1", "조립") is False
    assert apply_homepage_tier(found, None, "") is False
    assert found.supply_tier == "TIER1"
